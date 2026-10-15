import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../db/index.js';
import { config } from '../config.js';
import { sha256 } from '../utils/token.js';
import { issueToken, issuedRecently } from '../services/tokens.js';
import { mails, sendMail } from '../services/mailer.js';
import { cookieOptions } from '../middleware/auth.js';

const COST = 12;
// Для несуществующей почты тоже считаем bcrypt, чтобы по времени ответа нельзя было узнать, есть ли аккаунт.
const DUMMY_HASH = bcrypt.hashSync('timing-protection', COST);

// ---------- Валидация (правила те же, что на клиенте: client/src/js/validators.js) ----------
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'val', 'vologdaamateurleague'];
const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
const nick = z.string().trim().regex(/^[A-Za-zА-Яа-яЁё0-9_.\-]{3,20}$/).refine((v) => !RESERVED.includes(v.toLowerCase()));
const password = z.string().min(8).max(128).regex(/[A-Za-zА-Яа-я]/).regex(/\d/);
const token = z.string().min(20).max(200);

const schemas = {
  register: z.object({ nick, email, password, terms: z.literal(true) }),
  login: z.object({ email, password: z.string().min(1).max(128), remember: z.boolean().optional() }),
  email: z.object({ email }),
  token: z.object({ token }),
  reset: z.object({ token, password }),
};

function parse(schema, body, res) {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  res.status(400).json({ code: 'validation', field: String(r.error.issues[0]?.path?.[0] ?? '') });
  return null;
}

// ---------- Вспомогательное ----------
export const publicUser = (u) => ({
  id: u.id,
  nick: u.nick,
  email: u.email,
  role: u.role,
  steam: u.steam_id ? { name: u.steam_name } : null,
  telegram: u.telegram_username ? { username: u.telegram_username } : null,
});

function startSession(res, userId, remember) {
  const jwtToken = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: remember ? '30d' : '2d' });
  // «Запомнить меня» — cookie на 30 дней, иначе живёт до закрытия браузера.
  res.cookie(config.cookieName, jwtToken, { ...cookieOptions, maxAge: remember ? 30 * 24 * 3600 * 1000 : undefined });
}

// ---------- Обработчики ----------
export async function register(req, res) {
  const d = parse(schemas.register, req.body, res); if (!d) return;
  const hash = await bcrypt.hash(d.password, COST);
  let user;
  try {
    const { rows } = await query('INSERT INTO users (nick, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nick', [d.nick, d.email, hash]);
    user = rows[0];
  } catch (e) {
    if (e.code === '23505') {                       // нарушение уникальности
      const field = /nick/.test(e.constraint || '') ? 'nick' : 'email';
      return res.status(409).json({ code: `${field}_taken`, field });
    }
    throw e;
  }
  const t = await issueToken(user.id, 'verify_email');
  sendMail(d.email, mails.verify(user.nick, t));   // без await: ответ не ждёт почтовый сервер
  res.status(201).json({ ok: true });
}

export async function login(req, res) {
  const d = parse(schemas.login, req.body, res); if (!d) return;
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [d.email]);
  const u = rows[0];
  const ok = await bcrypt.compare(d.password, u?.password_hash || DUMMY_HASH);
  if (!u || !u.password_hash || !ok) return res.status(401).json({ code: 'invalid_credentials' });
  if (u.blocked) return res.status(403).json({ code: 'blocked' });
  if (!u.email_verified_at) return res.status(403).json({ code: 'email_not_verified' });   // говорим только тому, кто знает пароль
  startSession(res, u.id, !!d.remember);
  res.json({ user: publicUser(u) });
}

export const logout = (_req, res) => {
  res.clearCookie(config.cookieName, cookieOptions);
  res.json({ ok: true });
};

export const me = (req, res) => res.json({ user: publicUser(req.user) });

export async function verifyEmail(req, res) {
  const d = parse(schemas.token, req.body, res); if (!d) return;
  const { rowCount } = await query(
    `WITH t AS (
       UPDATE user_tokens SET used_at = now()
       WHERE token_hash = $1 AND kind = 'verify_email' AND used_at IS NULL AND expires_at > now()
       RETURNING user_id)
     UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
     WHERE id IN (SELECT user_id FROM t)`,
    [sha256(d.token)],
  );
  if (!rowCount) return res.status(400).json({ code: 'token_invalid' });
  res.json({ ok: true });
}

export async function resendVerification(req, res) {
  const d = parse(schemas.email, req.body, res); if (!d) return;
  const { rows } = await query('SELECT id, nick, email_verified_at FROM users WHERE email = $1 AND password_hash IS NOT NULL AND NOT blocked', [d.email]);
  const u = rows[0];
  if (u && !u.email_verified_at && !(await issuedRecently(u.id, 'verify_email'))) {
    sendMail(d.email, mails.verify(u.nick, await issueToken(u.id, 'verify_email')));
  }
  res.json({ ok: true });   // ответ один и тот же — чтобы не раскрывать, есть ли такой аккаунт
}

export async function forgotPassword(req, res) {
  const d = parse(schemas.email, req.body, res); if (!d) return;
  const { rows } = await query('SELECT id, nick FROM users WHERE email = $1 AND password_hash IS NOT NULL AND NOT blocked', [d.email]);
  const u = rows[0];
  if (u && !(await issuedRecently(u.id, 'reset_password'))) {
    sendMail(d.email, mails.reset(u.nick, await issueToken(u.id, 'reset_password')));
  }
  res.json({ ok: true });
}

export async function resetPassword(req, res) {
  const d = parse(schemas.reset, req.body, res); if (!d) return;
  const hash = await bcrypt.hash(d.password, COST);
  // Один запрос: токен «сгорает» и пароль меняется атомарно. Переход по ссылке из письма заодно подтверждает почту.
  const { rows } = await query(
    `WITH t AS (
       UPDATE user_tokens SET used_at = now()
       WHERE token_hash = $1 AND kind = 'reset_password' AND used_at IS NULL AND expires_at > now()
       RETURNING user_id)
     UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now())
     WHERE id IN (SELECT user_id FROM t) RETURNING id`,
    [sha256(d.token), hash],
  );
  if (!rows[0]) return res.status(400).json({ code: 'token_invalid' });
  await query(`UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'reset_password' AND used_at IS NULL`, [rows[0].id]);
  res.json({ ok: true });
}
