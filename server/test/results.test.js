import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBracket } from '../src/services/bracket.js';
import { computeResults, resultFor } from '../src/services/results.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/**
 * Проигрывает сетку целиком: побеждает команда с меньшим номером (сильнейший сид). Возвращает матчи в формате таблицы matches.
 * stopAfterRound — остановиться после указанного раунда (недосыгранный турнир).
 */
function play(n, stopAfterRound = Infinity) {
  const { matches } = buildBracket(ids(n));
  const key = (r, p) => `${r}:${p}`;
  const byKey = new Map(matches.map((m) => [key(m.round, m.position), m]));
  const rank = (t) => Number(t.slice(1));
  for (const m of [...matches].sort((x, y) => x.round - y.round || x.position - y.position)) {
    if (m.bye || m.round > stopAfterRound || !m.a || !m.b) continue;
    m.winner = rank(m.a) < rank(m.b) ? 'a' : 'b';
    m.status = 'finished';
    if (m.next) { const nx = byKey.get(key(m.next.round, m.next.position)); nx[m.next.slot] = m[m.winner]; }
  }
  return matches.map((m) => ({ round: m.round, reg_a: m.a, reg_b: m.b, winner: m.winner, status: m.status, bye: m.bye }));
}

test('нет матчей — пустые итоги', () => {
  assert.deepEqual(computeResults([]), { totalRounds: 0, first: null, second: null, thirds: [], exits: {} });
});

test('2 команды: победитель и финалист, 3 места нет', () => {
  const r = computeResults(play(2));
  assert.equal(r.first, 't1'); assert.equal(r.second, 't2'); assert.deepEqual(r.thirds, []);
  assert.deepEqual(resultFor(r, 't1'), { place: 1, stage: 'Финал' });
  assert.deepEqual(resultFor(r, 't2'), { place: 2, stage: 'Финал' });
});

test('8 команд: призёры и стадии вылета', () => {
  const r = computeResults(play(8));
  assert.equal(r.totalRounds, 3);
  assert.equal(r.first, 't1'); assert.equal(r.second, 't2');
  assert.deepEqual([...r.thirds].sort(), ['t3', 't4']);
  assert.deepEqual(resultFor(r, 't3'), { place: 3, stage: 'Полуфинал' });
  // сид 5–8 вылетели в четвертьфинале
  for (const t of ['t5', 't6', 't7', 't8']) assert.deepEqual(resultFor(r, t), { place: null, stage: 'Четвертьфинал' });
});

test('3 команды: проход без игры, призёр один', () => {
  const r = computeResults(play(3));
  assert.equal(r.first, 't1'); assert.equal(r.second, 't2');
  assert.deepEqual(r.thirds, ['t3']);
  assert.deepEqual(resultFor(r, 't3'), { place: 3, stage: 'Полуфинал' });
});

test('16 команд: проигравшие в 1/8 финала не получают места', () => {
  const r = computeResults(play(16));
  assert.equal(r.totalRounds, 4);
  assert.deepEqual(resultFor(r, 't16'), { place: null, stage: '1/8 финала' });
  assert.equal(r.thirds.length, 2);
});

test('турнир не доигран: победителя и призёров ещё нет', () => {
  const r = computeResults(play(8, 2));        // сыграны четвертьфиналы и полуфиналы, финал нет
  assert.equal(r.first, null); assert.equal(r.second, null); assert.deepEqual(r.thirds, []);
  assert.deepEqual(resultFor(r, 't5'), { place: null, stage: 'Четвертьфинал' });
  assert.equal(resultFor(r, 't1'), null);       // ещё в игре
  assert.equal(resultFor(r, null), null);
});

test('проходы без игры не считаются поражениями', () => {
  const r = computeResults(play(5));            // сетка 8, три bye
  assert.equal(Object.keys(r.exits).length, 4); // 5 команд: 4 проигравших
  assert.ok(!r.exits.t1);                       // сеяный №1 выиграл всё
});
