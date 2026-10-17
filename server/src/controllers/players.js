import { query } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { buildPlayerProfile } from '../services/player-profile.js';
import { buildRating, findInRating } from '../services/rating.js';
import { loadSettings } from './settings.js';
import { ratingPoints } from '../services/settings.js';

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
  // Место в рейтинге; если рейтинг не посчитался, профиль всё равно открывается
  let rating = null;
  try { rating = findInRating(await loadRating(), data.nick); } catch (e) { console.error('Рейтинг для профиля не посчитан:', e.message); }
  res.json({ player: { nick: data.nick }, stats: data.stats, rating, history: data.history });
}

// Рейтинг считается по всем завершённым турнирам; результат держим минуту, чтобы страница не нагружала базу.
let cache = { at: 0, list: null, points: null };
/** Сбросить кэш рейтинга (после смены формулы или по кнопке «Пересчитать»). */
export const resetRatingCache = () => { cache = { at: 0, list: null, points: null }; };

async function loadRating() {
  if (cache.list && Date.now() - cache.at < 60_000) return cache.list;
  const points = ratingPoints(await loadSettings());   // формула — из настроек сайта (админка → Настройки)
  const { rows: regs } = await query(
    `SELECT r.id, r.tournament_id, r.team_name, r.roster
       FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.status = 'paid' AND t.status = 'finished' LIMIT 5000`);
  let list = [];
  if (regs.length) {
    const ids = [...new Set(regs.map((r) => r.tournament_id))];
    const { rows: ts } = await query(
      `SELECT id, slug, name, starts_at, status, team_size, match_format, winner_name FROM tournaments WHERE id = ANY($1::uuid[])`, [ids]);
    const { rows: ms } = await query(
      'SELECT tournament_id, round, reg_a, reg_b, winner, status, bye FROM matches WHERE tournament_id = ANY($1::uuid[])', [ids]);
    const matchesByT = new Map();
    for (const m of ms) matchesByT.set(m.tournament_id, [...(matchesByT.get(m.tournament_id) || []), m]);
    list = buildRating({ regs, tournaments: new Map(ts.map((t) => [t.id, t])), matchesByT, points });
    // Оставляем только игроков, чей ник сейчас есть среди аккаунтов (ник мог смениться, аккаунт — удалиться);
    // ник берём как в аккаунте, чтобы ссылка на профиль открывалась.
    const { rows: users } = await query('SELECT nick FROM users WHERE lower(nick) = ANY($1::text[])', [list.map((r) => r.nick.toLowerCase())]);
    const real = new Map(users.map((u) => [u.nick.toLowerCase(), u.nick]));
    list = list.filter((r) => real.has(r.nick.toLowerCase())).map((r) => ({ ...r, nick: real.get(r.nick.toLowerCase()) }));
    let rank = 0;
    list.forEach((r, i) => { if (i === 0 || r.points !== list[i - 1].points) rank = i + 1; r.rank = rank; });
  }
  cache = { at: Date.now(), list, points };
  return list;
}

/** Сколько игроков сейчас в рейтинге (для кнопки пересчёта в админке). */
export const ratingTotal = async () => (await loadRating()).length;

/** GET /api/players?limit=&offset= — публичный рейтинг игроков. */
export async function rating(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const list = await loadRating();
  res.json({ players: list.slice(offset, offset + limit), total: list.length, points: cache.points });
}
