import { Keyboard } from "@maxhub/max-bot-api";
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

const OPTION_NAMES = {
  filters: "🎨 Фильтры",
  figures: "👤 Исторические личности",
  backgrounds: "🖼 Фоны",
  texts: "✍️ Надписи",
};

const OPTION_ENV = {
  filters: "ORCHESTRATOR_URL_FILTERS",
  figures: "ORCHESTRATOR_URL_FIGURES",
  backgrounds: "ORCHESTRATOR_URL_BACKGROUNDS",
  texts: "ORCHESTRATOR_URL_TEXTS",
};

const PHOTO_CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { bytes: Buffer, cachedAt: number }>} */
const userPhotoCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [uid, { cachedAt }] of userPhotoCache) {
    if (now - cachedAt > PHOTO_CACHE_TTL_MS) userPhotoCache.delete(uid);
  }
}, 5 * 60 * 1000);

/** @param {import('@maxhub/max-bot-api').Bot} bot */
export function attachHandlersBot2(bot) {
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
        console.error("[bot2] register_user:", err.message);
      }
    }
    await ctx.reply(
      [
        "Привет! 👋",
        "",
        "Отправь фото — и я предложу варианты обработки: фильтры, фоны, исторические образы, надписи.",
        "",
        "💡 Лимит: 1 обработка в сутки",
        "🎁 Приглашай друзей — за каждого +1 генерация",
      ].join("\n"),
      { format: "markdown" },
    );
  });

  async function sendModificationMenu(ctx) {
    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback("🎨 Фильтры", "opt_filters")],
      [Keyboard.button.callback("👤 Исторические личности", "opt_figures")],
      [Keyboard.button.callback("🖼 Фоны", "opt_backgrounds")],
      [Keyboard.button.callback("✍️ Надписи", "opt_texts")],
    ]);
    await ctx.reply(
      "Фото получено! Выбери модификацию:",
      { format: "markdown", attachments: [keyboard] },
    );
  }

  bot.action(/^opt_(filters|figures|backgrounds|texts)$/, async (ctx) => {
    const userId = String(ctx.user?.user_id);
    const option = ctx.match[1];

    const cached = userPhotoCache.get(userId);
    if (!cached) {
      await ctx.answerOnCallback({ notification: "Сначала отправь фото" });
      await ctx.reply("Сначала отправь фото — и я покажу варианты обработки.", { format: "markdown" });
      return;
    }

    if (processingKeys.has(userId)) {
      await ctx.answerOnCallback({ notification: "Уже обрабатываю..." });
      return;
    }

    const optName = OPTION_NAMES[option] ?? option;
    await ctx.answerOnCallback({ notification: `Применяю: ${optName}` });

    processingKeys.add(userId);
    try {
      await ctx.sendAction("sending_photo");

      const link = await getBotLink(ctx, userId).catch(() => null);
      const caption = link
        ? `✨ Готово! (${optName})\n\n🔗 [Создай своё изображение](${link})`
        : `✨ Готово! (${optName})`;
      const followup = link
        ? [
            "🎁 **Получи +1 генерацию!**",
            "",
            "Поделись этим изображением с другом. Если он откроет бота по ссылке из подписи и создаст своё — тебе автоматически зачислится дополнительная генерация.",
          ].join("\n")
        : null;

      const envKey = OPTION_ENV[option];
      const orchestratorUrl = (process.env[envKey] || process.env.ORCHESTRATOR_URL || "").trim();
      const internalToken = process.env.INTERNAL_TOKEN?.trim() ?? "";

      if (!internalToken || !orchestratorUrl) {
        await sendPhotoWithReferral(ctx, cached.bytes, caption, followup);
        userPhotoCache.delete(userId);
        return;
      }

      const isUp = await orchestratorHealthy(orchestratorUrl, 3500);
      if (!isUp) {
        await ctx.reply("Сервис временно недоступен. Попробуй позже.");
        return;
      }

      const jobId = await submitPhotoJob({
        orchestratorUrl,
        internalToken,
        userId,
        imageBytes: cached.bytes,
      });

      let out;
      try {
        out = await waitForResultBuffer({ orchestratorUrl, internalToken, userId, jobId });
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          await ctx.reply(
            [
              "⏳ **Лимит на сегодня исчерпан.**",
              "",
              "Возвращайся завтра — или пригласи друга по своей реферальной ссылке и получи +1 генерацию прямо сейчас!",
            ].join("\n"),
            { format: "markdown" },
          );
          return;
        }
        await ctx.reply("Что-то пошло не так при обработке. Попробуй позже.");
        return;
      }

      userPhotoCache.delete(userId);
      await sendPhotoWithReferral(ctx, out, caption, followup);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        await ctx.reply(
          ["⏳ **Лимит на сегодня исчерпан.**", "", "Пригласи друга — и получи +1 генерацию!"].join("\n"),
          { format: "markdown" },
        );
      } else {
        console.error("[bot2] error:", err);
        await ctx.reply("Произошла ошибка. Попробуй позже.");
      }
    } finally {
      processingKeys.delete(userId);
    }
  });

  bot.on("message_created", async (ctx) => {
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) return;

    const text = safeMessageText(ctx.message);
    const { name: cmd } = parseSlashCommand(text);

    if (cmd === "start" || cmd === "menu") {
      await ctx.reply(
        [
          "**Как пользоваться:**",
          "",
          "Отправь фото — и выбери одну из модификаций: фильтры, фоны, исторические образы или надпись.",
          "",
          "💡 **Лимит:** 1 обработка в сутки",
          "🎁 **+1 генерация:** поделись результатом с другом. Если он откроет бота по ссылке из подписи — тебе зачислится бонус.",
        ].join("\n"),
        { format: "markdown" },
      );
      return;
    }

    if (cmd === "help") {
      await ctx.reply(
        [
          "**Как пользоваться:**",
          "",
          "1. Отправь одно фото (JPEG или PNG)",
          "2. Выбери модификацию из меню",
          "3. Получи обработанное изображение",
          "",
          "💡 **Лимит:** 1 обработка в сутки",
          "🎁 **+1 генерация:** поделись результатом — если друг откроет бота по ссылке из подписи, тебе зачислится бонус.",
        ].join("\n"),
        { format: "markdown" },
      );
      return;
    }

    const attachment = pickImageAttachment(ctx.message);

    if (!attachment?.payload?.url) {
      if (cmd != null || text.length > 0) {
        await ctx.reply(
          "Отправь **фото** из галереи — и я покажу варианты обработки.",
          { format: "markdown" },
        );
      }
      return;
    }

    const userId = String(ctx.user.user_id);
    if (processingKeys.has(userId)) return;

    processingKeys.add(userId);
    let bytes;
    try {
      await ctx.sendAction("sending_photo");
      bytes = await fetchImagePayload(attachment.payload.url, botToken);
    } catch {
      await ctx.reply("Не удалось загрузить фото. Попробуй ещё раз.");
      processingKeys.delete(userId);
      return;
    }
    processingKeys.delete(userId);

    userPhotoCache.set(userId, { bytes, cachedAt: Date.now() });
    await sendModificationMenu(ctx);
  });
}
