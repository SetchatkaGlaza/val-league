import { roundName } from './bracket.js';

// Чистая логика итогов турнира по сыгранным матчам сетки (без БД, проверяется server/test/results.test.js).

/**
 * Итоги одного турнира.
 * matches — все матчи сетки: { round, reg_a, reg_b, winner ('a' | 'b' | null), status, bye }.
 * Возвращает:
 *   totalRounds — число раундов;
 *   first, second — id заявок победителя и финалиста (null, пока финал не сыгран);
 *   thirds — id заявок проигравших в полуфиналах (3 место делят два полуфиналиста: матча за 3 место в сетке нет);
 *   exits — { id заявки: { round, stage } }: где команда выбыла (stage — «Финал», «Полуфинал», «1/8 финала»…).
 */
export function computeResults(matches) {
  const out = { totalRounds: 0, first: null, second: null, thirds: [], exits: {} };
  if (!matches.length) return out;
  const total = Math.max(...matches.map((m) => m.round));
  out.totalRounds = total;

  const decided = (m) => !m.bye && m.status === 'finished' && (m.winner === 'a' || m.winner === 'b') && m.reg_a && m.reg_b;
  for (const m of matches) {
    if (!decided(m)) continue;
    const loser = m.winner === 'a' ? m.reg_b : m.reg_a;
    out.exits[loser] = { round: m.round, stage: roundName(m.round, total) };
    if (m.round === total) {
      out.first = m.winner === 'a' ? m.reg_a : m.reg_b;
      out.second = loser;
    }
    if (total >= 2 && m.round === total - 1) out.thirds.push(loser);
  }
  // 3 место имеет смысл, только когда сыгран финал: пока турнир идёт, полуфиналисты ещё не «призёры»
  if (!out.first) out.thirds = [];
  return out;
}

/** Результат конкретной заявки: { place: 1 | 2 | 3 | null, stage } или null, если команда ещё в игре или вне сетки. */
export function resultFor(results, regId) {
  if (!regId) return null;
  if (results.first === regId) return { place: 1, stage: roundName(results.totalRounds, results.totalRounds) };
  if (results.second === regId) return { place: 2, stage: roundName(results.totalRounds, results.totalRounds) };
  const exit = results.exits[regId];
  if (!exit) return null;
  return { place: results.thirds.includes(regId) ? 3 : null, stage: exit.stage };
}
