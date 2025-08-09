import { createMessage } from "@leshenka/telegram-bot-framework";
import type { TelegramDialogContext } from "./telegram/types.ts";
import assert from "node:assert";
import path from "node:path";
import { API } from "./api.ts";
import { BookSchema } from "./schema.ts";
assert(process.env.ROOT);
assert(process.env.DBNAME);

const databaseFilename = path.join(process.env.ROOT, process.env.DBNAME);
const api = new API(process.env.ROOT, databaseFilename);

export async function handler(ctx: TelegramDialogContext) {
    await ctx.send({ text: `Привет, ${ctx.user.first_name}!` });

    await ctx.send(
        createMessage(
            `Напиши запрос буквами и цифрами через пробелы без спецсимволов`,
            {
                removeKeyboard: true,
            },
        ),
    );

    const msg = await ctx.get();
    await ctx.send({ text: "ищу" });

    const iterator = api.query_text(msg);

    const bookid = await selectBook(ctx, iterator);
    if (bookid === null) return;

    const book = api.getByID(bookid);

    const file = await api.retrieveFile(book);
    await ctx.send(
        createMessage(
            `Выбрана книга ${book.book_title}\nавтор ${book.book_author}`,
            {
                removeKeyboard: true,
            },
        ),
    );
    await ctx.sendDocument(file, undefined, {
        filename: book.file_name,
        contentType: "application/octet-stream",
    });
}

async function selectBook(
    ctx: TelegramDialogContext,
    iterator: Iterator<any, any, any>,
) {
    while (true) {
        const books = take(iterator, 5);
        if (books.length === 0) {
            await ctx.send({ text: "Больше результатов нет" });
            return null;
        }
        const buttons = books.map((book) => {
            return [
                {
                    text: `${book.lib_id} Книга "${book.book_title}", автор "${book.book_author}"`,
                },
            ];
        });

        const response = await ctx.input({
            text: "Выбери действие",
            options: {
                reply_markup: {
                    keyboard: [
                        ...buttons,
                        [{ text: "Ещё" }, { text: "Новый поиск" }],
                    ],
                },
            },
        } as const);
        if (response === "Ещё") continue;
        if (response === "Новый поиск") {
            return null;
        }
        const id = parseInt(response.split(" ")[0]!);
        return id;
    }
}

function take(iterator: Iterator<any, any, any>, size: number) {
    const books = [];
    for (let i = 0; i < size; i++) {
        const nxt = iterator.next();
        if (nxt.done) break;
        const book = BookSchema.parse(nxt.value);
        books.push(book);
    }
    return books;
}
