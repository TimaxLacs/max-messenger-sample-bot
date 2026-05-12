# max-messenger-sample-bot — ветка **`photo-change-max`**

Полный сценарий **MAX**: пользователь отправляет **фото** → меню (**фильтры** / **фоны**) → одна модификация → результат и реферальные сообщения через общий оркестратор.

Минимальная версия без меню и памятная открытка — в **`photo-change-min`**. Демонстрационный эхо-бот без оркестратора — в **`main`**.

Документация MAX: [dev.max.ru/docs](https://dev.max.ru/docs).

## Docker

```bash
cp .env.example .env
# BOT_TOKEN_MAX=… INTERNAL_TOKEN=… (+ LUKOSHKO_TOKEN при необходимости)

docker compose up -d --build
docker compose logs -f bot-max
```

Опционально разведите фильтры и фоны по разным базовым URL: `ORCHESTRATOR_URL_FILTERS`, `ORCHESTRATOR_URL_BACKGROUNDS` в `.env` (см. `src/bot2-full.mjs`).

## Структура

| Путь | Назначение |
|------|------------|
| `src/bot2-full.mjs` | Полный сценарий (фото сначала, затем callbacks) |
| `src/shared.mjs`, `src/orchestrator.mjs` | Утилиты и клиент оркестратора |
| `orchestrator/` | FastAPI + SQLite, Lukoshko / локальный fallback |

## Лицензия

MIT
