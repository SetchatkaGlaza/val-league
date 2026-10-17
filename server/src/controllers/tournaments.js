import { query } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { canRegister, closesAt } from '../services/registrations.js';
import { computeResults } from '../services/results.js';

// ---------- Общее для публичного и админского API ----------
export const TAB_STATUSES = { upcoming: ['upcoming'], live: ['live'], past: ['finished', 'cancelled'] };
const SLUG_RE = /^[a-z0-9-]{1,40}$/;

/**
 * Турнир со счётчиками заявок: teams_count — занятые места (ждут оплаты + оплатили), paid_count — подтверждённые, waitlist_count — лист ожидания.
 * Условие добавляйте через WHERE t.…
 */
export const TSELECT = `
  SELECT t.*,
    (SELECT count(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status IN ('pending_payment', 'paid')) AS teams_count,
    (SELECT count(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'paid') AS paid_count,
    (SELECT count(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'waitlist') AS waitlist_count,
    EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = t.id) AS has_bracket
  FROM tournaments t`;

export const prizeTotal = (places) => (places || []).reduce((s, p) => s + p.amount, 0);

/** Турнир в виде, в котором его получает клиент. podium — итоги (см. loadPodiums), только для завершённых турниров. */
export const serialize = (t, podium = null) => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  description: t.description,
  startsAt: t.starts_at,
  teamSize: t.team_size,
  bracket: t.bracket,
  matchFormat: t.match_format,
  fee: t.fee,
  prizePlaces: t.prize_places,
  prizeTotal: prizeTotal(t.prize_places),
  maxTeams: t.max_teams,
  teamsCount: t.teams_count ?? 0,
  paidCount: t.paid_count ?? 0,
  waitlistCount: t.waitlist_count ?? 0,
  hasBracket: !!t.has_bracket,
  canRegister: canRegister(t),
  registrationClosesAt: closesAt(t),
  mapPool: t.map_pool,
  status: t.status,
  registrationOpen: t.registration_open,
  winner: t.winner_name ? { name: t.winner_name, roster: t.winner_roster } : null,
  podium,
  createdAt: t.created_at,
});

/**
 * Призёры завершённых турниров (1, 2 и 3 места) по результатам сетки; всё одним набором запросов.
 * 3 место делят два проигравших полуфиналиста: матча за 3 место в Single Elimination нет.
 * Для турниров, закрытых вручную без сетки, известен только победитель (из tournaments.winner_name).
 * Возвращает Map: id турнира → { first, second, thirds } (команды: { name, slug, logo, roster: [ники] }).
 */
export async function loadPodiums(tournaments) {
  const done = tournaments.filter((t) => t.status === 'finished');
  const out = new Map();
  if (!done.length) return out;

  const { rows: ms } = await query(
    'SELECT tournament_id, round, reg_a, reg_b, winner, status, bye FROM matches WHERE tournament_id = ANY($1::uuid[])', [done.map((t) => t.id)]);
  const byT = new Map();
  for (const m of ms) byT.set(m.tournament_id, [...(byT.get(m.tournament_id) || []), m]);
  const results = new Map(done.map((t) => [t.id, computeResults(byT.get(t.id) || [])]));

  const need = new Set();
  for (const r of results.values()) [r.first, r.second, ...r.thirds].filter(Boolean).forEach((id) => need.add(id));
  const { rows: regs } = need.size
    ? await query(
      `SELECT r.id, r.team_name AS name, r.roster, tm.slug, tm.logo
         FROM tournament_registrations r LEFT JOIN teams tm ON tm.id = r.team_id WHERE r.id = ANY($1::uuid[])`, [[...need]])
    : { rows: [] };
  const team = (id) => {
    const r = regs.find((x) => x.id === id);
    return r ? { name: r.name, slug: r.slug ?? null, logo: r.logo ?? null, roster: (r.roster || []).map((p) => p.nick) } : null;
  };

  for (const t of done) {
    const r = results.get(t.id);
    if (r.first) out.set(t.id, { first: team(r.first), second: team(r.second), thirds: r.thirds.map(team).filter(Boolean) });
    else if (t.winner_name) out.set(t.id, { first: { name: t.winner_name, slug: null, logo: null, roster: t.winner_roster || [] }, second: null, thirds: [] });
  }
  return out;
}

// ---------- Публичный API (/api/tournaments, /api/winners) ----------
/** Список по вкладке: «Предстоящие» — ближайшие первыми, «Прошедшие» — свежие первыми. Черновики не показываем. */
export async function list(req, res) {
  const tab = TAB_STATUSES[req.query.tab] ? req.query.tab : 'upcoming';
  const { rows } = await query(
    `${TSELECT} WHERE t.status = ANY($1::text[]) ORDER BY t.starts_at ${tab === 'past' ? 'DESC' : 'ASC'} LIMIT 60`,
    [TAB_STATUSES[tab]],
  );
  const counts = { upcoming: 0, live: 0, past: 0 };
  const { rows: c } = await query(`SELECT status, count(*)::int AS n FROM tournaments WHERE status <> 'draft' GROUP BY status`);
  for (const r of c) counts[r.status === 'upcoming' ? 'upcoming' : r.status === 'live' ? 'live' : 'past'] += r.n;
  const podiums = tab === 'past' ? await loadPodiums(rows) : new Map();
  res.json({ tab, tournaments: rows.map((t) => serialize(t, podiums.get(t.id) ?? null)), counts });
}

/** Для главной: идущий сейчас турнир, а если такого нет — ближайший по дате. */
export async function next(_req, res) {
  const { rows } = await query(
    `${TSELECT} WHERE t.status IN ('live', 'upcoming')
      ORDER BY (t.status = 'live') DESC, t.starts_at ASC LIMIT 1`,
  );
  res.json({ tournament: rows[0] ? serialize(rows[0]) : null });
}

export async function get(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
  const { rows } = await query(`${TSELECT} WHERE t.slug = $1 AND t.status <> 'draft'`, [slug]);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  // Публично показываем только подтверждённые команды (оплатившие); ждущие оплаты видны лишь в счётчике мест
  const { rows: teams } = await query(
    `SELECT r.team_name AS name, tm.slug, tm.logo
       FROM tournament_registrations r LEFT JOIN teams tm ON tm.id = r.team_id
      WHERE r.tournament_id = $1 AND r.status = 'paid' ORDER BY r.paid_at, r.created_at`, [rows[0].id]);
  const podiums = await loadPodiums(rows);
  res.json({ tournament: serialize(rows[0], podiums.get(rows[0].id) ?? null), teams });
}

/**
 * Победители завершённых турниров: для главной (limit=3) и страницы архива (limit/offset).
 * Каждая запись содержит podium (1–3 места) и признак hasBracket для ссылки на сетку.
 */
export async function winners(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 3, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { rows } = await query(
    `${TSELECT} WHERE t.status = 'finished' AND t.winner_name IS NOT NULL ORDER BY t.starts_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM tournaments WHERE status = 'finished' AND winner_name IS NOT NULL`);
  const podiums = await loadPodiums(rows);
  res.json({
    total: n,
    winners: rows.map((t) => ({
      slug: t.slug, tournament: t.name, date: t.starts_at, team: t.winner_name, roster: t.winner_roster,
      prize: t.prize_places?.[0]?.amount ?? 0, prizeTotal: serialize(t).prizeTotal,
      teamSize: t.team_size, matchFormat: t.match_format, teamsCount: t.paid_count ?? 0, hasBracket: !!t.has_bracket,
      podium: podiums.get(t.id) ?? null,
    })),
  });
}
