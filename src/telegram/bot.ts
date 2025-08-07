import TelegramBot from "node-telegram-bot-api";
import {
    getBot,
    classifier,
    getConsumer,
} from "telegram-bot-framework-state-machine";
import type { Meta, StateMachine } from "telegram-bot-framework-state-machine";
import pipe from "callback-to-async-generator";
import { getContext } from "./getContext.ts";
import { handler } from "../handler.ts";
import type { TelegramDialogContext } from "./types.ts";

export async function start() {
    const bot = getBot();
    const p = pipe<TelegramBot.Message>();
    bot.on("message", p.send);

    const stateMachine: StateMachine<
        { id: "root"; transitions: "root" },
        TelegramDialogContext
    > = {
        states: {
            async root(ctx) {
                await handler(ctx);
                return { id: "root" };
            },
        },
        rootState: { id: "root" },
    };

    await classifier<TelegramBot.Message, Meta>(
        p.generator,
        (m) => m.chat.id,
        (m) => ({
            chat: m.chat,
            user: m.from,
        }),
        getConsumer(stateMachine, getContext(bot)),
    );
}
