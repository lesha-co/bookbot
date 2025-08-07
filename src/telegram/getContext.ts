import TelegramBot from "node-telegram-bot-api";
import type { TelegramDialogContext } from "./types.ts";
import type { Meta } from "telegram-bot-framework-state-machine";
import { logMessage } from "./logMessage.ts";

export function getContext(
    bot: TelegramBot,
    iterator: AsyncIterableIterator<TelegramBot.Message>,
    meta: Meta,
): TelegramDialogContext {
    const user = meta.user;
    if (user === undefined) throw new Error("User not found");

    let context: TelegramDialogContext = {
        async send(s) {
            let msg = structuredClone(s);
            logMessage(user, "out", msg.text ?? "<no text>");
            await bot.sendMessage(
                meta.chat.id,
                msg.text ?? "no text",
                msg.options,
            );
        },

        async get() {
            const r = await iterator.next();
            if (r.done) {
                throw new Error("No more messages");
            }
            logMessage(user, "in", r.value.text ?? "<no text>");
            return r.value.text ?? "";
        },

        async sendDocument(buffer, options, fileOptions) {
            await bot.sendDocument(meta.chat.id, buffer, options, fileOptions);
        },

        async input(msg) {
            const responses = (
                "keyboard" in msg.options.reply_markup
                    ? msg.options.reply_markup.keyboard
                    : []
            )
                .flat()
                .map((x) => x.text);

            while (true) {
                await context.send(msg);
                const reply = await context.get();
                if (responses.includes(reply)) {
                    return reply;
                }
            }
        },
        user,
    };
    return context;
}
