// Чистая логика раздела «Команды» в админке (без БД): название, фильтры списка, можно ли расформировать. Запросы — controllers/admin-teams.js.
import { normalizeReason } from './users.js';

export const TEAM_NAME_MIN = 3;
export const TEAM_NAME_MAX = 24;
/** Турниры, в которых заявка команды ещё «живая»: расформировать такую команду нельзя, сначала снимите заявки. */
export const ACTIVE_TOURNAMENT = ['draft', 'upcoming', 'live'];
export const ACTIVE_REG = ['pending_payment', 'paid', 'waitlist'];

/** Новое название: пробелы схлопываются, 3–24 символа, без управляющих символов и угловых скобок. Возвращает { name } или { error }. */
export function normalizeTeamName(raw) {
  const name = normalizeReason(raw);
  if ([...name].length < TEAM_NAME_MIN || [...name].length > TEAM_NAME_MAX) return { error: 'validation' };
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return { error: 'validation' };
  return { name };
}

/** Можно ли расформировать: возвращает код ошибки или null. regs — заявки команды: { status, tournamentStatus }. */
export function disbandBlockers(regs) {
  const live = regs.filter((r) => ACTIVE_REG.includes(r.status) && ACTIVE_TOURNAMENT.includes(r.tournamentStatus));
  return live.length ? 'team_in_tournament' : null;
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const SORTS = { created: 't.created_at', name: 't.name', members: 'members' };
export const TEAM_SORT_KEYS = Object.keys(SORTS);

/** WHERE, ORDER BY и параметры для списка команд. Все значения идут через $n; сортировка — только из белого списка. */
export function buildTeamQuery(f = {}) {
  const where = [], vals = [];
  if (f.q) {
    vals.push(`%${likeEscape(f.q)}%`);
    where.push(`(t.name ILIKE $${vals.length} ESCAPE '\\' OR t.slug ILIKE $${vals.length} ESCAPE '\\')`);
  }
  if (f.logo === 'yes') where.push('t.logo IS NOT NULL');
  else if (f.logo === 'no') where.push('t.logo IS NULL');
  if (f.active === 'yes') where.push(`EXISTS (SELECT 1 FROM tournament_registrations r JOIN tournaments x ON x.id = r.tournament_id WHERE r.team_id = t.id AND r.status IN ('pending_payment','paid','waitlist') AND x.status IN ('draft','upcoming','live'))`);
  const col = SORTS[f.sort] ?? SORTS.created;
  const dir = f.dir === 'asc' ? 'ASC' : f.sort === 'name' && f.dir !== 'desc' ? 'ASC' : 'DESC';
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', order: `ORDER BY ${col} ${dir}, t.id`, vals };
}

/** Команда для списка и карточки. Токен приглашения наружу не отдаём. */
export function serializeTeam(r) {
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description ?? '', logo: r.logo ?? null, createdAt: r.created_at,
    captain: r.captain_id ? { id: r.captain_id, nick: r.captain_nick ?? null } : null,
    members: r.members ?? undefined, activeRegistrations: r.active_regs ?? undefined,
  };
}
