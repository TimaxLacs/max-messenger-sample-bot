import { Keyboard } from "@maxhub/max-bot-api";

export const ALLOWED_UPDATES = [
  "message_created",
  "message_callback",
  "bot_started",
];

export const processingKeys = new Set();

export function orchSecrets() {
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
export async function replyWithUploadedPhoto(ctx, imageBytes, replyText) {
  const uploaded = await ctx.api.uploadImage({ source: imageBytes });
  await ctx.reply(replyText, {
    attachments: [uploaded.toJson()],
    format: "markdown",
  });
}

/** Безопасный текст: на фото MAX иногда даёт body.text === null — bot.command это ломает */
export function safeMessageText(message) {
  const raw = message?.body?.text;
  return typeof raw === "string" ? raw.trim() : "";
}

export function parseSlashCommand(fullText) {
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

export async function fetchImagePayload(url, botToken) {
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
