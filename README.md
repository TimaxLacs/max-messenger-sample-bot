# max-messenger-sample-bot

Чат-бот для **[MAX](https://max.ru)** на [@maxhub/max-bot-api](https://www.npmjs.com/package/@maxhub/max-bot-api). В этом репозитории — **вся логика MAX**: диалог с пользователем, загрузка фото из сообщения, вызов бэкенда-**оркестратора**, ожидание результата, отправка готового изображения в чат.

**Генерация изображений** (оформление / внешний ИИ) выполняется только в каталоге **`orchestrator/`** (FastAPI + SQLite-квота). Контент и настройки оркестратора можно заменять, не трогая код бота.

Документация платформы: [dev.max.ru/docs](https://dev.max.ru/docs), API: [dev.max.ru/docs-api](https://dev.max.ru/docs-api).

## Возможности

- Фото пользователя → `POST …/internal/v1/jobs` → поллинг `GET …/internal/v1/jobs/{id}` → ответ пользователю с картинкой (**если задан непустой `INTERNAL_TOKEN` и доступен оркестратор**).
- Если **`INTERNAL_TOKEN` пустой** — после загрузки фото бот **отправляет то же изображение** обратно (проверка интеграции MAX без генерации).
- Если оркестратор недоступен (`GET /health`) — понятное сообщение, без списания квоты на стороне оркестратора при отсутствии запросов.
- Квота **1 обработка / пользователь / сутки** (Москва по умолчанию) реализована на оркестраторе.
- Команды `/start`, `/help`, `/echo`, «контекст»/`context`, callback **Ping**.
- Long polling или отдельно **webhook** (`src/webhook.mjs`).
- Известный нюанс MAX: сообщения только с фото могут содержать `body.text === null` — здесь команды разбираются **без** `bot.command()`, чтобы цепочка не падала (`src/handlers.mjs`).

## Требования

- Docker (рекомендуется) или Node **≥ 18.18** + Python **≥ 3.11** для ручного запуска оркестратора.
- Токен бота в [business.max.ru/self](https://business.max.ru/self) → Интеграция.

## Быстрый старт — Docker (бот + оркестратор)

```bash
cp .env.example .env
# BOT_TOKEN=a…  
# INTERNAL_TOKEN=случайная_длинная_строка  (можно оставить пустым — бот будет эхом возвращать исходное фото)

docker compose up --build -d
docker compose logs -f bot
```

Compose подставляет **`ORCHESTRATOR_URL=http://orchestrator:8000`** в сервис `bot`; в `.env` можно не заполнять `ORCHESTRATOR_URL`.

Опции оркестратора в `.env` / compose: см. блок `environment` у сервиса `orchestrator` (`AI_TRANSFORM_URL`, `MAX_PER_USER_PER_DAY`, и т.д.).

Если загрузка фото из CDN MAX падает — для бота: `MAX_IMAGE_USE_BOT_AUTH=1`.

### Старый ответ на фото или «тестовый бот» в /start

Современный текст при `/start` упоминает **оркестратор**, **INTERNAL_TOKEN** и режим без токена. Если вместо этого бот отвечает «**тестовый бот**» или просит **may9-max-ai** — где-то всё ещё крутится **устаревший код** (обычно: контейнер не пересобрали после `git pull`, или актуальный `main` так и **не отправлен на GitHub** при развёртывании через `clone`/`pull` из репозитория).

Часто просто запущен **старый контейнер**: образ не обновился сам.

```bash
docker compose build bot
docker compose up -d --force-recreate bot
```

В логах при старте должна быть строка **`pipeline=orchestrator`** или **`pipeline=echo-original`** (второе — когда `INTERNAL_TOKEN` пустой). Если текст не совпадает с ожиданием или внутри образа есть «демо»:

```bash
docker compose exec bot grep -n демо /app/src/handlers.mjs
```

При актуальной версии команда **ничего не выводит**.

## Локально без Docker (два процесса)

Терминал 1:

```bash
cd orchestrator
python3.11 -m venv .venv && .venv/bin/pip install -e .
INTERNAL_TOKEN=mysecret DATA_DIR=./data .venv/bin/uvicorn may9_orchestrator.main:app --host 127.0.0.1 --port 8000
```

Терминал 2:

```bash
npm install
export BOT_TOKEN=… INTERNAL_TOKEN=mysecret ORCHESTRATOR_URL=http://127.0.0.1:8000
npm start
```

Только проверка загрузки фото в MAX (**без оркестратора**): `export BOT_TOKEN=…` и не задавайте `INTERNAL_TOKEN` (или оставьте пустым).

## Webhook режима самого MAX (получение апдейтов)

По [документации](https://dev.max.ru/docs-api/methods/POST/subscriptions): HTTPS на **443**, доверенный сертификат, см. также `README` блок про webhook из прошлых версий и `registerWebhook.mjs`.

## Структура

| Компонент | Назначение |
|-----------|-------------|
| `src/handlers.mjs` | Логика чата MAX, пайплайн фото ↔ оркестратор |
| `src/orchestrator.mjs` | HTTP-клиент к оркестратору |
| `src/polling.mjs` | Запуск long polling |
| `orchestrator/` | Сервис генерации и квот (**не** код MAX-бота) |
| `src/webhook.mjs` | Альтернативный режим апдейтов MAX через Express |

## Ограничения API MAX

Ориентир **~30 RPS** на `platform-api.max.ru` ([обзор](https://dev.max.ru/docs-api)). Токен не публикуйте ([подготовка](https://dev.max.ru/docs/chatbots/bots-coding/prepare)).

## Лицензия

MIT
