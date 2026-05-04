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

const userStates = new Map();

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 */
export function attachHandlersBot2(bot) {
  const botToken = process.env.BOT_TOKEN?.trim();

  bot.on("bot_started", async (ctx) => {
    await sendMenu(ctx);
  });

  async function sendMenu(ctx) {
    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback("🎨 Фильтры", "opt_filters")],
      [Keyboard.button.callback("👤 Исторические личности", "opt_figures")],
      [Keyboard.button.callback("🖼 Фоны", "opt_backgrounds")],
      [Keyboard.button.callback("✍️ Надписи", "opt_texts")],
    ]);

    await ctx.reply("Выбери функцию для генерации:", {
      format: "markdown",
      attachments: [keyboard],
    });
  }

  // Handle option selections
  bot.action(/^opt_(filters|figures|backgrounds|texts)$/, async (ctx) => {
    const userId = String(ctx.user?.user_id);
    const option = ctx.match[1];
    userStates.set(userId, option);

    let optionName = "";
    if (option === "filters") optionName = "Фильтры";
    if (option === "figures") optionName = "Исторические личности";
    if (option === "backgrounds") optionName = "Фоны";
    if (option === "texts") optionName = "Надписи";

    await ctx.answerOnCallback({ notification: `Выбрано: ${optionName}` });
    await ctx.reply(`Вы выбрали: **${optionName}**.\nТеперь отправьте фото для обработки.`, { format: "markdown" });
  });

  bot.action("ping", async (ctx) => {
    await ctx.answerOnCallback({ notification: "pong" });
    await ctx.reply("pong", {
      link: { type: "reply", mid: ctx.message.body.mid },
    });
  });

  bot.on("message_created", async (ctx) => {
    const userId = String(ctx.user?.user_id);
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) {
      return;
    }

    const text = safeMessageText(ctx.message);
    const { name: cmd, rest } = parseSlashCommand(text);

    if (cmd === "start" || cmd === "menu") {
      await sendMenu(ctx);
      return;
    }

    if (cmd === "help") {
      await ctx.reply(
        [
          "**Команды**",
          "/start, /menu — главное меню",
          "/help — эта справка",
          "",
          "Сначала выбери функцию через меню, затем отправь **одно изображение**.",
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

    const attachment = pickImageAttachment(ctx.message);

    if (!attachment?.payload?.url) {
      if (cmd != null || text.length > 0) {
        await ctx.reply(
          "Пришли **изображением** фото. Если ещё не выбрал функцию — используй /menu",
          { format: "markdown" },
        );
      }
      return;
    }

    const selectedOption = userStates.get(userId);
    if (!selectedOption) {
      await ctx.reply("Сначала выбери функцию в меню (/menu), а затем отправляй фото.", { format: "markdown" });
      return;
    }

    if (processingKeys.has(userId)) {
      await ctx.reply("Уже обрабатываю твоё фото — подожди несколько секунд.");
      return;
    }

    processingKeys.add(userId);
    try {
      await ctx.sendAction("sending_photo");

      let bytes;
      try {
        bytes = await fetchImagePayload(attachment.payload.url, botToken);
      } catch {
        await ctx.reply("Не удалось скачать фото из MAX. Повтори попытку.");
        return;
      }

      // Determine Orchestrator URL based on selected option
      // Fallback to ORCHESTRATOR_URL if specific is not set
      let specificUrlEnv = "";
      if (selectedOption === "filters") specificUrlEnv = "ORCHESTRATOR_URL_FILTERS";
      if (selectedOption === "figures") specificUrlEnv = "ORCHESTRATOR_URL_FIGURES";
      if (selectedOption === "backgrounds") specificUrlEnv = "ORCHESTRATOR_URL_BACKGROUNDS";
      if (selectedOption === "texts") specificUrlEnv = "ORCHESTRATOR_URL_TEXTS";

      const orchestratorUrl = (process.env[specificUrlEnv] || process.env.ORCHESTRATOR_URL || "").trim();
      const internalToken = process.env.INTERNAL_TOKEN?.trim() ?? "";

      if (!internalToken) {
        await replyWithUploadedPhoto(
          ctx,
          bytes,
          `Режим эхо. Выбрана функция: **${selectedOption}**. Переменная INTERNAL_TOKEN не задана — возвращаю исходное фото.`,
        );
        return;
      }

      if (!orchestratorUrl) {
        await ctx.reply(
          `Не задан **${specificUrlEnv}** (и нет резервного **ORCHESTRATOR_URL**). Укажи адрес в окружении.`,
          { format: "markdown" },
        );
        return;
      }

      const isUp = await orchestratorHealthy(orchestratorUrl, 3500);
      if (!isUp) {
        await ctx.reply("Не удаётся связаться с **оркестратором** (сервис недоступен).", { format: "markdown" });
        return;
      }

      // Pass preset based on option if supported by orchestrator
      const jobId = await submitPhotoJob({
        orchestratorUrl,
        internalToken,
        userId: userId,
        imageBytes: bytes,
        // Optional: you could pass preset: selectedOption here if submitPhotoJob supported it
      });

      let out;
      try {
        out = await waitForResultBuffer({
          orchestratorUrl,
          internalToken,
          userId: userId,
          jobId,
        });
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          await ctx.reply(String(err.message));
          return;
        }
        await ctx.reply(["Не удалось получить результат с оркестратора.", "", `_${String(err.message).slice(0, 280)}_`].join("\n"), { format: "markdown" });
        return;
      }

      await replyWithUploadedPhoto(ctx, out, "Готово! Обработка завершена. 🕊️");
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
      processingKeys.delete(userId);
    }
  });
}
