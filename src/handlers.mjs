import { randomBytes } from "node:crypto";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keyboard } from "@maxhub/max-bot-api";
import {
  orchestratorHealthy,
  QuotaExceededError,
  OrchestratorHttpError,
  submitPhotoJob,
  waitForResultBuffer,
} from "./orchestrator.mjs";

const ALLOWED_UPDATES = [
  "message_created",
  "message_callback",
  "bot_started",
];

export { ALLOWED_UPDATES };

const processingKeys = new Set();

function orchSecrets() {
  return {
    orchestratorUrl: process.env.ORCHESTRATOR_URL?.trim() ?? "",
    internalToken: process.env.INTERNAL_TOKEN?.trim() ?? "",
  };
}

/**
 * @param {import('@maxhub/max-bot-api').Context} ctx
 * @param {Buffer} imageBytes
 * @param {string} replyText
 */
async function replyWithUploadedPhoto(ctx, imageBytes, replyText) {
  const tmpDir = await mkdtemp(join(tmpdir(), "max-bot-"));
  const filePath = join(tmpDir, `${randomBytes(8).toString("hex")}.jpg`);
  try {
    await writeFile(filePath, imageBytes);
    const uploaded = await ctx.api.uploadImage({ source: filePath });
    await ctx.reply(replyText, {
      attachments: [uploaded.toJson()],
      format: "markdown",
    });
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

/** Безопасный текст: на фото MAX иногда даёт body.text === null — bot.command это ломает */
function safeMessageText(message) {
  const raw = message?.body?.text;
  return typeof raw === "string" ? raw.trim() : "";
}

function parseSlashCommand(fullText) {
  if (!fullText.startsWith("/")) {
    return { name: null, rest: "" };
  }
  const body = fullText.slice(1);
  const [head, ...restParts] = body.split(/\s+/);
  const name = head.includes("@") ? head.split("@")[0].toLowerCase() : head.toLowerCase();
  return { name, rest: restParts.join(" ").trim() };
}

/**
 * @param {import('@maxhub/max-bot-api').Message} message
 */
export function pickImageAttachment(message) {
  const list = message?.body?.attachments;
  if (!Array.isArray(list)) {
    return null;
  }
  const direct = list.find((a) => a?.type === "image") ?? null;
  if (direct?.payload?.url) {
    return direct;
  }
  return (
    list.find((a) => {
      if (a?.type !== "file") {
        return false;
      }
      const n = typeof a.filename === "string" ? a.filename.toLowerCase() : "";
      return /\.(jpe?g|png|webp)$/iu.test(n);
    }) ?? null
  );
}

async function fetchImagePayload(url, botToken) {
  const headers = {};
  if (process.env.MAX_IMAGE_USE_BOT_AUTH === "1" && botToken) {
    headers.Authorization = botToken;
  }

  const res = await fetch(url, { redirect: "follow", headers });
  if (!res.ok) {
    throw new Error(`download_image_${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 */
export function attachHandlers(bot) {
  const botToken = process.env.BOT_TOKEN?.trim();

  bot.on("bot_started", async (ctx) => {
    await ctx.reply("Отправь фото для открытки к 9 Мая. Команды: /start, /help", { format: "markdown" });
  });

  bot.action("ping", async (ctx) => {
    await ctx.answerOnCallback({ notification: "pong" });
    await ctx.reply("pong", {
      link: { type: "reply", mid: ctx.message.body.mid },
    });
  });

  bot.on("message_created", async (ctx) => {
    if (!ctx.user?.user_id || ctx.user.user_id === ctx.myId) {
      return;
    }

    const text = safeMessageText(ctx.message);
    const { name: cmd, rest } = parseSlashCommand(text);

    if (cmd === "start") {
      const keyboard = Keyboard.inlineKeyboard([[Keyboard.button.callback("Ping", "ping")]]);
      await ctx.reply(
        [
          "**MAX-бот**: приём фото, передача в оркестратор, получение результата — всё в этом репозитории.",
          "",
          "**Генерация** (Pillow / внешний ИИ) выполняется в сервисе **orchestrator** (нужны `INTERNAL_TOKEN` + `ORCHESTRATOR_URL`).",
          "",
          "Если **INTERNAL_TOKEN** не задан — бот **возвращает исходное фото** без обработки (режим проверки интеграции).",
          "",
          "**Открытка к 9 мая** — отправь одно фото из галереи.",
          "**Лимит** на оркестраторе: 1 обработка на пользователя за сутки (календарь Москвы).",
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
          "Отправь **одно изображение** (JPEG/PNG из галереи или файл с тем же расширением).",
          "Без **INTERNAL_TOKEN** бот вернёт **то же фото** без генерации.",
          "С токеном и оркестратором — обработка и лимит на бэкенде.",
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
          "Пришли **изображением** одно фото (JPEG или PNG из галереи либо как файл `.jpg`/`.png`).",
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
            "Повтори попытку. Если не поможет — в `.env`/compose для бота выставь `MAX_IMAGE_USE_BOT_AUTH=1`.",
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
          "Задан **INTERNAL_TOKEN**, но не задан **ORCHESTRATOR_URL**. Укажи адрес сервиса оркестратора в окружении бота.",
          { format: "markdown" },
        );
        return;
      }

      const isUp = await orchestratorHealthy(orchestratorUrl, 3500);
      if (!isUp) {
        await ctx.reply(
          [
            "Не удаётся связаться с **оркестратором** (проверка /health не прошла).",
            "Попробуй позже или проверь, что сервис `orchestrator` запущен и `ORCHESTRATOR_URL` верный.",
          ].join("\n"),
          { format: "markdown" },
        );
        return;
      }

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
