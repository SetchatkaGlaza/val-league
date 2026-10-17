import { computeResults, resultFor } from './results.js';

// Чистая логика истории команды (без БД, проверяется server/test/team-history.test.js).

/** Матч, по которому известен победитель (без проходов без игры). */
const decided = (m) => !m.bye && m.status === 'finished' && (m.winner === 'a' || m.winner === 'b') && m.reg_a && m.reg_b;

/**
 * История участия одной команды.
 *   regs        — подтверждённые (оплаченные) заявки команды: { id, tournament_id, team_name, roster: [{ nick }] }
 *   tournaments — Map: id турнира → { slug, name, starts_at, status, team_size, match_format, winner_name }
 *   matchesByT  — Map: id турнира → матчи сетки { round, reg_a, reg_b, winner, status, bye }
 * Возвращает { stats, history }, история — от новых турниров к старым.
 *   place — 1, 2, 3 или null; stage — стадия вылета («Полуфинал»…) для команды, которая не стала призёром;
 *   inGame — команда ещё играет в идущем турнире; record — победы и поражения в сетке (null, если матчей не было);
 *   roster — ники из заявки, только для завершённых турниров (у идущих и будущих состав не публикуем).
 */
export function buildTeamHistory({ regs, tournaments, matchesByT }) {
  const history = [];
  for (const reg of regs) {
    const t = tournaments.get(reg.tournament_id);
    if (!t) continue;
    const ms = matchesByT.get(reg.tournament_id) || [];
    const results = computeResults(ms);

    const mine = ms.filter((m) => decided(m) && (m.reg_a === reg.id || m.reg_b === reg.id));
    const wins = mine.filter((m) => (m.winner === 'a' ? m.reg_a : m.reg_b) === reg.id).length;

    let r = resultFor(results, reg.id);
    // Турнир закрыт вручную без сетки: известен только победитель (его название записано в турнире)
    if (!r && t.status === 'finished' && !ms.length && t.winner_name && String(t.winner_name).toLowerCase() === String(reg.team_name).toLowerCase()) {
      r = { place: 1, stage: 'Победитель' };
    }
    const inBracket = ms.some((m) => m.reg_a === reg.id || m.reg_b === reg.id);

    history.push({
      tournament: { slug: t.slug, name: t.name, startsAt: t.starts_at, status: t.status, teamSize: t.team_size, matchFormat: t.match_format },
      place: r?.place ?? null,
      stage: r && !r.place ? r.stage : null,
      inGame: t.status === 'live' && !r && inBracket,
      hasBracket: ms.length > 0,
      record: mine.length ? { wins, losses: mine.length - wins } : null,
      roster: t.status === 'finished' ? (reg.roster || []).map((p) => p.nick) : [],
    });
  }
  history.sort((a, b) => new Date(b.tournament.startsAt) - new Date(a.tournament.startsAt));

  const stats = {
    tournaments: history.filter((h) => h.tournament.status !== 'upcoming').length,
    titles: history.filter((h) => h.place === 1).length,
    podiums: history.filter((h) => h.place !== null).length,
    matchWins: history.reduce((s, h) => s + (h.record?.wins ?? 0), 0),
    matchLosses: history.reduce((s, h) => s + (h.record?.losses ?? 0), 0),
  };
  return { stats, history };
}
