import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { config } from '../config.js';
import { cookieOptions } from '../middleware/auth.js';
import { HttpError, parse } from '../utils/http.js';
import { nick, password, publicUser, startSession } from './auth.js';
import { ACTIVE } from '../services/registrations.js';

const COST = 12;
const flag = z.object({ email: z.boolean(), tg: z.boolean() });
const schemas = {
  profile: z.object({ nick }),
  password: z.object({ current: z.string().min(1).max(128), password }),
  notifications: z.object({ registered: flag, tomorrow: flag, match30: flag }),
  delete: z.object({ nick: z.string().trim().min(1).max(40) }),
};

/** Смена ника. Ник виден в составах и сетках, поэтому занятые ники (без учёта регистра) отклоняем. */
export async function updateProfile(req, res) {
  const d = parse(schemas.profile, req.body);
  try {
    const { rows } = await query('UPDATE users SET nick = $2 WHERE id = $1 RETURNING *', [req.user.id, d.nick]);
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'nick_taken', 'nick');
    throw e;
  }
}

/** Смена пароля. Все остальные сессии завершаются, текущая получает новую cookie. */
export async function changePassword(req, res) {
  const d = parse(schemas.password, req.body);
  const u = req.user;
  if (!u.password_hash) throw new HttpError(409, 'no_password');
  if (!(await bcrypt.compare(d.current, u.password_hash))) throw new HttpError(401, 'invalid_credentials', 'current');
  const hash = await bcrypt.hash(d.password, COST);
  await query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [u.id, hash]);
  // Сохраняем «запомнить меня»: по сроку жизни старой cookie понимаем, какой она была.
  const old = jwt.decode(req.cookies?.[config.cookieName] || '') || {};
  startSession(res, u.id, old.exp && old.iat ? old.exp - old.iat > 3 * 24 * 3600 : false);
  res.json({ ok: true });
}

export async function saveNotifications(req, res) {
  const d = parse(schemas.notifications, req.body);
  await query('UPDATE users SET notifications = $2 WHERE id = $1', [req.user.id, JSON.stringify(d)]);
  res.json(d);
}

/**
 * Удаление аккаунта.
 * — Капитан команды, где есть другие игроки, сначала передаёт капитанство (иначе 409 captain_must_transfer + список команд).
 * — Команды, где игрок один, удаляются вместе с аккаунтом.
 * — Последнего администратора удалить нельзя.
 */
export async function deleteAccount(req, res) {
  const d = parse(schemas.delete, req.body);
  const u = req.user;
  if (d.nick.toLowerCase() !== u.nick.toLowerCase()) throw new HttpError(400, 'validation', 'nick');

  const logos = await withTx(async (db) => {
    await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [u.id]);
    if (u.role === 'admin') {
      const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND NOT blocked AND id <> $1`, [u.id]);
      if (!n) throw new HttpError(409, 'last_admin');
    }
    // Игрок из активной заявки на предстоящий или идущий турнир не может исчезнуть: состав заморожен
    const { rows: busy } = await db.query(
      `SELECT DISTINCT t.name FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
        WHERE $1 = ANY(r.roster_ids) AND r.status = ANY($2::text[]) AND t.status IN ('upcoming', 'live')`, [u.id, ACTIVE]);
    if (busy.length) throw new HttpError(409, 'in_tournament', undefined, busy.map((b) => b.name));
    const { rows: owned } = await db.query(
      `SELECT t.id, t.name, t.logo, (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS members
         FROM teams t WHERE t.captain_id = $1 FOR UPDATE`, [u.id]);
    const blocking = owned.filter((t) => t.members > 1);
    if (blocking.length) throw new HttpError(409, 'captain_must_transfer', undefined, blocking.map((t) => t.name));
    const mine = owned.map((t) => t.id);
    if (mine.length) await db.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [mine]);
    await db.query('DELETE FROM users WHERE id = $1', [u.id]);
    return owned.map((t) => t.logo).filter(Boolean);
  });
  await Promise.all(logos.map((n) => fs.unlink(path.join(config.uploadsDir, 'logos', path.basename(n))).catch(() => {})));
  res.clearCookie(config.cookieName, cookieOptions);
  res.json({ ok: true });
}

/** Telegram и Steam: появятся на этапе 9 (бот и вход через Steam). Клиент показывает понятное сообщение. */
export const soon = (_req, res) => res.status(501).json({ code: 'soon' });
