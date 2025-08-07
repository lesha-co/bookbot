import { BookSchema } from "./schema.ts";
import sqlite from "node:sqlite";
import path from "node:path";
import yauzl from "yauzl";
export class API {
    private db: sqlite.DatabaseSync;
    private query: sqlite.StatementSync;
    private root: string;

    constructor(root: string, databaseFilename: string) {
        this.db = new sqlite.DatabaseSync(databaseFilename);
        this.query = this.db.prepare("SELECT * FROM books WHERE lib_id = ?");
        this.root = root;
    }
    public sanitize(term: string) {
        const words = term
            .toLowerCase()
            .replace(/[^\sa-z0-9а-я]/g, "")
            .split(" ")
            .filter((x) => x.length);

        return words;
    }

    public query_text(q: string) {
        const words = this.sanitize(q);
        const statements = words
            .map((word) => `LOWER(key) LIKE '%${word}%'`)
            .join(" AND ");
        const query_text = `SELECT * FROM books WHERE ${statements}`;
        console.log(query_text);
        const db_query = this.db.prepare(query_text);
        return db_query.iterate();
    }
    public getByID(id: number) {
        // Query for lib_id=583311
        const result = this.query.get(id);
        const book = BookSchema.parse(result);
        return book;
    }

    public async retrieveFile(book: BookSchema): Promise<Buffer> {
        // read file on ROOT/book.file_location using yauzl
        const filePath = path.join(this.root, book.file_location);
        const targetFileName = book.file_name;

        return new Promise((resolve, reject) => {
            yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
                if (err) return reject(err);
                if (!zipfile)
                    return reject(new Error("Failed to open ZIP file"));

                zipfile.readEntry();
                zipfile.on("entry", (entry) => {
                    if (entry.fileName === targetFileName) {
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) return reject(err);
                            if (!readStream)
                                return reject(
                                    new Error("Failed to open read stream"),
                                );

                            const chunks: Buffer[] = [];
                            readStream.on("data", (chunk) =>
                                chunks.push(chunk),
                            );
                            readStream.on("end", () =>
                                resolve(Buffer.concat(chunks)),
                            );
                            readStream.on("error", reject);
                        });
                    } else {
                        zipfile.readEntry();
                    }
                });
                zipfile.on("end", () =>
                    reject(new Error(`File not found: ${targetFileName}`)),
                );
                zipfile.on("error", reject);
            });
        });
    }
}
