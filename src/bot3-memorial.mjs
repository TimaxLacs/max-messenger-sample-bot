import { Keyboard } from "@maxhub/max-bot-api";
import {
  orchestratorHealthy,
  QuotaExceededError,
  OrchestratorHttpError,
  submitPhotoJob,
  waitForResultBuffer,
} from "./orchestrator.mjs";
import {
  processingKeys,
  orchSecrets,
  replyWithUploadedPhoto,
  safeMessageText,
  parseSlashCommand,
  pickImageAttachment,
  fetchImagePayload,
} from "./shared.mjs";

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 */
export function attachHandlersBot3(bot) {
  const botToken = process.env.BOT_TOKEN?.trim();

  bot.on("bot_started", async (ctx) => {
    await ctx.reply("Отправь фото для создания памятной открытки к 9 Мая. Команды: /start, /help", { format: "markdown" });
  });

  bot.action("ping", async (ctx) => {
    await ctx.answerOnCallback({ notification: "pong" });
    await ctx.reply("pong", {
      link: { type: "reply", mid: ctx.message.body.mid },
    });
  });

  bot.on("message_created", async (ctx) => {
    console.error("-> [Bot3] Got message:", safeMessageText(ctx.message), "from", ctx.user?.user_id);
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) {
      return;
    }

    const text = safeMessageText(ctx.message);
    const { name: cmd, rest } = parseSlashCommand(text);

    if (cmd === "start") {
      const keyboard = Keyboard.inlineKeyboard([[Keyboard.button.callback("Ping", "ping")]]);
      await ctx.reply(
        [
          "**Памятная открытка к 9 мая** 🕊️",
          "",
          "Отправь фото, чтобы стилизовать его к празднику Великой Победы.",
          "Генерация выполняется на стороне оркестратора.",
          "",
          "**Лимит**: 1 обработка на пользователя за сутки.",
        ].join("\n"),
        { format: "markdown", attachments: [keyboard] },
      );
      return;
    }

    if (cmd === "help") {
      await ctx.reply(
        [
          "**Команды**",
          "/start — о проекте",
          "/help — эта справка",
          "",
          "Отправь **одно изображение** (JPEG/PNG из галереи).",
        ].join("\n"),
        { format: "markdown" },
      );
      return;
    }

    if (/^ping$/iu.test(text)) {
      await ctx.reply("ok");
      return;
    }

    if (cmd === "echo") {
      const payload = rest.trim();
      if (!payload) {
        await ctx.reply("Использование: /echo текст", { format: "markdown" });
      } else {
        await ctx.reply(payload);
      }
      return;
    }

    if (/^контекст$|^context$/iu.test(text)) {
      const marker = `\`chat_id: ${ctx.chatId}\`\n`;
      const userPart = ctx.user
        ? `user: ${ctx.user.name ?? ""} (${ctx.user.user_id})`
        : "user: неизвестен";
      await ctx.reply(`${marker}${userPart}`, { format: "markdown" });
      return;
    }

    const attachment = pickImageAttachment(ctx.message);

    if (!attachment?.payload?.url) {
      if (cmd != null || text.length > 0) {
        await ctx.reply(
          "Пришли **изображением** одно фото для памятной открытки.",
          { format: "markdown" },
        );
      }
      return;
    }

    const userKey = String(ctx.user.user_id);
    if (processingKeys.has(userKey)) {
      await ctx.reply("Уже обрабатываю твоё фото — подожди несколько секунд.");
      return;
    }

    processingKeys.add(userKey);
    try {
      await ctx.sendAction("sending_photo");

      let bytes;
      try {
        bytes = await fetchImagePayload(attachment.payload.url, botToken);
      } catch {
        await ctx.reply(
          [
            "Не удалось скачать фото из MAX.",
            "Повтори попытку.",
          ].join("\n"),
          { format: "markdown" },
        );
        return;
      }

      const { orchestratorUrl, internalToken } = orchSecrets();

      if (!internalToken) {
        await replyWithUploadedPhoto(
          ctx,
          bytes,
          "Переменная **INTERNAL_TOKEN** не задана — возвращаю **исходное фото** без обработки на оркестраторе.",
        );
        return;
      }

      if (!orchestratorUrl) {
        await ctx.reply(
          "Задан **INTERNAL_TOKEN**, но не задан **ORCHESTRATOR_URL**.",
          { format: "markdown" },
        );
        return;
      }

      const isUp = await orchestratorHealthy(orchestratorUrl, 3500);
      if (!isUp) {
        await ctx.reply(
          [
            "Не удаётся связаться с **оркестратором**.",
            "Попробуй позже.",
          ].join("\n"),
          { format: "markdown" },
        );
        return;
      }

      // We could add a preset field to the job if the orchestrator supports it
      const jobId = await submitPhotoJob({
        orchestratorUrl,
        internalToken,
        userId: userKey,
        imageBytes: bytes,
      });

      let out;
      try {
        out = await waitForResultBuffer({
          orchestratorUrl,
          internalToken,
          userId: userKey,
          jobId,
        });
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          await ctx.reply(String(err.message));
          return;
        }
        await ctx.reply(
          ["Не удалось получить результат с оркестратора.", "", `_${String(err.message).slice(0, 280)}_`].join("\n"),
          { format: "markdown" },
        );
        return;
      }

      await replyWithUploadedPhoto(ctx, out, "Готово! С Днём Победы! 🕊️");
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        await ctx.reply(err.message || "Лимит исчерпан.", { format: "markdown" });
      } else if (err instanceof OrchestratorHttpError) {
        await ctx.reply(`Ошибка бэкенда: ${String(err.message).slice(0, 400)}`, { format: "markdown" });
      } else {
        console.error(err);
        await ctx.reply("Внутренняя ошибка. Попробуй позже.", { format: "markdown" });
      }
    } finally {
      processingKeys.delete(userKey);
    }
  });
}
