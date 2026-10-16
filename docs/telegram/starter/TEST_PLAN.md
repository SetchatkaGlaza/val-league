# План тестирования

1. `/start`, `/help`, `/privacy` работают.
2. Валидная ссылка привязывает аккаунт через backend; истёкшая, повторная или повреждённая — нет.
3. Пользователь не может привязать чужой аккаунт, передав user ID.
4. `/internal/notify` без/с неверным секретом возвращает 401.
5. Неизвестный event type, некорректный Telegram ID и чужой URL отклоняются.
6. Секреты и tokens не попадают в логи.
7. Telegram API timeout/429/block не ломает backend.
8. Повторный eventId не дублируется после внедрения persistent idempotency.
9. Проверить связку: аккаунт сайта → создание deep link → Telegram → confirm endpoint → тестовое доменное событие → правильный чат.
10. Перед production: миграции, smoke tests, npm audit, HTTPS, firewall, healthcheck, graceful shutdown, backups.
