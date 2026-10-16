# Архитектура интеграции Telegram (проект, этап 1)

Принцип: сайт — единственный источник данных. Бот — тонкий клиент: принимает команды и доставляет сообщения. Все решения о правах и статусах принимает backend сайта.

## Привязка аккаунта
1. `POST /api/account/telegram/code` (requireAuth, writeLimiter). Создаёт токен: `crypto.randomBytes(24).toString('base64url')` (32 символа, помещается в 64 символа payload). В `user_tokens` хранится `sha256`, `kind='telegram_link'`, TTL 10 минут; не чаще раза в 30 секунд; предыдущие неиспользованные токены пользователя гасятся. Ответ: `{ code, bot, url, expiresAt }` — `url = https://t.me/<bot>?start=<code>`. Клиент показывает кнопку «Открыть Telegram» и запасной вариант «отправьте `/start <код>`» (текущий UI).
2. Бот получает `/start <code>` (поддерживается и `link_<code>`), только в приватном чате, проверяет формат и вызывает `POST /api/integrations/telegram/confirm-link` с HMAC-подписью.
3. Backend в одной транзакции: `UPDATE user_tokens SET used_at=now() WHERE token_hash=$1 AND kind='telegram_link' AND used_at IS NULL AND expires_at>now() RETURNING user_id`; затем `UPDATE users SET telegram_id=$2, telegram_username=$3` (блокированных пользователей отклоняет). Уникальность `telegram_id` уже в схеме; если Telegram занят другим аккаунтом — `409`, пользователь должен сначала отвязать его там. Коды ответов: 404 нет токена, 410 истёк/использован, 409 занято.
4. `POST /api/account/telegram/check` — клиент опрашивает привязку; возвращает `{telegram:{username|null}}` по `telegram_id`.
5. `POST /api/account/telegram/unlink` — обнуляет `telegram_id/username`, гасит неотправленные сообщения этого получателя в outbox, шлёт боту «Telegram отвязан» (по возможности).
Telegram username не используется как идентификатор; клиент никогда не передаёт VAL user id.

## Сервисная аутентификация бот ↔ сайт
HMAC-SHA256 от `timestamp + "." + rawBody` общим секретом (`VAL_BOT_SHARED_SECRET`, ≥32 байт), заголовки `X-VAL-Timestamp`, `X-VAL-Signature`; окно ±5 минут; сравнение `timingSafeEqual`; для notify — ещё `eventKey`-идемпотентность на стороне бота. Секрет только в окружении. Внутренние маршруты `/api/integrations/*` — отдельный лимит, без cookie-сессий.

## Уведомления: transactional outbox
Таблица `notifications_outbox`: `id`, `event_key text UNIQUE` (например `reg.confirmed:<regId>:<paid_at>`), `kind`, `user_id` (FK CASCADE), `payload jsonb` (только структурные данные: slug, название, статус — не готовый текст), `status` (`pending|sending|sent|failed|dead|skipped`), `attempts`, `next_attempt_at`, `locked_at`, `sent_at`, `last_error` (без секретов), `created_at`.
- Запись делается в **той же транзакции**, что и бизнес-изменение (`withTx` уже используется в приглашениях, заявках, подтверждении оплаты); сейчас эти места — единственные точки хука.
- Получатели и настройки определяются при постановке: берутся пользователи с `telegram_id` и `notifications.<ключ>.tg = true` (по умолчанию как в `DEFAULT_N`).
- Воркер (в процессе сервера рядом с `sweepExpired`): `SELECT … FOR UPDATE SKIP LOCKED`, лимит пачки, экспоненциальный backoff, учёт `retry_after` Telegram (429), `403 bot was blocked` → `skipped` + пометка пользователя, максимум попыток → `dead`.
- Доставка: воркер вызывает `POST /internal/notify` бота с HMAC (токен бота остаётся только у бота). Бот форматирует текст по allowlist типов событий и принимает только ссылки на домен сайта.
- «Турнир завтра» — планировщик ставит события по `tournaments.starts_at` (с уникальным `event_key`, чтобы не дублировать).

## Бот
Telegraf, long polling по умолчанию (на этапе 1 выбор не окончательный: webhook имеет смысл, если у сайта уже есть публичный HTTPS-хост; решение — при подготовке деплоя). Команды `/start`, `/help`, `/privacy`, `/settings` (показ и переключение настроек через API), `/unlink`. Тексты на русском, `parse_mode` не используется (динамические данные экранируются для HTML, если понадобится). Цвета VAL используются в SVG-материалах; Telegram-сообщения графики не требуют.

## Что меняется в сайте (минимально)
`schema.sql`: новая таблица outbox (+ индексы); расширение zod `notifications` ключом `invites` (необязательным). `controllers/account.js`: три реальных обработчика вместо `soon`. `routes/`: новый `integrations.js`. `controllers/auth.js: publicUser`: признак привязки по `telegram_id`. Хуки `enqueue()` в 5–6 точках. Клиент: показать кнопку-ссылку и ключ `invites` в настройках. Публичные API и существующие сценарии не удаляются.

## Не делаем
Автоплатежи; матчи/результаты (нет системы); массовые рассылки; админ-команды в боте (пока нет потребности; проверка роли только на backend, если появятся); хранение чего-либо о пользователях в боте.
