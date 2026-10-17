import { query } from '../db/index.js';

/** Все действия, которые пишутся в журнал. Подписи для экрана — на клиенте (views/audit-labels.js). */
export const ACTIONS = [
  'tournament.create', 'tournament.update', 'tournament.status', 'tournament.delete', 'tournament.duplicate', 'tournament.cancel', 'tournament.export',
  'registration.confirm', 'registration.cancel', 'registration.refunded', 'registration.bulk_refunded',
  'bracket.generate', 'bracket.remove', 'bracket.schedule',
  'match.update', 'match.result', 'match.rollback', 'note.create', 'note.delete',
  'user.block', 'user.unblock', 'user.role', 'user.verify_email', 'user.reset_steam', 'user.reset_telegram', 'user.nick',
  'team.logo_remove', 'team.description_clear', 'team.rename', 'team.disband',
  'settings.update', 'settings.rating_recalc',
];
export const OBJECT_TYPES = ['tournament', 'registration', 'match', 'user', 'team', 'setting'];

const SECRET = /pass|token|secret|hash|cookie/i;
const MAX_STR = 500;

/** Готовит значение для JSON-журнала: убирает секреты, обрезает длинные строки, приводит даты к строкам. */
export function sanitize(v, depth = 0) {
  if (v === undefined) return null;
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…` : v;
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitize(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET.test(k)) out[k] = sanitize(x, depth + 1);
    return out;
  }
  return String(v);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Оставляет только изменившиеся поля: { before, after }. Если ничего не изменилось — оба null. */
export function diffObjects(before, after) {
  const b = sanitize(before) ?? {}, a = sanitize(after) ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !same(b[k], a[k]));
  if (!keys.length) return { before: null, after: null };
  return { before: Object.fromEntries(keys.map((k) => [k, b[k] ?? null])), after: Object.fromEntries(keys.map((k) => [k, a[k] ?? null])) };
}

/** Строка журнала из данных запроса. actor — req.user. */
export function buildEntry({ actor, ip, action, objectType, objectId = null, label = null, before = null, after = null, meta = null, diff = false }) {
  if (!ACTIONS.includes(action)) throw new Error(`Неизвестное действие журнала: ${action}`);
  const d = diff ? diffObjects(before, after) : { before: sanitize(before), after: sanitize(after) };
  return {
    actor_id: actor.id, actor_nick: String(actor.nick), actor_role: actor.role,
    action, object_type: objectType, object_id: objectId == null ? null : String(objectId), object_label: label ? String(label).slice(0, 120) : null,
    before: d.before, after: d.after, meta: sanitize(meta), ip: ip ? String(ip).slice(0, 64) : null,
  };
}

/** Записывает действие. Вызывать внутри той же транзакции, что и само изменение: нет записи в журнале — нет и изменения. */
export async function record(db, req, entry) {
  const e = buildEntry({ actor: req.user, ip: req.ip, ...entry });
  await db.query(
    `INSERT INTO audit_log (actor_id, actor_nick, actor_role, action, object_type, object_id, object_label, before, after, meta, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
    [e.actor_id, e.actor_nick, e.actor_role, e.action, e.object_type, e.object_id, e.object_label,
      JSON.stringify(e.before), JSON.stringify(e.after), JSON.stringify(e.meta), e.ip]);
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Условие WHERE и параметры для списка журнала. Все значения идут через $n. */
export function buildAuditFilter(f = {}) {
  const where = [], vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (f.actor) add(`actor_nick ILIKE ? ESCAPE '\\'`, `%${likeEscape(f.actor)}%`);
  if (f.action) {
    // «tournament.» — вся группа, «tournament.status» — одно действие
    if (f.action.endsWith('.')) add(`action LIKE ? ESCAPE '\\'`, `${likeEscape(f.action)}%`);
    else add('action = ?', f.action);
  }
  if (f.objectType) add('object_type = ?', f.objectType);
  if (f.objectId) add('object_id = ?', f.objectId);
  if (f.from) add('created_at >= ?', f.from);
  if (f.to) add('created_at < ?', f.to);
  if (f.before) add('id < ?', f.before);
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

export const AUDIT_COLUMNS = 'id, created_at, actor_id, actor_nick, actor_role, action, object_type, object_id, object_label, before, after, meta, ip';

export async function listAudit(filter, limit = 30) {
  const { where, vals } = buildAuditFilter(filter);
  const { rows } = await query(`SELECT ${AUDIT_COLUMNS} FROM audit_log ${where} ORDER BY id DESC LIMIT ${Number(limit) + 1}`, vals);
  const more = rows.length > limit;
  const entries = rows.slice(0, limit);
  return { entries, nextCursor: more ? String(entries[entries.length - 1].id) : null };
}
