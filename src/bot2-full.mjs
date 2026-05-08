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

const userStates = new Map();

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
    await sendMenu(ctx);
  });

  async function sendMenu(ctx) {
    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback("🎨 Фильтры", "opt_filters")],
      [Keyboard.button.callback("👤 Исторические личности", "opt_figures")],
      [Keyboard.button.callback("🖼 Фоны", "opt_backgrounds")],
      [Keyboard.button.callback("✍️ Надписи", "opt_texts")],
    ]);
    await ctx.reply(
      "Выбери функцию для обработки фото:",
      { format: "markdown", attachments: [keyboard] },
    );
  }

  bot.action(/^opt_(filters|figures|backgrounds|texts)$/, async (ctx) => {
    const userId = String(ctx.user?.user_id);
    const option = ctx.match[1];
    userStates.set(userId, option);
    const name = OPTION_NAMES[option] ?? option;
    await ctx.answerOnCallback({ notification: `Выбрано: ${name}` });
    await ctx.reply(
      `Выбрано: **${name}**\n\nТеперь отправь фото для обработки.`,
      { format: "markdown" },
    );
  });

  bot.on("message_created", async (ctx) => {
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) return;

    const text = safeMessageText(ctx.message);
    const { name: cmd } = parseSlashCommand(text);

    if (cmd === "start" || cmd === "menu") {
      await sendMenu(ctx);
      return;
    }

    if (cmd === "help") {
      await ctx.reply(
        [
          "**Как пользоваться:**",
          "",
          "1. Выбери функцию в меню (/menu)",
          "2. Отправь одно фото (JPEG или PNG)",
          "3. Получи обработанное изображение",
          "",
          "💡 **Лимит:** 1 обработка в сутки",
          "🎁 **+1 генерация:** поделись результатом с другом. Если он откроет бота по ссылке из подписи — тебе зачислится дополнительная генерация.",
        ].join("\n"),
        { format: "markdown" },
      );
      return;
    }

    const attachment = pickImageAttachment(ctx.message);

    if (!attachment?.payload?.url) {
      if (cmd != null || text.length > 0) {
        await ctx.reply(
          "Отправь **фото** из галереи. Если ещё не выбрал функцию — используй /menu.",
          { format: "markdown" },
        );
      }
      return;
    }

    const userId = String(ctx.user.user_id);
    const selectedOption = userStates.get(userId);

    if (!selectedOption) {
      await ctx.reply(
        "Сначала выбери функцию в меню — /menu.",
        { format: "markdown" },
      );
      return;
    }

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
      const optName = OPTION_NAMES[selectedOption] ?? selectedOption;
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

      const envKey = OPTION_ENV[selectedOption];
      const orchestratorUrl = (process.env[envKey] || process.env.ORCHESTRATOR_URL || "").trim();
      const internalToken = process.env.INTERNAL_TOKEN?.trim() ?? "";

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
              "Возвращайся завтра — или пригласи друга по своей реферальной ссылке и получи +1 генерацию прямо сейчас!",
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
        console.error("[bot2] error:", err);
        await ctx.reply("Произошла ошибка. Попробуй позже.");
      }
    } finally {
      processingKeys.delete(userId);
    }
  });
}
