# Авторизация и регистрация

## Как устроено
- Регистрация: ник, почта, пароль → пароль хранится как bcrypt-хеш, на почту уходит ссылка подтверждения (24 часа).
- Вход разрешён только после подтверждения почты. «Запомнить меня» — cookie на 30 дней, иначе до закрытия браузера.
- Сессия — `httpOnly` cookie `val_session` с подписанным JWT. JavaScript сайта её не видит; блокировка пользователя действует сразу (пользователь читается из БД при каждом запросе).
- Забыли пароль: ссылка на 1 час, одноразовая. В БД хранятся только хеши токенов (`user_tokens`).
- Защита: лимит 10 неудачных попыток входа за 15 минут на пару «IP + почта», лимит на формы, проверка `Origin`, одинаковые ответы на «забыли пароль» и «отправить ещё раз» (нельзя узнать, есть ли аккаунт).

## Первый запуск
1. В `server/.env` задайте `JWT_SECRET` (команда для генерации — в `.env.example`).
2. В `client/.env` поставьте `VITE_MOCK=false` (по умолчанию в `.env.example` уже так).
3. `npm run dev`. Перезапустите клиент после смены `.env`.
4. Зарегистрируйтесь на сайте. Пока `SMTP_HOST` пуст, ссылка подтверждения печатается в **консоли сервера**: `[ПИСЬМО → ...]`. Скопируйте её в браузер.
5. Войдите. В шапке появится «Кабинет».

## Реальная почта
Заполните `SMTP_*` и `MAIL_FROM` в `server/.env` (подойдёт SMTP Яндекса, Mail.ru для бизнеса, Unisender, SendGrid и т. п.).

## Маршруты API (`/api/auth`)
| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| POST | `/register` | `nick, email, password, terms` | `201 {ok}`; `409 email_taken / nick_taken` |
| POST | `/login` | `email, password, remember` | `{user}`; `401 invalid_credentials`; `403 email_not_verified / blocked`; `429 rate_limited` |
| POST | `/logout` | — | `{ok}` |
| GET | `/me` | — | `{user}`; `401 unauthorized` |
| POST | `/verify-email` | `token` | `{ok}`; `400 token_invalid` |
| POST | `/resend-verification` | `email` | `{ok}` |
| POST | `/forgot-password` | `email` | `{ok}` |
| POST | `/reset-password` | `token, password` | `{ok}`; `400 token_invalid` |
| GET | `/steam` | — | пока перенаправляет на сайт с сообщением «скоро» |

## Маршруты аккаунта (`/api/account`, нужен вход)
| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| POST | `/profile` | `nick` | `{user}`; `409 nick_taken` |
| POST | `/password` | `current, password` | `{ok}`; `401 invalid_credentials` (лимит 10 попыток / 15 мин); остальные сессии завершаются |
| POST | `/notifications` | `registered, tomorrow, match30` = `{ email, tg }` | сохранённые настройки |
| POST | `/delete` | `nick` | `{ok}`; `409 captain_must_transfer` (+`details` — названия команд) / `last_admin` |
| POST | `/telegram/code, /check, /unlink` | — | `501 soon` до этапа 9 |

Смена или сброс пароля записывает `users.password_changed_at`: сессии (JWT), выданные раньше, перестают действовать.

## Проверка вручную (curl)
```bash
curl -i -X POST localhost:4000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"nick":"Shadow","email":"a@b.ru","password":"Password1","terms":true}'
# ссылку возьмите из консоли сервера, токен — часть после token=
curl -X POST localhost:4000/api/auth/verify-email -H 'Content-Type: application/json' -d '{"token":"..."}'
curl -i -c jar -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"a@b.ru","password":"Password1"}'
curl -b jar localhost:4000/api/auth/me
```
Таблицы смотрите в pgAdmin: `users` (`email_verified_at` заполняется после подтверждения), `user_tokens`.

## Продакшен
`NODE_ENV=production` (cookie станет `Secure`, нужен HTTPS), свой `JWT_SECRET`, `CLIENT_URL` — адрес сайта, `TRUST_PROXY=1` за nginx, настоящий SMTP.
