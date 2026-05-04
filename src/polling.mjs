import "dotenv/config";
import { Bot } from "@maxhub/max-bot-api";
import { ALLOWED_UPDATES } from "./shared.mjs";
import { attachHandlersBot1 } from "./bot1-minimal.mjs";
import { attachHandlersBot2 } from "./bot2-full.mjs";
import { attachHandlersBot3 } from "./bot3-memorial.mjs";

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error("Задайте BOT_TOKEN в .env (см. .env.example).");
  process.exit(1);
}

const internalTok = process.env.INTERNAL_TOKEN?.trim() ?? "";
const orchUrl = process.env.ORCHESTRATOR_URL?.trim() ?? "";

if (internalTok && !orchUrl) {
  console.error("Задан INTERNAL_TOKEN, но пустой ORCHESTRATOR_URL — укажите URL оркестратора.");
  process.exit(1);
}

if (!internalTok) {
  console.error("[max-messenger-bot] INTERNAL_TOKEN пустой — режим эхо: исходное фото без оркестратора.");
}

console.error(
  `[max-messenger-bot] ORCHESTRATOR_URL=${orchUrl || "(не используется)"} | pipeline=${internalTok ? "orchestrator" : "echo-original"}`,
);

const bot = new Bot(token);

bot.catch((err, ctx) => {
  console.error("Ошибка при обработке обновления:", err);
  console.error("update:", JSON.stringify(ctx?.update, null, 2));
});

const mode = process.env.BOT_MODE?.trim() || "1";
if (mode === "2") {
  console.error("[max-messenger-bot] Режим 2: Полный функционал");
  attachHandlersBot2(bot);
} else if (mode === "3") {
  console.error("[max-messenger-bot] Режим 3: Открытка к 9 мая");
  attachHandlersBot3(bot);
} else {
  console.error("[max-messenger-bot] Режим 1: Минимальный (по умолчанию)");
  attachHandlersBot1(bot);
}

process.on("SIGINT", () => {
  console.error("\nОстанавливаю long polling…");
  bot.stop();
  process.exit(0);
});

console.error("Запуск long polling (Ctrl+C для выхода)…");
await bot.start({ allowedUpdates: ALLOWED_UPDATES });
