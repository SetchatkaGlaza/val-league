import test from 'node:test';
import assert from 'node:assert/strict';
import { roundName } from '../src/services/bracket.js';
import { buildTeamHistory } from '../src/services/team-history.js';

// Матчи собраны вручную (без buildBracket): тест проверяет только логику истории.
const m = (round, a, b, winner, extra = {}) => ({ round, reg_a: a, reg_b: b, winner, status: winner ? 'finished' : 'scheduled', bye: false, ...extra });
const nicks = (...n) => n.map((nick) => ({ nick }));
const T = (slug, day, status, extra = {}) => ({ id: slug, slug, name: `Турнир ${slug}`, starts_at: `2026-0${day}-10T15:00:00Z`, status, team_size: 5, match_format: 'bo1', winner_name: null, ...extra });
const run = (regs, tournaments, matches = {}) => buildTeamHistory({
  regs, tournaments: new Map(tournaments.map((t) => [t.id, t])), matchesByT: new Map(Object.entries(matches)),
});
const reg = (id, tid, name = 'Альфа', roster = nicks('a1', 'a2')) => ({ id, tournament_id: tid, team_name: name, roster });

// Сетка на 4 команды: ra и rb в полуфинале 1, rc и rd в полуфинале 2; финал ra — rd, победил ra.
const cup4 = [m(1, 'ra', 'rb', 'a'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', 'a')];

test('нет заявок — пустая история и нули', () => {
  const r = run([], []);
  assert.deepEqual(r, { stats: { tournaments: 0, titles: 0, podiums: 0, matchWins: 0, matchLosses: 0 }, history: [] });
});

test('победитель: 1 место, счёт 2–0, состав виден у завершённого турнира', () => {
  const [h] = run([reg('ra', 't1')], [T('t1', 5, 'finished')], { t1: cup4 }).history;
  assert.equal(h.place, 1); assert.equal(h.stage, null); assert.equal(h.inGame, false);
  assert.deepEqual(h.record, { wins: 2, losses: 0 });
  assert.deepEqual(h.roster, ['a1', 'a2']); assert.equal(h.hasBracket, true);
});

test('финалист и полуфиналист: 2 и 3 места, поражения считаются', () => {
  const second = run([reg('rd', 't1')], [T('t1', 5, 'finished')], { t1: cup4 }).history[0];
  assert.equal(second.place, 2); assert.deepEqual(second.record, { wins: 1, losses: 1 });
  const third = run([reg('rb', 't1')], [T('t1', 5, 'finished')], { t1: cup4 }).history[0];
  assert.equal(third.place, 3); assert.deepEqual(third.record, { wins: 0, losses: 1 });
});

test('вылет раньше полуфинала: места нет, есть стадия', () => {
  const eight = [
    m(1, 'r1', 'r2', 'a'), m(1, 'r3', 'r4', 'a'), m(1, 'r5', 'r6', 'a'), m(1, 'r7', 'r8', 'a'),
    m(2, 'r1', 'r3', 'a'), m(2, 'r5', 'r7', 'a'), m(3, 'r1', 'r5', 'a'),
  ];
  const h = run([reg('r4', 't1')], [T('t1', 5, 'finished')], { t1: eight }).history[0];
  assert.equal(h.place, null); assert.equal(h.stage, roundName(1, 3));
  // проигравший во втором раунде сетки на 8 команд — полуфиналист: 3 место, отдельной стадии нет
  const semi = run([reg('r7', 't1')], [T('t1', 5, 'finished')], { t1: eight }).history[0];
  assert.equal(semi.place, 3); assert.equal(semi.stage, null);
});

test('проход без игры не считается ни победой, ни матчем', () => {
  // 3 команды: ra проходит в финал без игры, rb играет с rc
  const three = [m(1, 'ra', null, 'a', { bye: true }), m(1, 'rb', 'rc', 'a'), m(2, 'ra', 'rb', 'a')];
  const h = run([reg('ra', 't1')], [T('t1', 5, 'finished')], { t1: three }).history[0];
  assert.deepEqual(h.record, { wins: 1, losses: 0 }); assert.equal(h.place, 1);
});

test('идущий турнир: команда в игре, состав скрыт; выбывшая получает стадию', () => {
  const live = [m(1, 'ra', 'rb', 'a'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', null)];
  const inGame = run([reg('ra', 't1')], [T('t1', 5, 'live')], { t1: live }).history[0];
  assert.equal(inGame.inGame, true); assert.equal(inGame.place, null); assert.deepEqual(inGame.roster, []);
  const out = run([reg('rc', 't1')], [T('t1', 5, 'live')], { t1: live }).history[0];
  assert.equal(out.inGame, false); assert.equal(out.stage, roundName(1, 2));
});

test('турнир закрыт без сетки: победитель определяется по названию, остальные без места', () => {
  const win = run([reg('x', 't1', 'Альфа')], [T('t1', 5, 'finished', { winner_name: 'АЛЬФА' })]).history[0];
  assert.equal(win.place, 1); assert.equal(win.hasBracket, false); assert.equal(win.record, null);
  const other = run([reg('y', 't1', 'Бета')], [T('t1', 5, 'finished', { winner_name: 'Альфа' })]).history[0];
  assert.equal(other.place, null); assert.equal(other.stage, null);
});

test('будущий турнир: заявка есть, в счётчик турниров не входит, состав скрыт', () => {
  const r = run([reg('x', 't1')], [T('t1', 9, 'upcoming')]);
  assert.equal(r.history.length, 1); assert.equal(r.stats.tournaments, 0); assert.deepEqual(r.history[0].roster, []);
});

test('порядок от новых к старым и итоговая статистика', () => {
  const r = run(
    [reg('ra', 't1'), reg('rd', 't2'), reg('rb', 't3')],
    [T('t1', 3, 'finished'), T('t2', 6, 'finished'), T('t3', 8, 'finished')],
    { t1: cup4, t2: cup4, t3: cup4 });
  assert.deepEqual(r.history.map((h) => h.tournament.slug), ['t3', 't2', 't1']);
  assert.deepEqual(r.history.map((h) => h.place), [3, 2, 1]);
  assert.deepEqual(r.stats, { tournaments: 3, titles: 1, podiums: 3, matchWins: 3, matchLosses: 2 });
});

test('заявка на неизвестный турнир пропускается', () => {
  assert.deepEqual(run([reg('x', 'nope')], []).history, []);
});
