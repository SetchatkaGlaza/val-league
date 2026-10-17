import { query } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { buildPlayerProfile } from '../services/player-profile.js';

/**
 * GET /api/players/:nick — публичный профиль игрока: участие и результаты в завершённых турнирах.
 * Игрок ищется среди аккаунтов (без учёта регистра), турниры — по составам оплаченных заявок.
 * Заявка хранит ники на момент подачи, поэтому после смены ника старые турниры под новым ником не находятся.
 */
export async function get(req, res) {
  const nick = String(req.params.nick ?? '').trim();
  if (!nick || nick.length > 40 || /[\u0000-\u001f]/.test(nick)) throw new HttpError(404, 'not_found');
  const { rows: [user] } = await query('SELECT nick FROM users WHERE lower(nick) = lower($1)', [nick]);
  if (!user) throw new HttpError(404, 'not_found');

  const { rows: regs } = await query(
    `SELECT r.id, r.tournament_id, r.team_name, r.roster, tm.slug AS team_slug
       FROM tournament_registrations r
       JOIN tournaments t ON t.id = r.tournament_id
       LEFT JOIN teams tm ON tm.id = r.team_id
      WHERE r.status = 'paid' AND t.status = 'finished'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.roster::jsonb) = 'array' THEN r.roster::jsonb ELSE '[]'::jsonb END) e
           WHERE lower(e->>'nick') = lower($1))
      ORDER BY t.starts_at DESC LIMIT 100`, [user.nick]);

  let data = buildPlayerProfile({ nick: user.nick, regs: [], tournaments: new Map(), matchesByT: new Map() });
  if (regs.length) {
    const ids = [...new Set(regs.map((r) => r.tournament_id))];
    const { rows: ts } = await query(
      `SELECT id, slug, name, starts_at, status, team_size, match_format, winner_name FROM tournaments WHERE id = ANY($1::uuid[])`, [ids]);
    const { rows: ms } = await query(
      'SELECT tournament_id, round, reg_a, reg_b, winner, status, bye FROM matches WHERE tournament_id = ANY($1::uuid[])', [ids]);
    const matchesByT = new Map();
    for (const m of ms) matchesByT.set(m.tournament_id, [...(matchesByT.get(m.tournament_id) || []), m]);
    data = buildPlayerProfile({ nick: user.nick, regs, tournaments: new Map(ts.map((t) => [t.id, t])), matchesByT });
  }
  res.json({ player: { nick: data.nick }, stats: data.stats, history: data.history });
}
