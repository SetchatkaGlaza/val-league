import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { record } from '../services/audit.js';
import { ROLES } from '../services/permissions.js';
import {
  NICK_RE, REASON_MIN, REASON_MAX, normalizeReason, untilFromDay, guardUserAction, canResetSteam, buildUserQuery, serializeUser, SORT_KEYS,
} from '../services/users.js';

const USER_COLS = `u.id, u.nick, u.email, u.email_verified_at, u.role, u.steam_id, u.steam_name, u.telegram_id, u.telegram_username,
  u.created_at, u.blocked, u.blocked_reason, u.blocked_until, u.blocked_at, (u.password_hash IS NOT NULL) AS has_password`;

const yn = z.enum(['yes', 'no']);
const listSchema = z.object({
  q: z.string().trim().max(60).optional(),
  role: z.enum(ROLES).optional(),
  verified: yn.optional(), blocked: yn.optional(), steam: yn.optional(), telegram: yn.optional(),
  sort: z.enum(SORT_KEYS).optional(), dir: z.enum(['asc', 'desc']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const reason = z.string().transform(normalizeReason).pipe(z.string().min(REASON_MIN).max(REASON_MAX));
const schemas = {
  block: z.object({ reason, until: z.string().optional() }),
  unblock: z.object({ note: z.string().transform(normalizeReason).pipe(z.string().max(REASON_MAX)).optional() }),
  role: z.object({ role: z.enum(ROLES) }),
  rename: z.object({ nick: z.string().trim().regex(NICK_RE), reason }),
  empty: z.object({ reason: reason.optional() }),
};

function userId(req) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  return id.data;
}

/** Блокирует строку пользователя на время действия. Ошибка 404, если такого нет. */
async function lockUser(db, id) {
  const { rows: [u] } = await db.query(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1 FOR UPDATE`, [id]);
  if (!u) throw new HttpError(404, 'not_found');
  return u;
}

/** Сколько других админов без блокировки. Админов блокируем заранее, чтобы два одновременных запроса не убрали последнего. */
async function otherAdmins(db, id) {
  await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id FOR UPDATE`);
  const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND NOT blocked AND id <> $1`, [id]);
  return r.n;
}

const view = (u) => serializeUser(u);
const snap = (u) => ({
  role: u.role, nick: u.nick, blocked: !!u.blocked, blockedUntil: u.blocked_until ?? null, reason: u.blocked ? u.blocked_reason : null,
  emailVerified: !!u.email_verified_at, steam: u.steam_id ?? null, telegram: u.telegram_username ?? (u.telegram_id ? String(u.telegram_id) : null),
});
const audit = (db, req, action, before, after, meta) =>
  record(db, req, { action, objectType: 'user', objectId: before.id, label: before.nick, before: snap(before), after: snap(after), meta, diff: true });

// ---------- Список и карточка ----------
export async function list(req, res) {
  const q = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string' && v !== ''));
  const d = parse(listSchema, q);
  const limit = d.limit ?? 30, offset = d.offset ?? 0;
  const { where, order, vals } = buildUserQuery(d);
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT ${USER_COLS} FROM users u ${where} ${order} LIMIT ${limit + 1} OFFSET ${offset}`, vals),
    query(`SELECT count(*)::int AS n FROM users u ${where}`, vals),
  ]);
  res.json({ users: rows.slice(0, limit).map(view), total: c.n, nextOffset: rows.length > limit ? offset + limit : null });
}

export async function get(req, res) {
  const id = userId(req);
  const { rows: [u] } = await query(
    `SELECT ${USER_COLS}, b.nick AS blocked_by_nick FROM users u LEFT JOIN users b ON b.id = u.blocked_by WHERE u.id = $1`, [id]);
  if (!u) throw new HttpError(404, 'not_found');
  const [teams, regs, log] = await Promise.all([
    query(`SELECT t.id, t.name, t.slug, tm.role, (t.captain_id = tm.user_id) AS captain FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = $1 ORDER BY t.name`, [id]),
    query(`SELECT r.id, r.team_name, r.status, t.id AS tournament_id, t.name AS tournament, t.status AS tournament_status, t.starts_at
             FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
            WHERE $1 = ANY(r.roster_ids) ORDER BY t.starts_at DESC LIMIT 50`, [id]),
    query(`SELECT id, created_at, actor_nick, action, before, after, meta FROM audit_log WHERE object_type = 'user' AND object_id = $1 ORDER BY id DESC LIMIT 15`, [id]),
  ]);
  res.json({
    user: view(u),
    teams: teams.rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug, role: t.role, captain: t.captain })),
    tournaments: regs.rows.map((r) => ({ registrationId: r.id, teamName: r.team_name, status: r.status, tournament: { id: r.tournament_id, name: r.tournament, status: r.tournament_status, startsAt: r.starts_at } })),
    history: log.rows.map((e) => ({ id: String(e.id), at: e.created_at, actor: e.actor_nick, action: e.action, before: e.before, after: e.after, meta: e.meta })),
  });
}

/** Ответ после действия: свежая строка пользователя. */
const fresh = async (db, id) => view(await lockUser(db, id));

// ---------- Блокировка ----------
export async function block(req, res) {
  const id = userId(req), d = parse(schemas.block, req.body);
  let until = null;
  if (d.until) {
    const r = untilFromDay(d.until);
    if (r.error) throw new HttpError(400, r.error === 'validation' ? 'validation' : `until_${r.error}`, 'until');
    until = r.until;
  }
  const user = await withTx(async (db) => {
    const u = await lockUser(db, id);
    const err = guardUserAction('block', { actor: req.user, target: u, otherAdmins: u.role === 'admin' ? await otherAdmins(db, id) : 0 });
    if (err) throw new HttpError(409, err);
    if (u.blocked) throw new HttpError(409, 'already_blocked');
    await db.query(`UPDATE users SET blocked = true, blocked_reason = $2, blocked_until = $3, blocked_at = now(), blocked_by = $4 WHERE id = $1`, [id, d.reason, until, req.user.id]);
    const after = { ...u, blocked: true, blocked_reason: d.reason, blocked_until: until };
    await audit(db, req, 'user.block', u, after, { reason: d.reason });
    return fresh(db, id);
  });
  res.json({ user });
}

