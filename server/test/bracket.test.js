import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPow2, seedOrder, shuffle, buildBracket, roundName, validateScore, winnerSlot, forfeitScore, scheduleMatches, validateMaps, seriesFromMaps } from '../src/services/bracket.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

test('nextPow2', () => {
  assert.deepEqual([2, 3, 4, 5, 8, 9, 16, 17, 128].map(nextPow2), [2, 4, 4, 8, 8, 16, 16, 32, 128]);
});

test('seedOrder: 1 и 2 в разных половинах, пары по сумме размер+1', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  for (const size of [4, 8, 16, 32, 64, 128]) {
    const o = seedOrder(size);
    assert.equal(new Set(o).size, size);
    for (let i = 0; i < size; i += 2) assert.equal(o[i] + o[i + 1], size + 1);
    assert.ok(o.indexOf(1) < size / 2 && o.indexOf(2) >= size / 2);
  }
});

test('shuffle: все элементы на месте, генератор подменяется, исходный массив не меняется', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, () => 0);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.notDeepEqual(out, src);
  assert.deepEqual(shuffle(src, (n) => n - 1), src);   // «последний индекс» = ничего не меняет
});

test('buildBracket: слишком мало команд', () => {
  assert.throws(() => buildBracket(['a']), RangeError);
});

test('buildBracket: 2 команды — один финал', () => {
  const b = buildBracket(ids(2));
  assert.equal(b.rounds, 1);
  assert.equal(b.matches.length, 1);
  assert.deepEqual([b.matches[0].a, b.matches[0].b, b.matches[0].status, b.matches[0].bye, b.matches[0].next], ['t1', 't2', 'ready', false, null]);
});

test('buildBracket: 3 команды — сеяный №1 проходит без игры во второй раунд', () => {
  const b = buildBracket(ids(3));
  const r1 = b.matches.filter((m) => m.round === 1);
  assert.equal(r1.length, 2);
  const bye = r1.find((m) => m.bye);
  assert.equal(bye.a, 't1'); assert.equal(bye.status, 'finished'); assert.equal(bye.winner, 'a');
  const final = b.matches.find((m) => m.round === 2);
  assert.equal(final.a, 't1'); assert.equal(final.b, null); assert.equal(final.status, 'pending');
  assert.deepEqual(r1.find((m) => !m.bye).next, { round: 2, position: 1, slot: 'b' });
});

test('buildBracket: инварианты для любого числа команд от 2 до 70', () => {
  for (let n = 2; n <= 70; n++) {
    const teams = ids(n);
    const { size, rounds, matches } = buildBracket(teams);
    assert.equal(matches.length, size - 1, `n=${n}: матчей size-1`);
    assert.equal(matches.filter((m) => m.bye).length, size - n, `n=${n}: bye = size-n`);

    // каждая команда встречается ровно один раз в первом раунде
    const seen = matches.filter((m) => m.round === 1).flatMap((m) => [m.a, m.b]).filter(Boolean);
    assert.deepEqual([...seen].sort(), [...teams].sort(), `n=${n}: все команды в первом раунде`);

    // ссылки next ведут в существующие матчи, слоты не пересекаются
    const key = (m) => `${m.round}:${m.position}`;
    const index = new Map(matches.map((m) => [key(m), m]));
    const fed = new Set();
    for (const m of matches) {
      if (m.round === rounds) { assert.equal(m.next, null); continue; }
      assert.ok(index.has(`${m.next.round}:${m.next.position}`), `n=${n}: next существует`);
      const slot = `${m.next.round}:${m.next.position}:${m.next.slot}`;
      assert.ok(!fed.has(slot), `n=${n}: слот ${slot} занят дважды`);
      fed.add(slot);
    }
    // bye-матч всегда завершён, победитель — единственная команда; готовые матчи имеют обе команды
    for (const m of matches) {
      if (m.bye) assert.ok(m.status === 'finished' && (m.a === null) !== (m.b === null));
      if (m.status === 'ready') assert.ok(m.a && m.b);
      if (m.status === 'pending') assert.ok(!(m.a && m.b));
    }
    // команды, прошедшие без игры, действительно стоят во втором раунде
    for (const m of matches.filter((x) => x.bye)) {
      const nx = index.get(`${m.next.round}:${m.next.position}`);
      assert.equal(nx[m.next.slot], m.a ?? m.b);
    }
  }
});

test('buildBracket: сильнейшие сиды получают bye, 1 и 2 могут встретиться только в финале', () => {
  const { matches, rounds } = buildBracket(ids(12));          // сетка 16, 4 свободных места
  const byeTeams = matches.filter((m) => m.bye).map((m) => m.a ?? m.b).sort();
  assert.deepEqual(byeTeams, ['t1', 't2', 't3', 't4']);
  // t1 и t2 — в разных половинах сетки
  const half = (t) => matches.find((m) => m.round === 1 && (m.a === t || m.b === t)).position <= 4 ? 'top' : 'bottom';
  assert.notEqual(half('t1'), half('t2'));
  assert.equal(rounds, 4);
});

test('roundName', () => {
  assert.deepEqual([1, 2, 3, 4].map((r) => roundName(r, 4)), ['1/8 финала', 'Четвертьфинал', 'Полуфинал', 'Финал']);
  assert.equal(roundName(1, 1), 'Финал');
  assert.equal(roundName(1, 5), '1/16 финала');
});

