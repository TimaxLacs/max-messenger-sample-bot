import {
  orchestratorHealthy,
  QuotaExceededError,
  OrchestratorHttpError,
  submitPhotoJob,
  waitForResultBuffer,
  registerUser,
} from "./orchestrator.mjs";
import {
  processingKeys,
  orchSecrets,
  sendPhotoWithReferral,
  safeMessageText,
  parseSlashCommand,
  pickImageAttachment,
  fetchImagePayload,
  getBotLink,
} from "./shared.mjs";

const WELCOME_TEXT = [
  "Привет! 🕊️",
  "",
  "Отправь фото ветерана или памятный снимок — и получи праздничную открытку к 9 Мая.",
  "",
  "💡 Лимит: 1 открытка в сутки",
  "🎁 Приглашай близких — за каждого +1 генерация",
].join("\n");

const HELP_TEXT = [
  "**Как пользоваться:**",
  "",
  "Отправь одно фото (JPEG или PNG) — получишь праздничную открытку к 9 Мая.",
  "",
  "💡 **Лимит:** 1 открытка в сутки",
  "🎁 **+1 генерация:** поделись открыткой с близкими. Если кто-то откроет бота по ссылке из подписи — тебе зачислится дополнительная генерация.",
].join("\n");

/** @param {import('@maxhub/max-bot-api').Bot} bot */
export function attachHandlersBot3(bot) {
  const botToken = process.env.BOT_TOKEN?.trim();

  bot.on("bot_started", async (ctx) => {
    const invitedBy = ctx.startPayload;
    const userId = String(ctx.user?.user_id ?? "");
    if (invitedBy && invitedBy !== userId) {
      try {
        const { orchestratorUrl, internalToken } = orchSecrets();
        if (orchestratorUrl && internalToken) {
          await registerUser({ orchestratorUrl, internalToken, userId, invitedBy });
        }
      } catch (err) {
        console.error("[bot3] register_user:", err.message);
      }
    }
    await ctx.reply(WELCOME_TEXT, { format: "markdown" });
  });

  bot.on("message_created", async (ctx) => {
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) return;

    const text = safeMessageText(ctx.message);
    const { name: cmd } = parseSlashCommand(text);

    if (cmd === "start") {
      await ctx.reply(WELCOME_TEXT, { format: "markdown" });
      return;
    }

    if (cmd === "help") {
      await ctx.reply(HELP_TEXT, { format: "markdown" });
      return;
    }

    const attachment = pickImageAttachment(ctx.message);

    if (!attachment?.payload?.url) {
      if (cmd != null || text.length > 0) {
        await ctx.reply(
          "Отправь **фото** из галереи или файл JPEG/PNG — и я создам открытку.",
          { format: "markdown" },
        );
      }
      return;
    }

    const userId = String(ctx.user.user_id);
    if (processingKeys.has(userId)) return;

    processingKeys.add(userId);
    try {
      await ctx.sendAction("sending_photo");

      let bytes;
      try {
        bytes = await fetchImagePayload(attachment.payload.url, botToken);
      } catch {
        await ctx.reply("Не удалось загрузить фото. Попробуй ещё раз.");
        return;
      }

      const link = await getBotLink(ctx, userId).catch(() => null);
      const caption = link
        ? `🕊️ Открытка готова! С Днём Победы!\n\n🔗 [Создай свою открытку](${link})`
        : "🕊️ Открытка готова! С Днём Победы!";
      const followup = link
        ? [
            "🎁 **Получи +1 генерацию!**",
            "",
            "Поделись этой открыткой с близкими. Если кто-то откроет бота по ссылке из подписи и создаст свою — тебе автоматически зачислится дополнительная генерация.",
          ].join("\n")
        : null;

      const { orchestratorUrl, internalToken } = orchSecrets();

      if (!internalToken || !orchestratorUrl) {
        await sendPhotoWithReferral(ctx, bytes, caption, followup);
        return;
      }

      const isUp = await orchestratorHealthy(orchestratorUrl, 3500);
      if (!isUp) {
        await ctx.reply("Сервис временно недоступен. Попробуй позже.");
        return;
      }

      const jobId = await submitPhotoJob({ orchestratorUrl, internalToken, userId, imageBytes: bytes });

      let out;
      try {
        out = await waitForResultBuffer({ orchestratorUrl, internalToken, userId, jobId });
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          await ctx.reply(
            [
              "⏳ **Лимит на сегодня исчерпан.**",
              "",
              "Возвращайся завтра — или пригласи близкого человека по своей ссылке и получи +1 генерацию прямо сейчас!",
            ].join("\n"),
            { format: "markdown" },
          );
          return;
        }
        await ctx.reply("Что-то пошло не так при обработке. Попробуй позже.");
        return;
      }

      await sendPhotoWithReferral(ctx, out, caption, followup);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        await ctx.reply(
          ["⏳ **Лимит на сегодня исчерпан.**", "", "Пригласи друга — и получи +1 генерацию!"].join("\n"),
          { format: "markdown" },
        );
      } else {
        console.error("[bot3] error:", err);
        await ctx.reply("Произошла ошибка. Попробуй позже.");
      }
    } finally {
      processingKeys.delete(userId);
    }
  });
}
