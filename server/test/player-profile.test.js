import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerProfile } from '../src/services/player-profile.js';

const m = (round, a, b, winner, extra = {}) => ({ round, reg_a: a, reg_b: b, winner, status: winner ? 'finished' : 'scheduled', bye: false, ...extra });
const nicks = (...n) => n.map((nick) => ({ nick }));
const T = (slug, day, status, extra = {}) => ({ id: slug, slug, name: `Турнир ${slug}`, starts_at: `2026-0${day}-10T15:00:00Z`, status, team_size: 5, match_format: 'bo1', winner_name: null, ...extra });
const reg = (id, tid, name = 'Альфа', slug = 'alfa', roster = nicks('p1', 'p2')) => ({ id, tournament_id: tid, team_name: name, team_slug: slug, roster });
const run = (regs, tournaments, matches = {}) => buildPlayerProfile({
  nick: 'p1', regs, tournaments: new Map(tournaments.map((t) => [t.id, t])), matchesByT: new Map(Object.entries(matches)),
});
const cup4 = [m(1, 'ra', 'rb', 'a'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', 'a')];

test('нет заявок — пустой профиль', () => {
  assert.deepEqual(run([], []), { nick: 'p1', stats: { tournaments: 0, titles: 0, podiums: 0, bestPlace: null, matchWins: 0, matchLosses: 0 }, history: [] });
});

test('чемпион: титул, лучшее место 1, команда и состав в записи', () => {
  const r = run([reg('ra', 't1')], [T('t1', 5, 'finished')], { t1: cup4 });
  assert.equal(r.history[0].place, 1);
  assert.deepEqual(r.history[0].team, { name: 'Альфа', slug: 'alfa' });
  assert.deepEqual(r.history[0].roster, ['p1', 'p2']);
  assert.deepEqual(r.stats, { tournaments: 1, titles: 1, podiums: 1, bestPlace: 1, matchWins: 2, matchLosses: 0 });
});

test('несколько турниров: порядок от новых к старым, лучшее место и общий счёт', () => {
  const r = run(
    [reg('ra', 't1'), reg('rb', 't2', 'Бета', 'beta')],
    [T('t1', 3, 'finished'), T('t2', 6, 'finished')],
    { t1: cup4, t2: cup4 });
  assert.deepEqual(r.history.map((h) => h.tournament.slug), ['t2', 't1']);
  assert.equal(r.history[0].place, 3);
  assert.equal(r.stats.bestPlace, 1); assert.equal(r.stats.titles, 1); assert.equal(r.stats.podiums, 2);
  assert.equal(r.stats.matchWins, 2); assert.equal(r.stats.matchLosses, 1);
});

test('идущие и будущие турниры в профиль не попадают', () => {
  const r = run([reg('ra', 't1'), reg('ra', 't2')], [T('t1', 5, 'live'), T('t2', 6, 'upcoming')], { t1: cup4, t2: [] });
  assert.equal(r.history.length, 0); assert.equal(r.stats.tournaments, 0);
});

test('команда удалена: ссылка на команду пустая, остальное на месте', () => {
  const r = run([reg('ra', 't1', 'Альфа', null)], [T('t1', 5, 'finished')], { t1: cup4 });
  assert.deepEqual(r.history[0].team, { name: 'Альфа', slug: null });
});

test('участник без призового места: стадия вылета, призов в статистике нет', () => {
  const r = run([reg('rb', 't1')], [T('t1', 5, 'finished')], { t1: [m(1, 'ra', 'rb', 'a'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', 'a'), m(3, 'ra', 'rx', 'a')] });
  assert.equal(r.history.length, 1);
  assert.equal(r.stats.tournaments, 1);
});
