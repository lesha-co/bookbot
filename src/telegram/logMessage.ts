import TelegramBot from "node-telegram-bot-api";

export function logMessage(
    user: TelegramBot.User,
    dir: "in" | "out",
    contents: string,
) {
    const d = dir === "in" ? " |>" : "<| ";
    const lines = contents.split("\n");
    const username = user.username ?? user.id.toString();
    const usernameSpaces = "".padStart(username.length);
    console.log(`${user.username} ${d} ${lines[0]}`);
    for (const line of lines.slice(1)) {
        console.log(`${usernameSpaces} ${d} ${line}`);
    }
}
