import { query } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { buildTeamHistory } from '../services/team-history.js';

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

/**
 * GET /api/teams/:slug/history — публичная история участия команды в турнирах.
 * Берём только подтверждённые (оплаченные) заявки и только турниры, видимые публично (не черновики).
 * Сетка нужна, чтобы узнать место или стадию вылета; три запроса на любое число турниров.
 */
export async function history(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
  const { rows: [team] } = await query('SELECT id, name, slug FROM teams WHERE slug = $1', [slug]);
  if (!team) throw new HttpError(404, 'not_found');

  const { rows: regs } = await query(
    `SELECT r.id, r.tournament_id, r.team_name, r.roster
       FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.team_id = $1 AND r.status = 'paid' AND t.status IN ('upcoming', 'live', 'finished')
      ORDER BY t.starts_at DESC LIMIT 100`, [team.id]);

  let data = buildTeamHistory({ regs: [], tournaments: new Map(), matchesByT: new Map() });
  if (regs.length) {
    const ids = [...new Set(regs.map((r) => r.tournament_id))];
    const { rows: ts } = await query(
      `SELECT id, slug, name, starts_at, status, team_size, match_format, winner_name FROM tournaments WHERE id = ANY($1::uuid[])`, [ids]);
    const { rows: ms } = await query(
      'SELECT tournament_id, round, reg_a, reg_b, winner, status, bye FROM matches WHERE tournament_id = ANY($1::uuid[])', [ids]);
    const matchesByT = new Map();
    for (const m of ms) matchesByT.set(m.tournament_id, [...(matchesByT.get(m.tournament_id) || []), m]);
    data = buildTeamHistory({ regs, tournaments: new Map(ts.map((t) => [t.id, t])), matchesByT });
  }
  res.json({ team: { name: team.name, slug: team.slug }, ...data });
}
