# Предлагаемые API-контракты — НЕ подтверждены как существующие

## Выдать deep link
Предлагаемый авторизованный endpoint сайта: `POST /api/account/telegram/link-token`.
Сайт создаёт криптографически случайный token, хранит только hash, TTL около 10 минут и возвращает ссылку `https://t.me/<BOT_USERNAME>?start=link_<token>`.

## Подтвердить привязку
Предлагаемый внутренний endpoint: `POST /api/integrations/telegram/confirm-link`.
Headers: `Authorization: Bearer <service secret>`.
Body:
```json
{
  "token": "one-time-token",
  "telegram": {
    "id": "123456789",
    "username": "optional",
    "firstName": "Player"
  }
}
```
Backend должен атомарно проверить токен и связанного с ним VAL user, привязать Telegram ID и пометить токен использованным. Уникальность связи и политика повторной привязки должны быть определены явно.

## Отправить уведомление боту
В starter service есть `POST /internal/notify`, Bearer secret:
```json
{
  "eventId": "stable-unique-id",
  "eventType": "match.scheduled",
  "recipientTelegramId": "123456789",
  "message": "Матч назначен на 19:00.",
  "webAppUrl": "https://your-real-domain.example/matches/123"
}
```
В production лучше отправлять структурированные данные и форматировать текст по allowlist event types. Проверять URL на точный доверенный домен.

Все маршруты выше требуют сверки с текущей архитектурой и реализации в backend VAL. Это спецификация, не описание уже готового API.
