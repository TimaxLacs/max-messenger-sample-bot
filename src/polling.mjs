import "dotenv/config";
import { Bot } from "@maxhub/max-bot-api";
import { ALLOWED_UPDATES } from "./shared.mjs";
import { attachHandlersDemo } from "./bot-demo.mjs";

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error("[demo] Задайте BOT_TOKEN в .env (см. .env.example).");
  process.exit(1);
}

console.error("[demo] Простейший образец для MAX — без оркестратора, только эхо и кнопки.");

const bot = new Bot(token);

bot.catch((err, ctx) => {
  console.error("Ошибка при обработке обновления:", err);
  console.error("update:", JSON.stringify(ctx?.update, null, 2));
});

attachHandlersDemo(bot);

process.on("SIGINT", () => {
  console.error("\nОстанавливаю long polling…");
  bot.stop();
  process.exit(0);
});

console.error("Запуск long polling (Ctrl+C для выхода)…");
await bot.start({ allowedUpdates: ALLOWED_UPDATES });
