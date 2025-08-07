import {
    createMessage,
    type StateMachine,
} from "telegram-bot-framework-state-machine";
import type { TelegramDialogContext } from "./telegram/types.ts";

import assert from "node:assert";
import path from "node:path";

import { API } from "./api.ts";
import { BookSchema } from "./schema.ts";
assert(process.env.ROOT);
assert(process.env.DBNAME);

const databaseFilename = path.join(process.env.ROOT, process.env.DBNAME);

const api = new API(process.env.ROOT, databaseFilename);

const contentTypes = {
    fb2: "application/x-fictionbook+xml",
    pdf: "application/pdf",
    djvu: "image/vnd.djvu",
    epub: "application/epub+zip",
    zip: "application/zip",
    doc: "application/msword",
    rar: "application/vnd.rar",
    txt: "text/plain",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    rtf: "application/rtf",
    mobi: "application/x-mobipocket-ebook",
    chm: "application/vnd.ms-htmlhelp",
    htm: "text/html",
    djv: "image/vnd.djvu",
};

export const stateMachine: StateMachine<
    { id: "root"; transitions: "root" },
    TelegramDialogContext
> = {
    states: {
        async root({ send, user, get, sendDocument, input }) {
            await send({ text: `привет! ${user.first_name}` });

            await send(
                createMessage(
                    `Напиши запрос буквами и цифрами через пробелы без спецсимволов`,
                    {
                        md: true,
                        removeKeyboard: true,
                    },
                ),
            );

            const msg = await get();
            await send({ text: "ищу" });

            const iterator = api.query_text(msg);
            while (true) {
                const books = [];
                for (let i = 0; i < 5; i++) {
                    const nxt = iterator.next();
                    if (nxt.done) break;
                    const book = BookSchema.parse(nxt.value);
                    books.push(book);
                }
                if (books.length === 0) {
                    await send({ text: "Больше результатов нет" });
                    return { id: "root" };
                }
                const buttons = books.map((book) => {
                    return [
                        {
                            text: `${book.lib_id} Книга "${book.book_title}", автор "${book.book_author}"`,
                        },
                    ];
                });

                const response = await input({
                    text: "Выбери действие",
                    options: {
                        reply_markup: {
                            keyboard: [
                                ...buttons,
                                [{ text: "Ещё" }],
                                [{ text: "Новый поиск" }],
                            ],
                        },
                    },
                } as const);
                if (response === "Ещё") continue;
                if (response === "Новый поиск") {
                    return { id: "root" };
                }
                const id = parseInt(response.split(" ")[0]!);
                const book = api.getByID(id);

                const file = await api.retrieveFile(book);
                await send(
                    createMessage(
                        `Выбрана книга ${book.book_title}\nавтор ${book.book_author}`,
                        {
                            md: true,
                            removeKeyboard: true,
                        },
                    ),
                );
                await sendDocument(file, undefined, {
                    filename: book.file_name,
                    contentType: "application/octet-stream",
                });

                break;
            }

            return { id: "root" };
        },
    },
    rootState: { id: "root" },
};
