-- Схема VAL. Запускается повторно без вреда: npm run db:migrate
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nick              citext NOT NULL UNIQUE,
  email             citext UNIQUE,                 -- NULL допустим для входа только через Steam
  password_hash     text,                          -- bcrypt; NULL для Steam-аккаунтов
  email_verified_at timestamptz,
  steam_id          text UNIQUE,
  steam_name        text,
  telegram_id       bigint UNIQUE,
  telegram_username text,
  role              text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  blocked           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR steam_id IS NOT NULL)
);

-- Одноразовые ссылки из писем (подтверждение почты, сброс пароля) и коды привязки Telegram.
-- Храним только хеш токена: утечка таблицы не даёт рабочих ссылок.
CREATE TABLE IF NOT EXISTS user_tokens (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('verify_email', 'reset_password', 'telegram_link')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON user_tokens (user_id, kind);
