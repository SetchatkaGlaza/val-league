# Подключение базы данных (PostgreSQL)

Выбрана PostgreSQL: надёжна, подходит для сеток, оплат и рейтингов, есть у всех хостингов.

## Локально через Docker (5 минут)
1. Установите Docker Desktop.
2. `cp server/.env.example server/.env` (строка подключения уже готова).
3. `npm install` — поставит драйвер `pg`.
4. `npm run db:up` — запустит PostgreSQL в контейнере.
5. `npm run db:migrate` — создаст таблицы из `server/src/db/schema.sql`.
6. `npm run dev` и откройте `http://localhost:4000/api/health` — должно быть `{"ok":true,"db":true}`.

Посмотреть данные: DBeaver или TablePlus, подключение `localhost:5432`, пользователь/пароль/база из `docker-compose.yml`.

## Локально через pgAdmin (без Docker)
Подходит, если PostgreSQL уже установлен на компьютере вместе с pgAdmin 4.

1. Откройте pgAdmin, раскройте **Servers → PostgreSQL** (введите пароль суперпользователя `postgres`, который задавали при установке).
2. Создайте пользователя: правый клик по **Login/Group Roles → Create → Login/Group Role**. Вкладка *General*: имя `val`. Вкладка *Definition*: пароль, например `val_dev_password`. Вкладка *Privileges*: **Can login? — Yes**. Save.
3. Создайте базу: правый клик по **Databases → Create → Database**. Имя `val`, **Owner — `val`**. Save.
4. Проверьте порт: правый клик по серверу → **Properties → Connection** (обычно `5432`, иногда `5433`).
5. `cp server/.env.example server/.env`. Если имя, пароль и порт совпали с шагами выше, строка уже верная:
   `DATABASE_URL=postgres://val:val_dev_password@localhost:5432/val`
   Если пароль со спецсимволами, закодируйте их: `@` → `%40`, `#` → `%23`, `/` → `%2F`.
6. `npm install`, затем `npm run db:migrate` — создаст таблицы. Сообщение: «Схема БД применена».
7. `npm run dev` и откройте `http://localhost:4000/api/health` — должно быть `{"ok":true,"db":true}`.
8. Посмотреть данные в pgAdmin: **val → Schemas → public → Tables**, правый клик → *Refresh*; таблица `users` → правый клик → **View/Edit Data → All Rows**. SQL-запросы: правый клик по базе `val` → **Query Tool**.

Если `db:migrate` пишет `permission denied to create extension`, у вас PostgreSQL старше 13. Откройте Query Tool на базе `val` под пользователем `postgres` и выполните:
```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```
затем снова `npm run db:migrate`.

| Ошибка | Причина |
| --- | --- |
| `password authentication failed` | неверный пароль пользователя `val` в `.env` (смените в pgAdmin: Login/Group Roles → `val` → Properties → Definition) |
| `ECONNREFUSED` | служба PostgreSQL не запущена (Windows: `services.msc` → `postgresql-x64-…`) или неверный порт |
| `database "val" does not exist` | не создана база на шаге 3 или опечатка в имени |
| `"db":false` в `/api/health` | сервер не видит `.env`: файл должен лежать в `server/`, после правки перезапустите `npm run dev` |

## Облако (для сайта в интернете)
Подойдёт любой управляемый PostgreSQL (Timeweb Cloud, Selectel, Yandex Cloud, Neon, Supabase). Создайте базу, скопируйте строку подключения в `DATABASE_URL` на сервере, при необходимости `DATABASE_SSL=true`, затем выполните `npm run db:migrate`. Пароль к базе не кладите в git: `.env` уже в `.gitignore`.

## Как пользоваться в коде
```js
import { query } from '../db/index.js';
const { rows } = await query('SELECT id, nick FROM users WHERE email = $1', [email]);
```
Значения всегда через `$1, $2…`, никогда не склеивайте SQL строкой.

## Что в схеме
- `users` — игроки: ник, почта, bcrypt-хеш пароля, Steam, Telegram, роль, блокировка.
- `user_tokens` — одноразовые ссылки (подтверждение почты, сброс пароля) и коды привязки Telegram. Хранятся только хеши.

- `teams` — команды: название, адрес `/teams/<slug>` (не меняется при переименовании), описание, логотип (имя файла), капитан, ссылка-приглашение.
- `team_members` — состав: `main` (основа, до 5) и `sub` (запасные, до 2). Капитан тоже здесь.
- `team_invites` — персональные приглашения по нику (`pending / accepted / declined / revoked`). Приглашения по ссылке строк не создают.

Дальше схема растёт по этапам ТЗ: турниры, матчи, оплаты. Новые таблицы добавляйте в `schema.sql` с `CREATE TABLE IF NOT EXISTS`; когда понадобятся изменения существующих таблиц, перейдите на миграции (например, `node-pg-migrate`).

## Бэкапы
В облаке включите автоматические бэкапы. Локально: `docker compose exec db pg_dump -U val val > backup.sql`.
