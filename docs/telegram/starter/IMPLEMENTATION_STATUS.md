# Статус архива

Включено: стартовый Node.js/Telegraf сервис, базовые команды, health endpoint, внутренний endpoint уведомлений с Bearer secret, SVG-активы, ТЗ, контракты и AI prompts.

Нужно реализовать в основном сайте: выпуск/подтверждение link tokens, таблицу связей Telegram, отвязку и настройки, доменные события, transactional outbox и worker доставки.

Нужно усилить перед production: постоянная идемпотентность, retries/backoff/dead-letter, HMAC/replay protection или service identity, automated tests, реальный тест с Telegram token и backend/PostgreSQL.

Реальный Telegram API, база данных и интеграционные тесты при подготовке архива не запускались. Не выдавать это за production-ready.