test('validateScore: BO1 и BO3', () => {
  assert.equal(validateScore('bo1', 13, 7), null);
  assert.equal(validateScore('bo1', 16, 14), null);
  assert.equal(validateScore('bo1', 0, 13), null);
  assert.equal(validateScore('bo1', 13, 13), 'tie');
  assert.equal(validateScore('bo1', -1, 13), 'bad_score');
  assert.equal(validateScore('bo1', 1.5, 13), 'bad_score');
  assert.equal(validateScore('bo1', 100, 3), 'bad_score');
  assert.equal(validateScore('bo3', 2, 0), null);
  assert.equal(validateScore('bo3', 1, 2), null);
  assert.equal(validateScore('bo3', 2, 2), 'tie');
  assert.equal(validateScore('bo3', 3, 0), 'bad_score');
  assert.equal(validateScore('bo3', 1, 0), 'bad_score');
  assert.equal(validateScore('bo3', '2', 0), 'bad_score');
});

test('winnerSlot', () => {
  assert.equal(winnerSlot(13, 7), 'a');
  assert.equal(winnerSlot(1, 2), 'b');
});

test('forfeitScore: проигравшая сторона получает 0', () => {
  assert.deepEqual(forfeitScore('bo1', 'a'), [0, 13]);
  assert.deepEqual(forfeitScore('bo1', 'b'), [13, 0]);
  assert.deepEqual(forfeitScore('bo3', 'a'), [0, 2]);
  assert.deepEqual(forfeitScore('bo3', 'b'), [2, 0]);
  for (const f of ['bo1', 'bo3']) for (const l of ['a', 'b']) {
    const [a, b] = forfeitScore(f, l);
    assert.equal(validateScore(f, a, b), null);
    assert.equal(winnerSlot(a, b), l === 'a' ? 'b' : 'a');
  }
});

test('scheduleMatches: слоты, параллельные матчи, раунды и пропуски', () => {
  const plan = buildBracket(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
  const ms = plan.matches.map((m, i) => ({ id: `m${i}`, round: m.round, position: m.position, bye: m.bye, status: m.status, startsAt: null }));
  const start = '2026-11-01T10:00:00.000Z', H = 3600000, T = (iso) => new Date(iso).getTime();
  const base = T(start);
  const byId = (res) => Object.fromEntries(res.map((r) => [r.id, T(r.startsAt)]));

  // 8 команд: 4 + 2 + 1 матч, по одному каждый час
  let r = byId(scheduleMatches(ms, { start, intervalMin: 60 }));
  const r1 = ms.filter((m) => m.round === 1).map((m) => r[m.id]);
  assert.deepEqual(r1, [0, 1, 2, 3].map((i) => base + i * H));
  const r2 = ms.filter((m) => m.round === 2).map((m) => r[m.id]);
  assert.deepEqual(r2, [base + 4 * H, base + 5 * H]);
  assert.equal(r[ms.find((m) => m.round === 3).id], base + 6 * H);

  // по 2 одновременно, только первый раунд
  r = scheduleMatches(ms, { start, intervalMin: 90, parallel: 2, rounds: 'first' });
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => T(x.startsAt)), [base, base, base + 1.5 * H, base + 1.5 * H]);

  // уже назначенное время не трогаем без overwrite, но слот остаётся занятым
  const kept = ms.map((m) => (m.id === 'm0' ? { ...m, startsAt: '2026-12-01T00:00:00.000Z' } : m));
  r = scheduleMatches(kept, { start, intervalMin: 60, rounds: 'first' });
  assert.equal(r.length, 3);
  assert.equal(T(r[0].startsAt), base + H);
  assert.equal(scheduleMatches(kept, { start, intervalMin: 60, rounds: 'first', overwrite: true }).length, 4);

  // сыгранные, идущие и проходы без игры пропускаются
  const odd = buildBracket(['a', 'b', 'c', 'd', 'e']).matches.map((m, i) => ({ id: `o${i}`, round: m.round, position: m.position, bye: m.bye, status: m.status, startsAt: null }));
  const first = odd.filter((m) => m.round === 1 && !m.bye);
  assert.ok(odd.some((m) => m.bye));
  first[0].status = 'live';
  const res = scheduleMatches(odd, { start, intervalMin: 30, rounds: 'first' });
  assert.equal(res.length, first.length - 1);
  assert.ok(res.every((x) => !odd.find((m) => m.id === x.id).bye && x.id !== first[0].id));
});

test('validateMaps и seriesFromMaps: серия BO3 по картам', () => {
  const m = (...p) => p.map(([a, b]) => ({ a, b }));
  assert.equal(validateMaps(m([13, 7], [13, 9])), null);                       // 2:0
  assert.equal(validateMaps(m([13, 7], [9, 13], [13, 11])), null);             // 2:1
  assert.equal(validateMaps(m([7, 13], [9, 13])), null);                       // 0:2
  assert.equal(validateMaps(m([13, 7])), 'bad_maps');                          // одна карта
  assert.equal(validateMaps(m([13, 7], [13, 9], [13, 1])), 'bad_maps');        // третья карта после 2:0
  assert.equal(validateMaps(m([13, 7], [9, 13])), 'bad_maps');                 // 1:1, нужна третья
  assert.equal(validateMaps(m([13, 13], [13, 9])), 'tie');
  assert.equal(validateMaps(m([13.5, 7], [13, 9])), 'bad_score');
  assert.equal(validateMaps(m([100, 7], [13, 9])), 'bad_score');
  assert.equal(validateMaps(null), 'bad_maps');
  assert.deepEqual(seriesFromMaps(m([13, 7], [9, 13], [13, 11])), [2, 1]);
  assert.deepEqual(seriesFromMaps(m([7, 13], [9, 13])), [0, 2]);
  for (const x of [[2, 0], [2, 1], [0, 2], [1, 2]]) assert.equal(validateScore('bo3', x[0], x[1]), null);
});
