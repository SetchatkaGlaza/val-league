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

-- ---------- Аккаунт: смена пароля и уведомления ----------
-- password_changed_at: все сессии, выданные раньше этого момента, перестают действовать (смена/сброс пароля).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications jsonb;     -- { registered: {email, tg}, tomorrow: {...}, match30: {...} }

-- ---------- Турниры (этап 3 ТЗ) ----------
-- status: draft — черновик (виден только админу), upcoming — анонс/регистрация, live — идёт, finished — прошёл, cancelled — отменён.
CREATE TABLE IF NOT EXISTS tournaments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,                  -- адрес /tournaments/<slug>, не меняется при переименовании
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  starts_at         timestamptz NOT NULL,
  team_size         smallint NOT NULL DEFAULT 5 CHECK (team_size IN (2, 5)),
  bracket           text NOT NULL DEFAULT 'single_elimination' CHECK (bracket IN ('single_elimination')),
  match_format      text NOT NULL DEFAULT 'bo1' CHECK (match_format IN ('bo1', 'bo3')),
  fee               integer NOT NULL DEFAULT 0 CHECK (fee >= 0),            -- ₽ с команды, 0 — бесплатно
  prize_places      jsonb NOT NULL DEFAULT '[]',                            -- [{ "place": 1, "amount": 30000 }, ...]
  max_teams         smallint NOT NULL CHECK (max_teams BETWEEN 2 AND 128),
  map_pool          text[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'upcoming', 'live', 'finished', 'cancelled')),
  registration_open boolean NOT NULL DEFAULT true,
  winner_name       text,                                                   -- пока вручную; на этапе сетки возьмётся из результатов
  winner_roster     text[] NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status, starts_at);

-- ---------- Заявки команд на турниры (этап 4 ТЗ) ----------
-- Статусы: pending_payment — место занято, ждём оплату; paid — участие подтверждено; waitlist — лист ожидания; cancelled — снята (см. cancel_reason).
-- Места занимают pending_payment и paid. Состав заявки (roster) — снимок на момент подачи; менять его можно до закрытия регистрации.
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id           uuid REFERENCES teams(id) ON DELETE SET NULL,      -- история остаётся, даже если команду потом удалили
  team_name         text NOT NULL,
  status            text NOT NULL CHECK (status IN ('pending_payment', 'paid', 'waitlist', 'cancelled')),
  roster            jsonb NOT NULL,                                    -- [{ "id": "...", "nick": "..." }]
  roster_ids        uuid[] NOT NULL,
  registered_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  rules_accepted_at timestamptz NOT NULL DEFAULT now(),
  fee               integer NOT NULL DEFAULT 0,                        -- сумма к оплате на момент заявки
  payment_code      text NOT NULL,                                     -- код для комментария к переводу
  pay_until         timestamptz,
  paid_at           timestamptz,
  confirmed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason     text CHECK (cancel_reason IN ('captain', 'admin', 'expired', 'tournament_started', 'tournament_cancelled')),
  note              text,
  refund_due        boolean NOT NULL DEFAULT false,                    -- оплаченную заявку сняли: взнос нужно вернуть вручную
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tr_code_uq ON tournament_registrations (payment_code);
CREATE UNIQUE INDEX IF NOT EXISTS tr_team_active_uq ON tournament_registrations (tournament_id, team_id) WHERE team_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS tr_tournament_idx ON tournament_registrations (tournament_id, status, created_at);
CREATE INDEX IF NOT EXISTS tr_team_idx ON tournament_registrations (team_id);
CREATE INDEX IF NOT EXISTS tr_roster_gin ON tournament_registrations USING gin (roster_ids);

-- ---------- Сетка и матчи (этап 5 ТЗ) ----------
-- Single Elimination. Команды — это оплаченные заявки (reg_a / reg_b); названия сохранены снимком, чтобы история не менялась.
-- Статусы: pending — ждёт участников, ready — оба известны, live — идёт, finished — сыгран (или bye — проход без игры).
-- Счёт: для BO1 — раунды (13:7), для BO3 — выигранные карты (2:1).
CREATE TABLE IF NOT EXISTS matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          smallint NOT NULL CHECK (round >= 1),         -- 1 — первый раунд, последний — финал
  position       smallint NOT NULL CHECK (position >= 1),      -- номер матча в раунде, сверху вниз
  reg_a          uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  reg_b          uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  name_a         text,
  name_b         text,
  seed_a         smallint,                                     -- сид в сетке (только первый раунд и bye-проходы)
  seed_b         smallint,
  score_a        smallint,
  score_b        smallint,
  winner         text CHECK (winner IN ('a', 'b')),
  bye            boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'live', 'finished')),
  starts_at      timestamptz,
  lobby          text,                                         -- данные для подключения; видны только участникам матча и админам
  demo_url       text,
  next_match_id  uuid REFERENCES matches(id) ON DELETE SET NULL,
  next_slot      text CHECK (next_slot IN ('a', 'b')),
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round, position)
);
CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches (tournament_id, round, position);
CREATE INDEX IF NOT EXISTS matches_reg_a_idx ON matches (reg_a);
CREATE INDEX IF NOT EXISTS matches_reg_b_idx ON matches (reg_b);

-- ---------- Этап 5.3: техническое поражение, неявка, счёт по картам ----------
-- forfeit — сторона, проигравшая без игры ('a' | 'b'), forfeit_reason — причина: tech (техническое поражение) или noshow (неявка).
-- Счёт при этом записывается как 13:0 (BO1) или 2:0 (BO3), чтобы сетка и «Мои матчи» работали без особых случаев.
-- maps — счёт по картам для BO3: [{ "map": "de_mirage", "a": 13, "b": 7, "demoUrl": "https://…" }]; заполняется начиная с 5.3b.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS forfeit        text CHECK (forfeit IN ('a', 'b'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS forfeit_reason text CHECK (forfeit_reason IN ('tech', 'noshow'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS maps           jsonb;
