import "dotenv/config";
import express from "express";
import { Bot, Context } from "@maxhub/max-bot-api";
import { ALLOWED_UPDATES, attachHandlers } from "./handlers.mjs";

const token = process.env.BOT_TOKEN?.trim();
const secretFromEnv = process.env.WEBHOOK_SECRET?.trim();
const port = parseInt(String(process.env.PORT ?? "8080"), 10);
const path = process.env.WEBHOOK_PATH ?? "/webhook";

if (!token) {
  console.error("Задайте BOT_TOKEN в .env.");
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

attachHandlers(bot);

bot.botInfo = await bot.api.getMyInfo();
const middleware = bot.middleware();

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.send("ok");
});

app.post(path, async (req, res) => {
  if (secretFromEnv) {
    const header = req.get("x-max-bot-api-secret");
    if (header !== secretFromEnv) {
      res.sendStatus(401);
      return;
    }
  }

  try {
    const update = req.body;
    await Promise.resolve().then(async () => {
      const ctx = new Context(update, bot.api, bot.botInfo);
      await middleware(ctx, () => Promise.resolve(undefined));
    });
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.error(
    `Webhook слушает http://0.0.0.0:${port}${path} (перед продом — HTTPS :443 и register-webhook)`,
  );
});
