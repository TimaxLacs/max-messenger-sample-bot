import { Keyboard } from "@maxhub/max-bot-api";
import {
  safeMessageText,
  parseSlashCommand,
  pickImageAttachment,
  fetchImagePayload,
  replyWithUploadedPhoto,
} from "./shared.mjs";

/**
 * Образец бота для MAX: приветствие, inline-кнопки, echo текста и фото без бэкенда.
 * @param {import('@maxhub/max-bot-api').Bot} bot
 */
export function attachHandlersDemo(bot) {
  const botToken = process.env.BOT_TOKEN?.trim();

  async function sendWelcome(ctx) {
    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback("Ping", "demo_ping")],
      [Keyboard.button.callback("О боте", "demo_about")],
    ]);
    await ctx.reply(
      [
        "**Демо-бот для MAX**",
        "",
        "Проверка текста, **callback-кнопок** и отправки изображений.",
        "",
        "• Напиши **ping** или нажми **Ping**",
        "• **/echo текст** — верну строку обратно",
        "• Пришли **фото** — верну то же изображение (**эхо**)",
      ].join("\n"),
      { format: "markdown", attachments: [keyboard] },
    );
  }

  bot.on("bot_started", async (ctx) => {
    await sendWelcome(ctx);
  });

  bot.action("demo_ping", async (ctx) => {
    await ctx.answerOnCallback({ notification: "pong" });
    await ctx.reply("**pong**", { format: "markdown" });
  });

  bot.action("demo_about", async (ctx) => {
    await ctx.answerOnCallback();
    await ctx.reply(
      [
        "Это **учебный образец**: Long Polling / Webhook, без сервера-оркестратора.",
        "",
        "Продакшен-ветки:",
        "**photo-change-min** — фото через оркестратор (+ открытка 9 Мая).",
        "**photo-change-max** — фото → меню фильтр/фон → оркестратор.",
      ].join("\n"),
      { format: "markdown" },
    );
  });

  bot.on("message_created", async (ctx) => {
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) return;

    const text = safeMessageText(ctx.message);
    const { name: cmd, rest } = parseSlashCommand(text);

    if (cmd === "start") {
      await sendWelcome(ctx);
      return;
    }

    if (cmd === "help") {
      await ctx.reply(
        [
          "**Команды**",
          "",
          "`/start` — приветствие и кнопки",
          "`/help` — эта справка",
          "`/echo` … — эхо текста",
          "",
          "**Фото**: отправь изображением или файлом JPEG/PNG — верну без изменений.",
        ].join("\n"),
        { format: "markdown" },
      );
      return;
    }

    if (/^ping$/iu.test(text.trim())) {
      await ctx.reply("ok");
      return;
    }

    if (cmd === "echo") {
      const payload = rest.trim();
      if (!payload) {
        await ctx.reply("Укажи текст после команды: `/echo привет`", { format: "markdown" });
        return;
      }
      await ctx.reply(payload);
      return;
    }

    const attachment = pickImageAttachment(ctx.message);

    if (!attachment?.payload?.url) {
      if (cmd != null || text.length > 0) {
        await ctx.reply(
          "Попробуй `/start`, **ping**, `/echo привет` или пришли **фото**.",
          { format: "markdown" },
        );
      }
      return;
    }

    let bytes;
    try {
      bytes = await fetchImagePayload(attachment.payload.url, botToken);
    } catch {
      await ctx.reply("Не удалось скачать фото из MAX. Повтори попытку.");
      return;
    }

    await replyWithUploadedPhoto(ctx, bytes, "Эхо: изображение возвращено без изменений.");
  });
}
