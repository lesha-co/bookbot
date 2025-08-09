import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { DatabaseSync } from "node:sqlite";
import makePipe from "@leshenka/callback-to-async-generator";
import assert from "node:assert";
import type { BookSchema } from "./schema.ts";
import { sanitize } from "./sanitize.ts";

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
            assert(fields[0]);
            // 1: GENRE
            // assert(fields[1]);
            // 2: TITLE
            assert(fields[2]);
            // 5: FILEname
            assert(fields[5]);
            // 6: SIZE
            assert(fields[6]);
            // 7: LIBID
            assert(fields[7]);
            // 9: EXTension
            assert(fields[9]);
            // 12: ZIP-file
            assert(fields[12]);
            // 13: Language
            // assert(fields[13]);
            return {
                book_author: fields[0],
                book_genre: fields[1] ?? null,
                book_title: fields[2],
                book_language: fields[13] ?? null,
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

                const key = sanitize(
                    record.book_author + " " + record.book_title,
                ).join(" ");
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
}

// Main execution
async function main(inpxPath: string) {
    assert(process.env.DBNAME);
    assert(process.env.ROOT);
    const tmpDBPath = path.join(process.env.ROOT, process.env.DBNAME + ".new");
    if (fs.existsSync(tmpDBPath)) {
        fs.unlinkSync(tmpDBPath);
    }
    const productionDBPath = path.join(process.env.ROOT, process.env.DBNAME);
    const productionDBBackupPath = path.join(
        process.env.ROOT,
        process.env.DBNAME + ".backup",
    );

    if (!fs.existsSync(inpxPath)) {
        console.error(`INPX file not found: ${inpxPath}`);
        process.exit(1);
    }

    console.log(`Converting ${inpxPath} to SQLite database: ${tmpDBPath}`);

    const converter = new InpxToSqliteConverter(tmpDBPath);

    try {
        await converter.convertInpx(inpxPath);
        console.log("\nConversion completed successfully!");
        console.log(`\nDatabase saved to: ${tmpDBPath}`);

        // Backup existing production database if it exists
        if (fs.existsSync(productionDBPath)) {
            fs.renameSync(productionDBPath, productionDBBackupPath);
            console.log(
                `\nBacked up existing database to: ${productionDBBackupPath}`,
            );
        }

        // Move temporary database to production location
        fs.copyFileSync(tmpDBPath, productionDBPath);
        fs.unlinkSync(tmpDBPath);
        console.log(
            `\nMoved database to production location: ${productionDBPath}`,
        );
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
