import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { DatabaseSync } from "node:sqlite";
import makePipe from "callback-to-async-generator";
import assert from "node:assert";
import type { BookSchema } from "./schema.ts";

class InpxToSqliteConverter {
    private db: DatabaseSync;
    private insertStmt: any;

    constructor(dbPath: string) {
        this.db = new DatabaseSync(dbPath);
        this.initializeDatabase();
        this.insertStmt = this.db.prepare(`
      INSERT INTO books (lib_id, book_title, book_author, book_genre, book_language, file_name, file_size, file_location, key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    }

    private initializeDatabase(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        lib_id INTEGER PRIMARY KEY NOT NULL,
        book_title TEXT NOT NULL,
        book_author TEXT NOT NULL,
        book_genre TEXT,
        book_language TEXT,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_location TEXT NOT NULL,
        key TEXT NOT NULL
      )
    `);

        // Create indexes for common queries
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_title ON books(book_title);
      CREATE INDEX IF NOT EXISTS idx_author ON books(book_author);
    `);
    }

    private parseInpLine(line: string): BookSchema | null {
        const fields = line.split("\x04"); // ASCII End of Transmission character

        if (fields.length < 9) {
            console.warn(
                `Skipping malformed line with ${fields.length} fields:`,
                line.substring(0, 100),
            );
            return null;
        }

        try {
            // 0: AUTHOR
            // 1: GENRE
            // 2: TITLE
            // 5: FILEname
            // 6: SIZE
            // 7: LIBID
            // 9: EXTension
            // 12: ZIP-file
            // 13: Language
            assert(fields[0]);
            assert(fields[1]);
            assert(fields[2]);
            assert(fields[5]);
            assert(fields[6]);
            assert(fields[7]);
            assert(fields[9]);
            assert(fields[12]);
            assert(fields[13]);
            return {
                book_author: fields[0],
                book_genre: fields[1],
                book_title: fields[2],
                book_language: fields[13],
                lib_id: parseInt(fields[7]),
                file_location: fields[12],
                file_name: fields[5] + "." + fields[9],
                file_size: parseInt(fields[6]),
            };
        } catch (error) {
            console.warn("Error parsing line:", error, line.substring(0, 100));
            return null;
        }
    }

    private async processInpFile(fileContent: string): Promise<void> {
        const lines = fileContent.split("\n");
        let processed = 0;
        let skipped = 0;

        const batchSize = 1000;
        let batch: BookSchema[] = [];

        for (const line of lines) {
            if (line.trim() === "") continue;

            const record = this.parseInpLine(line.trim());
            if (record) {
                batch.push(record);
                processed++;

                if (batch.length >= batchSize) {
                    this.processBatch(batch);
                    batch = [];
                }
            } else {
                skipped++;
            }
        }

        // Process remaining records
        if (batch.length > 0) {
            this.processBatch(batch);
        }

        console.log(
            `Completed processing: ${processed} records inserted, ${skipped} skipped`,
        );
    }

    public listFiles(inpxPath: string): () => AsyncIterableIterator<string> {
        const pipe = makePipe<string>();

        yauzl.open(inpxPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                pipe.close();
                return;
            }

            if (!zipfile) {
                pipe.close();
                return;
            }

            console.log(`Opening INPX file: ${inpxPath}`);

            zipfile.readEntry();

            zipfile.on("entry", (entry) => {
                if (/\/$/.test(entry.fileName)) {
                    // Directory entry, skip
                    zipfile.readEntry();
                    return;
                }

                if (!entry.fileName.endsWith(".inp")) {
                    console.log(`Skipping non-INP file: ${entry.fileName}`);
                    zipfile.readEntry();
                    return;
                }

                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        console.error(`Error reading ${entry.fileName}:`, err);
                        zipfile.readEntry();
                        return;
                    }

                    if (!readStream) {
                        console.error(`No read stream for ${entry.fileName}`);
                        zipfile.readEntry();
                        return;
                    }

                    let content = "";

                    readStream.on("data", (chunk) => {
                        content += chunk.toString("utf8");
                    });

                    readStream.on("end", async () => {
                        try {
                            pipe.send(content);
                            console.log(
                                `Completed processing ${entry.fileName}`,
                            );
                        } catch (error) {
                            console.error(
                                `Error processing ${entry.fileName}:`,
                                error,
                            );
                        }
                        zipfile.readEntry();
                    });

                    readStream.on("error", (error) => {
                        console.error(
                            `Stream error for ${entry.fileName}:`,
                            error,
                        );
                        zipfile.readEntry();
                    });
                });
            });

            zipfile.on("end", () => {
                console.log("Finished processing all files in INPX archive");
                pipe.close();
            });

            zipfile.on("error", (error) => {
                console.error("ZIP file error:", error);
                pipe.close();
            });
        });

        return pipe.generator;
    }

    public async convertInpx(inpxPath: string): Promise<void> {
        const files = this.listFiles(inpxPath);

        for await (const content of files()) {
            await this.processInpFile(content);
        }
    }

    private processBatch(batch: BookSchema[]): void {
        this.db.exec("BEGIN TRANSACTION");
        try {
            for (const record of batch) {
                //(lib_id, book_title, book_author, book_genre, book_language, file_name, file_size,  file_location)

                const key = (record.book_author + " " + record.book_title)
                    .toLowerCase()
                    .replace(/[^\sa-z0-9а-я]/g, " ")
                    .split(" ")
                    .filter((x) => x.length)
                    .join(" ");
                try {
                    this.insertStmt.run(
                        record.lib_id,
                        record.book_title,
                        record.book_author,
                        record.book_genre,
                        record.book_language,
                        record.file_name,
                        record.file_size,
                        record.file_location,
                        key,
                    );
                } catch (error) {
                    if ((error as any).errcode !== 1555) {
                        throw error;
                    }
                }
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    public close(): void {
        this.db.close();
    }

    public getStats(): {
        totalBooks: number;
        uniqueAuthors: number;
    } {
        const totalBooks = this.db
            .prepare("SELECT COUNT(*) as count FROM books")
            .get() as { count: number };
        const uniqueAuthors = this.db
            .prepare("SELECT COUNT(DISTINCT book_author) as count FROM books")
            .get() as { count: number };

        return {
            totalBooks: totalBooks.count,
            uniqueAuthors: uniqueAuthors.count,
        };
    }
}

// Main execution
async function main(inpxPath: string) {
    const dbPath = path.join(process.cwd(), `flibusta.sqlite`);

    if (!fs.existsSync(inpxPath)) {
        console.error(`INPX file not found: ${inpxPath}`);
        process.exit(1);
    }

    console.log(`Converting ${inpxPath} to SQLite database: ${dbPath}`);

    const converter = new InpxToSqliteConverter(dbPath);

    try {
        await converter.convertInpx(inpxPath);

        const stats = converter.getStats();
        console.log("\nConversion completed successfully!");
        console.log(`Database stats:`);
        console.log(`  Total books: ${stats.totalBooks.toLocaleString()}`);
        console.log(
            `  Unique authors: ${stats.uniqueAuthors.toLocaleString()}`,
        );

        console.log(`\nDatabase saved to: ${dbPath}`);
    } catch (error) {
        console.error("Conversion failed:", error);
        process.exit(1);
    } finally {
        converter.close();
    }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    assert(process.env.ROOT);
    assert(process.env.INPX);
    const inpxFilename = path.join(process.env.ROOT, process.env.INPX);
    main(inpxFilename).catch(console.error);
}
