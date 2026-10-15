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

-- ---------- Команды (этап 2 ТЗ) ----------
CREATE TABLE IF NOT EXISTS teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,                 -- адрес страницы /teams/<slug>, не меняется при переименовании
  name         citext NOT NULL UNIQUE,
  description  text NOT NULL DEFAULT '',
  logo         text,                                 -- имя файла в UPLOADS_DIR/logos
  captain_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  invite_token text UNIQUE,                          -- многоразовая ссылка-приглашение; капитан может сбросить
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(name) BETWEEN 3 AND 24),
  CHECK (char_length(description) <= 300)
);

-- Состав: 'main' — основа, 'sub' — запасные. Капитан тоже строка здесь (teams.captain_id указывает на него).
CREATE TABLE IF NOT EXISTS team_members (
  team_id   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'main' CHECK (role IN ('main', 'sub')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members (user_id);

-- Персональные приглашения по нику. Приглашение по ссылке строк здесь не создаёт (см. teams.invite_token).
CREATE TABLE IF NOT EXISTS team_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invitee_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_pending_uq ON team_invites (team_id, invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS team_invites_invitee_idx ON team_invites (invitee_id) WHERE status = 'pending';
