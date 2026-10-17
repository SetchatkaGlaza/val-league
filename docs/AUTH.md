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
| GET | `/steam` | `?link=1` (привязка к вошедшему аккаунту), `?next=/путь` | редирект на Steam (OpenID). Ставит cookie `val_steam` (httpOnly, 10 минут, только для маршрутов Steam) |
| GET | `/steam/callback` | параметры `openid.*` от Steam | редирект на сайт: успех → `/steam-done?next=…` (при привязке ещё `linked=1`); ошибка → `/login?error=…` или `/account?error=…` |
| GET | `/steam/pending` | — (cookie `val_steam_new`) | `{steam:{name}, next}`; `401 steam_session_expired` |
| POST | `/steam/register` | `nick, terms` (cookie `val_steam_new`) | `201 {user, next}` и сессия; `400 validation`; `401 steam_session_expired`; `409 nick_taken / steam_exists` |

**Вход и привязка через Steam (этап 9.1).** Код ответа Steam: `steam_failed`, `steam_cancelled`, `steam_unavailable` (Steam не ответил за 8 секунд), `steam_new` (устарело: с 9.2 вместо ошибки открывается `/steam-signup`), `blocked`, при привязке ещё `steam_taken` (Steam уже у другого аккаунта) и `steam_already` (у вас уже есть Steam). Проверки: подпись подтверждает сам Steam (`check_authentication`), адрес возврата, сервер Steam и 17-значный Steam ID сверяются до обращения к сети, куда вернуть игрока (`next`) только внутри сайта. Заблокированный войти через Steam не может, истёкшая блокировка снимается сама. Steam ID уникален в базе, поэтому один Steam не привязать к двум аккаунтам. Логика: `services/steam.js`, контроллер: `controllers/steam.js`, клиент: страница `/steam-done`.

**Регистрация через Steam (этап 9.2).** Если Steam подтвердил игрока, а аккаунта с таким Steam нет, сервер ставит подписанную cookie `val_steam_new` (15 минут, только для маршрутов `/api/auth/steam`) и ведёт на `/steam-signup`. Аккаунт создаётся запросом `POST /api/auth/steam/register` (`nick`, `terms: true`) **только** по этой cookie; Steam ID из тела запроса не принимается. Создаётся новая запись без почты и пароля (`email`, `password_hash` = NULL); ник проверяется так же, как при обычной регистрации. Коды: `nick_taken`, `steam_exists` (этот Steam уже зарегистрирован, нужно войти), `steam_session_expired` (cookie нет или истекла: пройти Steam заново). Игрок, у которого привязан Steam, считается подтверждённым при подаче заявки на турнир (почта не обязательна).

**Отвязка Steam игроком.** `POST /api/account/steam/unlink` с текущим паролем. Разрешена, если у аккаунта есть подтверждённая почта и пароль; иначе `last_login_method`. При `REQUIRE_STEAM=true` запрещена, пока игрок в активной заявке на предстоящий или идущий турнир.

**Включение `REQUIRE_STEAM` (не включено по умолчанию).** После включения игроки основы без привязанного Steam не смогут подать заявку (`roster_no_steam`), а сайт показывает им, кого не хватает. Порядок: 1) убедиться, что вход и привязка Steam работают на боевом адресе (`CLIENT_URL`/`STEAM_RETURN_BASE` с HTTPS, при желании `STEAM_API_KEY`); 2) заранее предупредить игроков, что Steam нужно привязать в кабинете; 3) посмотреть, сколько игроков без Steam: `SELECT count(*) FROM users WHERE steam_id IS NULL;`; 4) добавить в `server/.env` строку `REQUIRE_STEAM=true` и перезапустить сервер; вернуть можно, убрав строку. Уже поданные заявки не отменяются.

## Маршруты аккаунта (`/api/account`, нужен вход)
| Метод | Путь | Тело | Ответ |
| --- | --- | --- | --- |
| POST | `/profile` | `nick` | `{user}`; `409 nick_taken` |
| POST | `/password` | `current, password` | `{ok}`; `401 invalid_credentials` (лимит 10 попыток / 15 мин); остальные сессии завершаются |
| POST | `/notifications` | `registered, tomorrow, match30` = `{ email, tg }` | сохранённые настройки |
| POST | `/delete` | `nick` | `{ok}`; `409 captain_must_transfer` (+`details` — названия команд) / `last_admin` |
| POST | `/steam/unlink` | `password` | `{user}`; `401 invalid_credentials`; `409 last_login_method / steam_not_linked / in_tournament` (+`details`) |
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
