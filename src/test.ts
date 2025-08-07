import assert from "node:assert";
import { API } from "./api.ts";
import path from "node:path";
import { BookSchema } from "./schema.ts";
assert(process.env.ROOT);
assert(process.env.DBNAME);

const databaseFilename = path.join(process.env.ROOT, process.env.DBNAME);

const api = new API(process.env.ROOT, databaseFilename);

const x = api.query_text("На западном фронте ремарк");
for (let bk of x) {
    const book = BookSchema.safeParse(bk);
    if (book.success) {
        console.log(`${book.data.book_author} - ${book.data.book_title}`);
    } else {
        console.log(book);
    }
}
