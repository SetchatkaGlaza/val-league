import { randomInt } from 'node:crypto';

// Чистая логика сетки Single Elimination: без БД, поэтому её можно проверить юнит-тестами (server/test/bracket.test.js).

/** Ближайшая степень двойки ≥ n (размер сетки). */
export function nextPow2(n) {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

/**
 * Порядок посева в первом раунде: соседние пары играют друг с другом.
 * Для 8: [1, 8, 4, 5, 2, 7, 3, 6] → 1–8, 4–5, 2–7, 3–6. Сильнейшие встречаются как можно позже, 1 и 2 — только в финале.
 */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Перемешивание Фишера — Йетса. Генератор можно подменить (в тестах); по умолчанию — криптографический. */
export function shuffle(items, randInt = (n) => randomInt(n)) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Строит сетку. teamIds — команды в порядке посева (первая — сеяный №1).
 * Возвращает { size, rounds, matches }, где у каждого матча:
 *   round (1 — первый), position (с 1), a, b (id команды или null), bye (проход без игры), status, winner ('a' | 'b' | null),
 *   next: { round, position, slot: 'a' | 'b' } | null.
 * Если команд меньше размера сетки, свободные места получают сеяные первыми («bye»): они сразу проходят во второй раунд.
 */
export function buildBracket(teamIds) {
  const n = teamIds.length;
  if (n < 2) throw new RangeError('Для сетки нужно минимум 2 команды');
  const size = nextPow2(n), rounds = Math.log2(size), order = seedOrder(size);

  const byKey = new Map();
  const matches = [];
  for (let r = 1; r <= rounds; r++) {
    for (let p = 1; p <= size / 2 ** r; p++) {
      const m = {
        round: r, position: p, a: null, b: null, bye: false, status: 'pending', winner: null,
        next: r < rounds ? { round: r + 1, position: Math.ceil(p / 2), slot: p % 2 === 1 ? 'a' : 'b' } : null,
      };
      byKey.set(`${r}:${p}`, m);
      matches.push(m);
    }
  }
  // Первый раунд: посев по порядку; номер сида больше числа команд — пустое место
  for (let p = 1; p <= size / 2; p++) {
    const m = byKey.get(`1:${p}`);
    m.a = teamIds[order[2 * (p - 1)] - 1] ?? null;
    m.b = teamIds[order[2 * (p - 1) + 1] - 1] ?? null;
    if (m.a && m.b) m.status = 'ready';
    else {                                         // проход без игры
      m.bye = true; m.status = 'finished'; m.winner = m.a ? 'a' : 'b';
      const nx = byKey.get(`${m.next.round}:${m.next.position}`);
      nx[m.next.slot] = m.a ?? m.b;
    }
  }
  // Второй раунд: оба участника уже известны (пришли через bye) — матч готов
  for (const m of matches) if (m.round > 1 && m.a && m.b) m.status = 'ready';
  return { size, rounds, matches };
}

/** «Финал», «Полуфинал», «Четвертьфинал», «1/8 финала»… */
export function roundName(round, totalRounds) {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Финал';
  if (fromEnd === 1) return 'Полуфинал';
  if (fromEnd === 2) return 'Четвертьфинал';
  return `1/${2 ** fromEnd} финала`;
}

/**
 * Проверка счёта. BO1 — счёт по раундам (13:7), BO3 — по картам (2:0 или 2:1). Ничьей не бывает.
 * Возвращает null, если счёт корректен, иначе код ошибки: 'bad_score' | 'tie'.
 */
export function validateScore(format, a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 'bad_score';
  if (a === b) return 'tie';
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (format === 'bo3') return hi === 2 && lo <= 1 ? null : 'bad_score';
  return hi <= 99 ? null : 'bad_score';
}

export const winnerSlot = (a, b) => (a > b ? 'a' : 'b');

/** Счёт, который записывается при техническом поражении или неявке: победитель получает «максимум», проигравший — 0. */
export function forfeitScore(format, loser) {
  const w = format === 'bo3' ? 2 : 13;
  return loser === 'a' ? [0, w] : [w, 0];
}

/**
 * Массовое расписание. matches — [{ id, round, position, bye, status, startsAt }].
 * Матчи раунда идут по порядку позиций, по `parallel` штук в одно время; следующий слот — через intervalMin минут.
 * Следующий раунд начинается через интервал после последнего слота предыдущего.
 * Проходы без игры, идущие и сыгранные матчи не трогаются. Уже назначенное время сохраняется, если не overwrite
 * (слот при этом всё равно занят, чтобы не наложить матчи друг на друга).
 * rounds: 'first' — только первый раунд, 'all' — все. Возвращает [{ id, startsAt (ISO) }] только для изменяемых матчей.
 */
export function scheduleMatches(matches, { start, intervalMin, parallel = 1, rounds = 'all', overwrite = false }) {
  const step = intervalMin * 60000;
  let cursor = new Date(start).getTime();
  const byRound = new Map();
  for (const m of matches) {
    if (m.bye || m.status === 'finished' || m.status === 'live' || (rounds === 'first' && m.round > 1)) continue;
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round).push(m);
  }
  const out = [];
  for (const r of [...byRound.keys()].sort((a, b) => a - b)) {
    const list = byRound.get(r).sort((a, b) => a.position - b.position);
    list.forEach((m, i) => {
      if (m.startsAt && !overwrite) return;
      out.push({ id: m.id, startsAt: new Date(cursor + Math.floor(i / parallel) * step).toISOString() });
    });
    cursor += Math.ceil(list.length / parallel) * step;
  }
  return out;
}

/**
 * Счёт по картам для BO3: maps — [{ a, b }] в порядке игры (очки раундов на каждой карте).
 * Серия должна закончиться ровно на 2:0 (две карты) или 2:1 (три карты), на карте ничьей не бывает.
 * Возвращает null, если всё верно, иначе 'bad_score' | 'tie' | 'bad_maps'.
 */
export function validateMaps(maps) {
  if (!Array.isArray(maps) || maps.length < 2 || maps.length > 3) return 'bad_maps';
  let wa = 0, wb = 0;
  for (const m of maps) {
    if (!Number.isInteger(m.a) || !Number.isInteger(m.b) || m.a < 0 || m.b < 0 || m.a > 99 || m.b > 99) return 'bad_score';
    if (m.a === m.b) return 'tie';
    if (m.a > m.b) wa++; else wb++;
  }
  const hi = Math.max(wa, wb);
  return hi === 2 && maps.length === wa + wb ? null : 'bad_maps';
}

/** Счёт серии по картам: [выигранные картами A, выигранные картами B]. */
export function seriesFromMaps(maps) {
  let wa = 0, wb = 0;
  for (const m of maps) if (m.a > m.b) wa++; else wb++;
  return [wa, wb];
}
