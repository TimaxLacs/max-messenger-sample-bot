import "dotenv/config";
import { Bot } from "@maxhub/max-bot-api";
import { ALLOWED_UPDATES, attachHandlers } from "./handlers.mjs";

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error("Задайте BOT_TOKEN в .env (см. .env.example).");
  process.exit(1);
}

const bot = new Bot(token);

bot.catch((err, ctx) => {
  console.error("Ошибка при обработке обновления:", err);
  console.error("update:", JSON.stringify(ctx?.update, null, 2));
});

attachHandlers(bot);

process.on("SIGINT", () => {
  console.error("\nОстанавливаю long polling…");
  bot.stop();
  process.exit(0);
});

console.error("Запуск long polling (Ctrl+C для выхода)…");
await bot.start({ allowedUpdates: ALLOWED_UPDATES });
