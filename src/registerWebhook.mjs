/**
 * Регистрирует webhook в MAX API (POST /subscriptions).
 * Использование: npm run register-webhook -- https://example.com/webhook
 */
import "dotenv/config";

const token = process.env.BOT_TOKEN?.trim();
const secretFromEnv = process.env.WEBHOOK_SECRET?.trim();
const webhookUrl = process.argv[2]?.trim();

const UPDATE_TYPES = [
  "message_created",
  "message_callback",
  "bot_started",
];

if (!token) {
  console.error("Нужен BOT_TOKEN в .env");
  process.exit(1);
}

if (!webhookUrl?.startsWith("https://")) {
  console.error(
    "Укажите публичный HTTPS URL первым аргументом, например:\n" +
      "  npm run register-webhook -- https://bot.example.com/webhook",
  );
  process.exit(1);
}

const body = {
  url: webhookUrl,
  update_types: UPDATE_TYPES,
  ...(secretFromEnv ? { secret: secretFromEnv } : {}),
};

const res = await fetch("https://platform-api.max.ru/subscriptions", {
  method: "POST",
  headers: {
    Authorization: token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = text;
}

if (!res.ok) {
  console.error("Ошибка:", res.status, json);
  process.exit(1);
}

console.error("Подписка создана:", json);
if (!secretFromEnv) {
  console.warn(
    "WEBHOOK_SECRET не задан — рекомендуется задать в .env и повторить регистрацию.",
  );
}
