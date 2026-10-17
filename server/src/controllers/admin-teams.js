import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { record } from '../services/audit.js';
import { REASON_MIN, REASON_MAX, normalizeReason } from '../services/users.js';
import { normalizeTeamName, disbandBlockers, buildTeamQuery, serializeTeam, TEAM_SORT_KEYS } from '../services/teams-admin.js';

const TEAM_COLS = 't.id, t.slug, t.name, t.description, t.logo, t.captain_id, t.created_at, c.nick AS captain_nick';

const yn = z.enum(['yes', 'no']);
const listSchema = z.object({
  q: z.string().trim().max(60).optional(),
  logo: yn.optional(), active: yn.optional(),
  sort: z.enum(TEAM_SORT_KEYS).optional(), dir: z.enum(['asc', 'desc']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const reason = z.string().transform(normalizeReason).pipe(z.string().min(REASON_MIN).max(REASON_MAX));
const schemas = {
  reasonOnly: z.object({ reason }),
  rename: z.object({ name: z.string().max(80), reason }),
};

function teamId(req) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  return id.data;
}

/** Блокирует строку команды на время действия. Ошибка 404, если такой нет. Блокировка нужна и для расформирования:
 *  заявка на турнир при вставке берёт общую блокировку строки команды (внешний ключ), поэтому новая заявка не проскочит между проверкой и удалением. */
async function lockTeam(db, id) {
  const { rows: [t] } = await db.query(
    `SELECT t.id, t.slug, t.name, t.description, t.logo, t.captain_id, t.created_at FROM teams t WHERE t.id = $1 FOR UPDATE`, [id]);
  if (!t) throw new HttpError(404, 'not_found');
  return t;
}

const snap = (t) => ({ name: t.name, description: t.description, logo: t.logo ?? null });
const audit = (db, req, action, before, after, meta) =>
  record(db, req, { action, objectType: 'team', objectId: before.id, label: before.name, before: snap(before), after: after ? snap(after) : null, meta, diff: !!after });

async function fresh(id) {
  const { rows: [t] } = await query(`SELECT ${TEAM_COLS} FROM teams t LEFT JOIN users c ON c.id = t.captain_id WHERE t.id = $1`, [id]);
  return t ? serializeTeam(t) : null;
}

// ---------- Список и карточка ----------
export async function list(req, res) {
  const q = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string' && v !== ''));
  const d = parse(listSchema, q);
  const limit = d.limit ?? 30, offset = d.offset ?? 0;
  const { where, order, vals } = buildTeamQuery(d);
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT ${TEAM_COLS},
             (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS members,
             (SELECT count(*)::int FROM tournament_registrations r JOIN tournaments x ON x.id = r.tournament_id
               WHERE r.team_id = t.id AND r.status IN ('pending_payment','paid','waitlist') AND x.status IN ('draft','upcoming','live')) AS active_regs
            FROM teams t LEFT JOIN users c ON c.id = t.captain_id ${where} ${order} LIMIT ${limit + 1} OFFSET ${offset}`, vals),
    query(`SELECT count(*)::int AS n FROM teams t ${where}`, vals),
  ]);
  res.json({ teams: rows.slice(0, limit).map(serializeTeam), total: c.n, nextOffset: rows.length > limit ? offset + limit : null });
}

export async function get(req, res) {
  const id = teamId(req);
  const team = await fresh(id);
  if (!team) throw new HttpError(404, 'not_found');
  const [members, regs, log] = await Promise.all([
    query(`SELECT u.id, u.nick, m.role, m.joined_at, (t.captain_id = m.user_id) AS captain, u.blocked
             FROM team_members m JOIN users u ON u.id = m.user_id JOIN teams t ON t.id = m.team_id
            WHERE m.team_id = $1 ORDER BY (t.captain_id = m.user_id) DESC, m.role, u.nick`, [id]),
    query(`SELECT r.id, r.status, r.refund_due, x.id AS tournament_id, x.name AS tournament, x.status AS tournament_status, x.starts_at
             FROM tournament_registrations r JOIN tournaments x ON x.id = r.tournament_id
            WHERE r.team_id = $1 ORDER BY x.starts_at DESC LIMIT 50`, [id]),
    query(`SELECT id, created_at, actor_nick, action, before, after, meta FROM audit_log WHERE object_type = 'team' AND object_id = $1 ORDER BY id DESC LIMIT 15`, [id]),
  ]);
  const registrations = regs.rows.map((r) => ({
    id: r.id, status: r.status, refundDue: r.refund_due,
    tournament: { id: r.tournament_id, name: r.tournament, status: r.tournament_status, startsAt: r.starts_at },
  }));
  res.json({
    team,
    members: members.rows.map((m) => ({ id: m.id, nick: m.nick, role: m.role, captain: m.captain, blocked: !!m.blocked, joinedAt: m.joined_at })),
    registrations,
    canDisband: disbandBlockers(regs.rows.map((r) => ({ status: r.status, tournamentStatus: r.tournament_status }))) === null,
    history: log.rows.map((e) => ({ id: String(e.id), at: e.created_at, actor: e.actor_nick, action: e.action, before: e.before, after: e.after, meta: e.meta })),
  });
}

// ---------- Модерация ----------
/** Снять логотип. Файл на диске не удаляется (путь к папке загрузок здесь неизвестен): команда его больше не показывает. */
export async function removeLogo(req, res) {
  const id = teamId(req), d = parse(schemas.reasonOnly, req.body);
  await withTx(async (db) => {
    const t = await lockTeam(db, id);
    if (!t.logo) throw new HttpError(409, 'no_logo');
    await db.query('UPDATE teams SET logo = NULL WHERE id = $1', [id]);
    await audit(db, req, 'team.logo_remove', t, { ...t, logo: null }, { reason: d.reason, file: t.logo });
  });
  res.json({ team: await fresh(id) });
}

export async function clearDescription(req, res) {
  const id = teamId(req), d = parse(schemas.reasonOnly, req.body);
  await withTx(async (db) => {
    const t = await lockTeam(db, id);
    if (!t.description) throw new HttpError(409, 'no_description');
    await db.query(`UPDATE teams SET description = '' WHERE id = $1`, [id]);
    await audit(db, req, 'team.description_clear', t, { ...t, description: '' }, { reason: d.reason });
  });
  res.json({ team: await fresh(id) });
}

/**
 * Переименование при нарушении. Адрес страницы (slug) не меняется. Новое название заменяется и в снимках:
 * заявки команды, названия в матчах сетки, победитель турнира (если это эта команда), чтобы старое название нигде не осталось.
 */
export async function rename(req, res) {
  const id = teamId(req), d = parse(schemas.rename, req.body);
  const n = normalizeTeamName(d.name);
  if (n.error) throw new HttpError(400, 'validation', 'name');
  const counts = await withTx(async (db) => {
    const t = await lockTeam(db, id);
    if (t.name === n.name) throw new HttpError(409, 'no_change');
    try { await db.query('UPDATE teams SET name = $2 WHERE id = $1', [id, n.name]); }
    catch (e) { if (e.code === '23505') throw new HttpError(409, 'name_taken', 'name'); throw e; }
    const { rowCount: regs } = await db.query('UPDATE tournament_registrations SET team_name = $2, updated_at = now() WHERE team_id = $1', [id, n.name]);
    const { rowCount: ma } = await db.query(
      `UPDATE matches SET name_a = $2, updated_at = now() WHERE reg_a IN (SELECT id FROM tournament_registrations WHERE team_id = $1)`, [id, n.name]);
    const { rowCount: mb } = await db.query(
      `UPDATE matches SET name_b = $2, updated_at = now() WHERE reg_b IN (SELECT id FROM tournament_registrations WHERE team_id = $1)`, [id, n.name]);
    const { rowCount: wins } = await db.query(
      `UPDATE tournaments x SET winner_name = $3
        WHERE lower(x.winner_name) = lower($2::text)
          AND EXISTS (SELECT 1 FROM tournament_registrations r WHERE r.tournament_id = x.id AND r.team_id = $1 AND r.status = 'paid')`, [id, t.name, n.name]);
    const out = { registrations: regs, matches: ma + mb, winners: wins };
    await audit(db, req, 'team.rename', t, { ...t, name: n.name }, { reason: d.reason, ...out });
    return out;
  });
  res.json({ team: await fresh(id), ...counts });
}

/**
 * Расформировать (только админ). Нельзя, пока у команды есть живая заявка в черновике, анонсе или идущем турнире:
 * сначала снимите заявки в разделе турнира (там же правильно сработает лист ожидания и сброс сетки).
 * История завершённых турниров остаётся: в заявках сохранены название и состав.
 */
export async function disband(req, res) {
  const id = teamId(req), d = parse(schemas.reasonOnly, req.body);
  await withTx(async (db) => {
    const t = await lockTeam(db, id);
    const { rows: regs } = await db.query(
      `SELECT r.status, x.status AS "tournamentStatus" FROM tournament_registrations r JOIN tournaments x ON x.id = r.tournament_id WHERE r.team_id = $1`, [id]);
    if (disbandBlockers(regs)) throw new HttpError(409, 'team_in_tournament');
    const { rows: members } = await db.query(
      `SELECT u.nick, m.role, (t.captain_id = m.user_id) AS captain FROM team_members m JOIN users u ON u.id = m.user_id JOIN teams t ON t.id = m.team_id WHERE m.team_id = $1 ORDER BY u.nick`, [id]);
    await db.query('DELETE FROM teams WHERE id = $1', [id]);
    await record(db, req, {
      action: 'team.disband', objectType: 'team', objectId: t.id, label: t.name,
      before: { ...snap(t), slug: t.slug, members: members.map((m) => `${m.nick}${m.captain ? ' (капитан)' : m.role === 'sub' ? ' (запасной)' : ''}`) },
      after: null, meta: { reason: d.reason },
    });
  });
  res.json({ ok: true });
}
