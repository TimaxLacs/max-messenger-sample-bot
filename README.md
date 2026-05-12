# Ветка **`main`** — демонстрационный чат-бот для **MAX**

Минимальный пример на [@maxhub/max-bot-api](https://www.npmjs.com/package/@maxhub/max-bot-api): приветствие, **inline-кнопки** (callbacks), `/echo`, **эхо фото** обратно в чат. **Без** Python-оркестратора и внешней генерации.

Рабочие продуктовые варианты в отдельных ветках:

| Ветка | Содержимое |
|--------|-------------|
| **`photo-change-min`** | Минимальный бот и памятная открытка (9 Мая), общий `orchestrator/`, Docker (`bot-min` + `bot-veteran`) |
| **`photo-change-max`** | Фото → меню «фильтры / фоны» → один оркестратор, Docker (`bot-max`) |

Документация MAX: [dev.max.ru/docs](https://dev.max.ru/docs).

## Запуск (Docker)

```bash
cp .env.example .env
# BOT_TOKEN=<токен из business.max.ru>

docker compose up -d --build
docker compose logs -f bot
```

## Запуск локально

```bash
npm install
export BOT_TOKEN=…
npm start
```

При проблемах с загрузкой вложений: `MAX_IMAGE_USE_BOT_AUTH=1`.

## Webhook

Эндпойнты Express в `src/webhook.mjs`. Регистрация подписки MAX:

```bash
npm run register-webhook -- https://example.com/webhook
```

Используйте **HTTPS на 443** согласно [документации](https://dev.max.ru/docs-api/methods/POST/subscriptions).

## Структура (`main`)

| Файл | Назначение |
|------|------------|
| `src/bot-demo.mjs` | Сценарий демо (кнопки, текст, эхо фото) |
| `src/shared.mjs` | Парсинг сообщений и загрузка фото обратно в MAX |
| `src/polling.mjs`, `src/webhook.mjs` | Получение обновлений |
| `src/registerWebhook.mjs` | CLI для подписки на webhook |

## Лицензия

MIT