export async function unblock(req, res) {
  const id = userId(req), d = parse(schemas.unblock, req.body ?? {});
  const user = await withTx(async (db) => {
    const u = await lockUser(db, id);
    if (!u.blocked) throw new HttpError(409, 'not_blocked');
    await db.query(`UPDATE users SET blocked = false, blocked_reason = NULL, blocked_until = NULL, blocked_at = NULL, blocked_by = NULL WHERE id = $1`, [id]);
    await audit(db, req, 'user.unblock', u, { ...u, blocked: false, blocked_reason: null, blocked_until: null }, { note: d.note ?? null });
    return fresh(db, id);
  });
  res.json({ user });
}

// ---------- Роль ----------
export async function setRole(req, res) {
  const id = userId(req), d = parse(schemas.role, req.body);
  const user = await withTx(async (db) => {
    const u = await lockUser(db, id);
    const err = guardUserAction('role', { actor: req.user, target: u, newRole: d.role, otherAdmins: u.role === 'admin' ? await otherAdmins(db, id) : 0 });
    if (err) throw new HttpError(409, err);
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [id, d.role]);
    await audit(db, req, 'user.role', u, { ...u, role: d.role });
    return fresh(db, id);
  });
  res.json({ user });
}

// ---------- Почта, Steam, Telegram ----------
export async function verifyEmail(req, res) {
  const id = userId(req);
  const user = await withTx(async (db) => {
    const u = await lockUser(db, id);
    if (!u.email) throw new HttpError(409, 'no_email');
    if (u.email_verified_at) throw new HttpError(409, 'already_verified');
    await db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [id]);
    await db.query(`DELETE FROM user_tokens WHERE user_id = $1 AND kind = 'verify_email'`, [id]);
    await audit(db, req, 'user.verify_email', u, { ...u, email_verified_at: new Date() });
    return fresh(db, id);
  });
  res.json({ user });
}

export async function resetSteam(req, res) {
  const id = userId(req);
  const user = await withTx(async (db) => {
    const u = await lockUser(db, id);
    const err = canResetSteam(u);
    if (err) throw new HttpError(409, err);
    await db.query('UPDATE users SET steam_id = NULL, steam_name = NULL WHERE id = $1', [id]);
    await audit(db, req, 'user.reset_steam', u, { ...u, steam_id: null });
    return fresh(db, id);
  });
  res.json({ user });
}

export async function resetTelegram(req, res) {
  const id = userId(req);
  const user = await withTx(async (db) => {
    const u = await lockUser(db, id);
    if (!u.telegram_id) throw new HttpError(409, 'not_linked');
    await db.query('UPDATE users SET telegram_id = NULL, telegram_username = NULL WHERE id = $1', [id]);
    await db.query(`DELETE FROM user_tokens WHERE user_id = $1 AND kind = 'telegram_link'`, [id]);
    await audit(db, req, 'user.reset_telegram', u, { ...u, telegram_id: null, telegram_username: null });
    return fresh(db, id);
  });
  res.json({ user });
}

// ---------- Принудительная смена ника ----------
/**
 * Новый ник записывается в users и во все снимки составов, где этот игрок найден по id (а не по нику):
 * заявки на турниры и список состава победителей завершённых турниров. Так история в профиле и рейтинге не теряется.
 */
export async function rename(req, res) {
  const id = userId(req), d = parse(schemas.rename, req.body);
  const out = await withTx(async (db) => {
    const u = await lockUser(db, id);
    if (u.nick === d.nick) throw new HttpError(409, 'no_change');
    try { await db.query('UPDATE users SET nick = $2 WHERE id = $1', [id, d.nick]); }
    catch (e) { if (e.code === '23505') throw new HttpError(409, 'nick_taken', 'nick'); throw e; }
    const { rowCount: regs } = await db.query(
      `UPDATE tournament_registrations r
          SET roster = (SELECT jsonb_agg(CASE WHEN e->>'id' = $1::text THEN jsonb_set(e, '{nick}', to_jsonb($2::text)) ELSE e END ORDER BY ord)
                          FROM jsonb_array_elements(r.roster) WITH ORDINALITY AS x(e, ord)),
              updated_at = now()
        WHERE $1::uuid = ANY(r.roster_ids)`, [id, d.nick]);
    // Состав победителей хранится списком ников: меняем только в турнирах, где игрок был в оплаченной заявке
    const { rowCount: wins } = await db.query(
      `UPDATE tournaments t
          SET winner_roster = ARRAY(SELECT CASE WHEN lower(x) = lower($2::text) THEN $3::text ELSE x END FROM unnest(t.winner_roster) WITH ORDINALITY AS w(x, ord) ORDER BY ord)
        WHERE EXISTS (SELECT 1 FROM unnest(t.winner_roster) y WHERE lower(y) = lower($2::text))
          AND EXISTS (SELECT 1 FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'paid' AND $1::uuid = ANY(r.roster_ids))`,
      [id, u.nick, d.nick]);
    await audit(db, req, 'user.nick', u, { ...u, nick: d.nick }, { reason: d.reason, registrations: regs, winnerLists: wins });
    return { user: await fresh(db, id), registrations: regs, winnerLists: wins };
  });
  res.json(out);
}
