// Чистая логика раздела «Пользователи» (без БД): правила, проверки, фильтры. Запросы — controllers/admin-users.js.
import { ROLES } from './permissions.js';

/** Ник: 3–20 символов, буквы (в том числе русские), цифры, «_», «-», «.». Если на регистрации правила другие, поправьте здесь. */
export const NICK_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
export const REASON_MIN = 3;
export const REASON_MAX = 300;
export const MAX_BLOCK_DAYS = 3650;

export const normalizeReason = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/** «Конец дня по Москве» для даты ГГГГ-ММ-ДД: блокировка «до 20 октября» действует весь день 20-го. */
export function untilFromDay(day, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return { error: 'validation' };
  const utc = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== day) return { error: 'validation' };   // отсекает 31 февраля
  const start = new Date(`${day}T00:00:00+03:00`);
  const until = new Date(start.getTime() + 86_400_000);
  if (until <= now) return { error: 'past' };
  if (until.getTime() - now.getTime() > MAX_BLOCK_DAYS * 86_400_000) return { error: 'too_far' };
  return { until };
}

/**
 * Можно ли сделать действие над пользователем. Возвращает код ошибки или null.
 *  actor, target — { id, role, blocked }; otherAdmins — сколько ещё НЕзаблокированных админов, кроме target.
 * Правила: нельзя блокировать и понижать себя, нельзя блокировать или понижать последнего админа.
 */
export function guardUserAction(kind, { actor, target, otherAdmins = 0, newRole }) {
  const self = actor.id === target.id;
  if (kind === 'block') {
    if (self) return 'self_forbidden';
    if (target.role === 'admin' && otherAdmins < 1) return 'last_admin';
  }
  if (kind === 'role') {
    if (!ROLES.includes(newRole)) return 'validation';
    if (newRole === target.role) return 'no_change';
    if (target.role === 'admin' && newRole !== 'admin') {
      if (self) return 'self_forbidden';
      if (otherAdmins < 1) return 'last_admin';
    }
  }
  return null;
}

/** Можно ли сбросить Steam: нужна почта и пароль, иначе аккаунт останется без способа входа. */
export function canResetSteam(u) {
  if (!u.steam_id) return 'not_linked';
  if (!u.email || !u.has_password) return 'last_login_method';
  return null;
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const SORTS = { created: 'u.created_at', nick: 'u.nick', role: `(CASE u.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END)` };
export const SORT_KEYS = Object.keys(SORTS);

/** WHERE, ORDER BY и параметры для списка. Все значения идут через $n; сортировка — только из белого списка. */
export function buildUserQuery(f = {}) {
  const where = [], vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (f.q) {
    vals.push(`%${likeEscape(f.q)}%`);
    where.push(`(u.nick ILIKE $${vals.length} ESCAPE '\\' OR u.email ILIKE $${vals.length} ESCAPE '\\')`);
  }
  if (f.role) add('u.role = ?', f.role);
  const yn = (v, yes, no) => { if (v === 'yes') where.push(yes); else if (v === 'no') where.push(no); };
  yn(f.verified, 'u.email_verified_at IS NOT NULL', 'u.email_verified_at IS NULL');
  yn(f.blocked, 'u.blocked', 'NOT u.blocked');
  yn(f.steam, 'u.steam_id IS NOT NULL', 'u.steam_id IS NULL');
  yn(f.telegram, 'u.telegram_id IS NOT NULL', 'u.telegram_id IS NULL');
  const col = SORTS[f.sort] ?? SORTS.created;
  const dir = f.dir === 'asc' ? 'ASC' : f.sort === 'nick' && f.dir !== 'desc' ? 'ASC' : 'DESC';
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', order: `ORDER BY ${col} ${dir}, u.id`, vals };
}

/** Строка пользователя для списка и карточки. Хеша пароля и токенов здесь нет и быть не должно. */
export function serializeUser(r, now = new Date()) {
  const until = r.blocked_until ? new Date(r.blocked_until) : null;
  return {
    id: r.id, nick: r.nick, email: r.email ?? null, emailVerified: !!r.email_verified_at, role: r.role,
    steam: r.steam_id ? { id: r.steam_id, name: r.steam_name ?? null } : null,
    telegram: r.telegram_id ? { username: r.telegram_username ?? null } : null,
    hasPassword: !!(r.has_password ?? r.password_hash),
    createdAt: r.created_at,
    blocked: r.blocked ? { reason: r.blocked_reason ?? null, until: until ? until.toISOString() : null, at: r.blocked_at ?? null, by: r.blocked_by_nick ?? null, expired: !!(until && until <= now) } : null,
  };
}
