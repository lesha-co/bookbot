import TelegramBot from "node-telegram-bot-api";
import {
    getBot,
    classifier,
    getConsumer,
} from "telegram-bot-framework-state-machine";
import type { Meta } from "telegram-bot-framework-state-machine";
import pipe from "callback-to-async-generator";
import { getContext } from "./getContext.ts";
import { handler } from "../handler.ts";

export async function start() {
    const bot = getBot();
    const p = pipe<TelegramBot.Message>();
    bot.on("message", p.send);

    await classifier<TelegramBot.Message, Meta>(
        p.generator,
        (m) => m.chat.id,
        (m) => ({
            chat: m.chat,
            user: m.from,
        }),
        async (iterator, meta) => {
            const context = getContext(bot, iterator(), meta);
            while (true) {
                await handler(context);
            }
        },
    );
}
