# Контекст VAL

Репозиторий: https://github.com/SetchatkaGlaza/val-league

По README и package manifests: npm workspaces `client` и `server`; клиент — Vite + нативный JavaScript SPA; backend — Node.js, Express, ES modules; БД — PostgreSQL (`pg`). В backend уже используются middleware/пакеты для безопасности, валидации, авторизации и email. Проектная документация сайта находится в `docs/` и включает AUTH, DATABASE, RUN, ROADMAP, TEAMS, TOURNAMENTS, REGISTRATION.

Описанные функции: аккаунты и email-потоки, команды/составы/капитаны/приглашения, турниры, заявки и лист ожидания, ручное подтверждение оплаты. Это описано в репозитории, но любые изменения надо сверить с реальным кодом и тестами.

Telegram должен дополнять сайт:
- привязка аккаунта через одноразовую ссылку, выпущенную авторизованным сайтом;
- уведомления о командах, заявках и матчах только когда соответствующие события существуют;
- ссылки на реальные страницы VAL;
- админ-функции только с серверной проверкой роли.

Не считать заранее готовыми: Telegram endpoints, таблицу привязок, outbox/очередь, страницы матчей, автоматический CS2 счёт. Наличие `passport-steam` в зависимостях не доказывает завершённую интеграцию Steam.

Перед изменениями изучи `server/src/index.js`, `server/src/routes`, controllers/services, `server/src/db/schema.sql`, миграции, `docs/AUTH.md`, `docs/DATABASE.md`, `docs/ROADMAP.md`, `docs/RUN.md` и package manifests.
