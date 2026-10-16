import { query } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { canRegister, closesAt } from '../services/registrations.js';

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
    (SELECT count(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'waitlist') AS waitlist_count
  FROM tournaments t`;

export const prizeTotal = (places) => (places || []).reduce((s, p) => s + p.amount, 0);

/** Турнир в виде, в котором его получает клиент. */
export const serialize = (t) => ({
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
  canRegister: canRegister(t),
  registrationClosesAt: closesAt(t),
  mapPool: t.map_pool,
  status: t.status,
  registrationOpen: t.registration_open,
  winner: t.winner_name ? { name: t.winner_name, roster: t.winner_roster } : null,
  createdAt: t.created_at,
});

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
  res.json({ tab, tournaments: rows.map(serialize), counts });
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
  res.json({ tournament: serialize(rows[0]), teams });
}

/** Последние победители для главной: завершённые турниры, где указан победитель. */
export async function winners(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 3, 1), 20);
  const { rows } = await query(
    `SELECT * FROM tournaments WHERE status = 'finished' AND winner_name IS NOT NULL ORDER BY starts_at DESC LIMIT $1`, [limit]);
  res.json({
    winners: rows.map((t) => ({
      slug: t.slug, tournament: t.name, date: t.starts_at, team: t.winner_name, roster: t.winner_roster, prize: t.prize_places?.[0]?.amount ?? 0,
    })),
  });
}
