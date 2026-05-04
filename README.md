# max-messenger-sample-bot

Пример чат-бота для мессенджера **[MAX](https://max.ru)** на официальной библиотеке [@maxhub/max-bot-api](https://www.npmjs.com/package/@maxhub/max-bot-api). Подходит для локальных тестов (long polling) и боевого развёртывания (HTTPS webhook).

Подробности платформы: [dev.max.ru/docs](https://dev.max.ru/docs), API: [dev.max.ru/docs-api](https://dev.max.ru/docs-api).

## Возможности примера

- Команды `/start`, `/help`, `/echo`
- Inline-кнопки (callback + ссылка)
- Событие `bot_started` (диплинк `https://max.ru/<ник_бота>?start=...`)
- Режим **long polling** для разработки
- Режим **webhook** + скрипт регистрации `POST /subscriptions`

## Требования

- Node.js **≥ 18.18**
- Бот создан на [business.max.ru/self](https://business.max.ru/self), пройдена модерация, есть **токен** (Чат-боты → Интеграция → Получить токен)

## Быстрый старт (long polling)

```bash
git clone https://github.com/TimaxLacs/max-messenger-sample-bot.git
cd max-messenger-sample-bot
cp .env.example .env
# Впишите BOT_TOKEN в .env

npm install
npm start
```

Откройте диалог с ботом в MAX и отправьте `/start`.

## Webhook (production)

По [документации](https://dev.max.ru/docs-api/methods/POST/subscriptions) endpoint должен быть доступен по **HTTPS на порту 443**, сертификат от доверенного УЦ, ответ **200** в течение **30** секунд. Рекомендуется задать `WEBHOOK_SECRET` и проверять заголовок `X-Max-Bot-Api-Secret`.

1. Задайте в `.env`: `BOT_TOKEN`, `WEBHOOK_SECRET`, при необходимости `PORT` и `WEBHOOK_PATH`.
2. Запустите процесс за reverse proxy с TLS (443) на приложение (`npm run webhook`).
3. Зарегистрируйте URL у MAX:

```bash
npm run register-webhook -- https://your-domain.com/webhook
```

Long polling и webhook **нельзя** использовать одновременно: при активной подписке polling не получит обновления.

## Структура

| Файл | Назначение |
|------|------------|
| `src/handlers.mjs` | Сценарии и обработчики |
| `src/polling.mjs` | Запуск с long polling |
| `src/webhook.mjs` | HTTP-сервер для webhook + `/health` |
| `src/registerWebhook.mjs` | Вызов `POST https://platform-api.max.ru/subscriptions` |

## Ограничения API

- Ориентир **~30 RPS** на `platform-api.max.ru` ([обзор API](https://dev.max.ru/docs-api)).
- Токен передаётся в заголовке `Authorization`, не публикуйте его ([подготовка бота](https://dev.max.ru/docs/chatbots/bots-coding/prepare)).

## Лицензия

MIT
