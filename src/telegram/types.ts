import TelegramBot from "node-telegram-bot-api";

type SendOptions = {
    text: string;
    options?: TelegramBot.SendMessageOptions;
};

type SendOptionsKeyboard = {
    text: string;
    options: TelegramBot.SendMessageOptions & {
        reply_markup: TelegramBot.ReplyKeyboardMarkup;
    };
};

export type TelegramDialogContext = {
    user: TelegramBot.User;
    get: () => Promise<string>;
    send: (msg: SendOptions) => Promise<void>;
    sendDocument: (
        buffer: Buffer,
        options?: TelegramBot.SendDocumentOptions,
        fileOptions?: TelegramBot.FileOptions,
    ) => Promise<void>;
    input: <T extends SendOptionsKeyboard>(
        msg: T,
    ) => Promise<
        T["options"]["reply_markup"]["keyboard"][number][number]["text"]
    >;
};

export type Meta = {
    chat: TelegramBot.Chat;
    user: TelegramBot.User | undefined;
};
