import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRating, entryPoints, findInRating, POINTS } from '../src/services/rating.js';

const m = (round, a, b, winner, extra = {}) => ({ round, reg_a: a, reg_b: b, winner, status: winner ? 'finished' : 'scheduled', bye: false, ...extra });
const nicks = (...n) => n.map((nick) => ({ nick }));
const T = (slug, day, status) => ({ id: slug, slug, name: slug, starts_at: `2026-0${day}-10T15:00:00Z`, status, team_size: 5, match_format: 'bo1', winner_name: null });
const reg = (id, tid, roster) => ({ id, tournament_id: tid, team_name: id, roster });
const run = (regs, ts, matches = {}) => buildRating({ regs, tournaments: new Map(ts.map((t) => [t.id, t])), matchesByT: new Map(Object.entries(matches)) });
const cup4 = [m(1, 'ra', 'rb', 'a'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', 'a')];

test('нет заявок — пустой рейтинг', () => assert.deepEqual(run([], []), []));

test('очки: победитель = участие + место + победы в матчах', () => {
  const [r] = run([reg('ra', 't1', nicks('Alex'))], [T('t1', 5, 'finished')], { t1: cup4 });
  assert.equal(r.points, POINTS.participation + POINTS.place[1] + 2 * POINTS.matchWin);
  assert.deepEqual([r.titles, r.podiums, r.tournaments, r.matchWins, r.matchLosses, r.rank], [1, 1, 1, 2, 0, 1]);
});

test('порядок: по очкам, команда победителя выше финалиста и полуфиналиста', () => {
  const regs = [reg('ra', 't1', nicks('Win')), reg('rd', 't1', nicks('Fin')), reg('rb', 't1', nicks('Semi'))];
  const r = run(regs, [T('t1', 5, 'finished')], { t1: cup4 });
  assert.deepEqual(r.map((x) => x.nick), ['Win', 'Fin', 'Semi']);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3]);
});

test('равные очки делят место', () => {
  const regs = [reg('rb', 't1', nicks('S1')), reg('rc', 't1', nicks('S2'))];
  const r = run(regs, [T('t1', 5, 'finished')], { t1: [m(1, 'rb', 'ra', 'b'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', 'a')] });
  assert.equal(r[0].rank, 1); assert.equal(r[1].rank, 1);
});

test('очки суммируются по турнирам; ник без учёта регистра', () => {
  const regs = [reg('ra', 't1', nicks('Alex')), reg('ra', 't2', nicks('alex'))];
  const r = run(regs, [T('t1', 3, 'finished'), T('t2', 5, 'finished')], { t1: cup4, t2: cup4 });
  assert.equal(r.length, 1); assert.equal(r[0].tournaments, 2); assert.equal(r[0].titles, 2);
  assert.equal(r[0].points, 2 * entryPoints({ place: 1, record: { wins: 2, losses: 0 } }));
});

test('идущие и будущие турниры не считаются; повтор ника в составе не удваивает очки', () => {
  assert.deepEqual(run([reg('ra', 't1', nicks('A'))], [T('t1', 5, 'live')], { t1: cup4 }), []);
  const [r] = run([reg('ra', 't1', nicks('A', 'a'))], [T('t1', 5, 'finished')], { t1: cup4 });
  assert.equal(r.tournaments, 1);
});

test('findInRating: место и очки игрока, регистр не важен; нет в списке — null', () => {
  const list = run([reg('ra', 't1', nicks('Win')), reg('rd', 't1', nicks('Fin'))], [T('t1', 5, 'finished')], { t1: cup4 });
  const w = findInRating(list, 'WIN');
  assert.deepEqual([w.rank, w.total, w.points > 0], [1, 2, true]);
  assert.equal(findInRating(list, 'Nobody'), null);
  assert.equal(findInRating([], 'Win'), null);
});
