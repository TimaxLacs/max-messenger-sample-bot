# max-messenger-sample-bot — ветка **`photo-change-min`**

Два сценария с **одним оркестратором**:

- **Минимальный** (`BOT_MODE=1`, сервис `bot-min`): фото → обработка через оркестратор, реферальные сообщения.
- **Памятная открытка** (`BOT_MODE=3`, сервис `bot-veteran`): то же по пайплайну, другая подача текста.

Общий демо-без продуктовой логики смотрите в **`main`**. Расширенный сценарий (фильтры и фоны после фото) — в ветке **`photo-change-max`**.

Документация MAX: [dev.max.ru/docs](https://dev.max.ru/docs), API: [dev.max.ru/docs-api](https://dev.max.ru/docs-api).

## Docker

```bash
cp .env.example .env
# Заполните BOT_TOKEN_MIN, BOT_TOKEN_VETERAN, INTERNAL_TOKEN (и при необходимости LUKOSHKO_TOKEN).

docker compose up -d --build
docker compose logs -f bot-min
```

Сервисы: `orchestrator`, `bot-min`, `bot-veteran`. Каждый бот — свой токен.

## Локально (два процесса)

**Оркестратор:**

```bash
cd orchestrator && python3 -m venv .venv && .venv/bin/pip install -e .
INTERNAL_TOKEN=mysecret DATA_DIR=./data .venv/bin/uvicorn may9_orchestrator.main:app --host 127.0.0.1 --port 8000
```

**Бот:**

```bash
npm install
export BOT_TOKEN=… INTERNAL_TOKEN=mysecret ORCHESTRATOR_URL=http://127.0.0.1:8000 BOT_MODE=1
npm start
```

Без `INTERNAL_TOKEN` бот возвращает исходное фото без вызова оркестратора.

## Структура

| Путь | Назначение |
|------|------------|
| `src/bot1-minimal.mjs` | Режим 1 |
| `src/bot3-memorial.mjs` | Режим 3 |
| `src/shared.mjs`, `src/orchestrator.mjs` | Общие утилиты и HTTP к оркестратору |
| `src/polling.mjs`, `src/webhook.mjs` | Long polling / webhook |
| `orchestrator/` | FastAPI + SQLite, квота, Lukoshko |

## Лицензия

MIT
