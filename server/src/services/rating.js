import { buildTeamHistory } from './team-history.js';

// Чистая логика рейтинга игроков (без БД, проверяется server/test/rating.test.js).
// Данных по отдельным игрокам (убийства, раунды) в базе нет, поэтому очки даются за результаты команды в турнирах.

/** Очки рейтинга по умолчанию. Рабочие значения задаются в админке (настройки сайта, этап 8.4); здесь запасные. */
export const POINTS = {
  place: { 1: 100, 2: 60, 3: 40 },   // за место в турнире
  participation: 10,                  // за участие в завершённом турнире
  matchWin: 3,                        // за каждую победу команды в матче сетки
};

/** Очки за одно участие (запись истории из buildTeamHistory). */
export const entryPoints = (h, points = POINTS) => points.participation + (h.place ? points.place[h.place] ?? 0 : 0) + (h.record?.wins ?? 0) * points.matchWin;

/**
 * Рейтинг игроков по завершённым турнирам.
 *   regs        — оплаченные заявки в завершённых турнирах: { id, tournament_id, team_name, roster: [{ nick }] }
 *   tournaments / matchesByT — как в buildTeamHistory
 *   points      — формула очков (по умолчанию POINTS)
 * Игрок определяется по нику в составе (без учёта регистра). Возвращает массив от лучшего к худшему;
 * места делятся при равенстве очков (1, 1, 3…).
 */
export function buildRating({ regs, tournaments, matchesByT, points = POINTS }) {
  const byNick = new Map();
  for (const reg of regs) {
    const t = tournaments.get(reg.tournament_id);
    if (!t || t.status !== 'finished') continue;
    const [h] = buildTeamHistory({ regs: [reg], tournaments, matchesByT }).history;
    if (!h) continue;
    const pts = entryPoints(h, points);
    const seen = new Set();
    for (const p of reg.roster || []) {
      const nick = typeof p === 'string' ? p : p?.nick;
      const key = String(nick || '').toLowerCase();
      if (!key || seen.has(key)) continue;   // один ник дважды в составе не должен удваивать очки
      seen.add(key);
      const r = byNick.get(key) || { nick, points: 0, tournaments: 0, titles: 0, podiums: 0, matchWins: 0, matchLosses: 0 };
      r.points += pts; r.tournaments += 1;
      if (h.place === 1) r.titles += 1;
      if (h.place) r.podiums += 1;
      r.matchWins += h.record?.wins ?? 0; r.matchLosses += h.record?.losses ?? 0;
      byNick.set(key, r);
    }
  }
  const list = [...byNick.values()].sort((a, b) =>
    b.points - a.points || b.titles - a.titles || b.podiums - a.podiums || a.nick.localeCompare(b.nick, 'ru'));
  let rank = 0;
  list.forEach((r, i) => { if (i === 0 || r.points !== list[i - 1].points) rank = i + 1; r.rank = rank; });
  return list;
}

/** Строка игрока в готовом рейтинге: { rank, points, total } или null, если он ещё не участвовал в завершённых турнирах. */
export function findInRating(list, nick) {
  const key = String(nick || '').toLowerCase();
  const r = list.find((x) => x.nick.toLowerCase() === key);
  return r ? { rank: r.rank, points: r.points, total: list.length } : null;
}
