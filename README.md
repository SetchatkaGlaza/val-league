# VOLOGDA AMATEUR LEAGUE (VAL)
Платформа онлайн-турниров по CS2 для любителей Вологды: аккаунты, команды, турниры, админка.

## Запуск
```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
npm install        # ставит клиент и сервер (workspaces)
npm run dev        # клиент :5173, сервер :4000
```
Только клиент: `npm run dev:client`. Вход и регистрация работают с сервером и БД (см. `docs/AUTH.md`). Демо без сервера: `VITE_MOCK=true` в `client/.env`:
`player@val.gg` / `Password1` — успех; `unverified@val.gg` — почта не подтверждена; `limit@val.gg` — лимит попыток; любые другие — неверный пароль.

База данных (PostgreSQL): см. `docs/DATABASE.md` — `npm run db:up`, `npm run db:migrate`.
Администратор: `npm run admin:make -- почта_или_ник`. Автопроверка API: `npm run smoke`.
**Полная инструкция по запуску и обновлению — `docs/RUN.md`, план дальнейших работ — `docs/ROADMAP.md`, что изменилось — `docs/CHANGES.md`.**

Демо-ссылки из писем: `/verify-email?token=demo` (успех), `/verify-email?token=expired` (ссылка устарела),
`/reset-password?token=demo` (успех), `/reset-password?token=expired` (ссылка устарела).

## Структура
- `client/` — Vite + нативный JS + GSAP. **Одностраничное приложение (SPA):** один `index.html`, страницы переключаются без перезагрузки и без новых вкладок.
  - `src/routes.js` — таблица адресов → страницы;
  - `src/views/*.js` — страницы (`render()` — разметка, `mount()` — логика, возвращает функцию очистки);
  - `src/views/partials/*.html` — тексты регламента и политики;
  - `src/js/router.js` — переходы (History API), `app.js` — смена страниц с анимацией, `layouts.js` — каркасы «вход» и «документы», `drawer.js` — шторка с регламентом;
  - `src/styles` — стили.
- `server/` — Express API (`/api`). Маршруты — `routes/`, логика — `controllers/`, `services/`.
- `docs/PAGES.md` — список страниц и статус; `docs/TOURNAMENTS.md` — турниры и админка; `docs/REGISTRATION.md` — регистрация на турнир и оплата; `docs/TEAMS.md`, `docs/AUTH.md`, `docs/DATABASE.md`.

Новая страница: файл в `client/src/views`, строка в `client/src/routes.js` (каркас `auth` — карточка слева-справа, `doc` — шапка и подвал).

## Как это работает
- Фоновый canvas и каркас живут между страницами, меняется только содержимое: карточка входа плавно меняет высоту, документы появляются поверх шапки.
- Все страницы лежат в одном бандле, поэтому переходы мгновенные (без запросов). Кнопки «Назад/Вперёд» работают, скролл восстанавливается.
- Старые адреса `/login.html`, `/rules.html` и т. п. автоматически превращаются в `/login`, `/rules`.
- Регламент и политику из форм можно открыть шторкой, не теряя введённые данные.
- Единственный «настоящий» переход — вход через Steam (уход на сайт Steam).

## Продакшен
Сайт — SPA, поэтому веб-сервер должен отдавать `index.html` на любой адрес, кроме `/api` и файлов. Пример для nginx:
```nginx
location /api/ { proxy_pass http://127.0.0.1:4000; client_max_body_size 2m; }   # /api/files — логотипы команд
location /     { root /var/www/val/client/dist; try_files $uri /index.html; }
```
Сборка: `npm run build` → `client/dist`.
