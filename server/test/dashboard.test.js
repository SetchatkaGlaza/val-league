import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionItems, plural } from '../src/services/dashboard.js';

test('plural', () => {
  const w = ['матч', 'матча', 'матчей'];
  assert.equal(plural(1, w), 'матч');
  assert.equal(plural(2, w), 'матча');
  assert.equal(plural(5, w), 'матчей');
  assert.equal(plural(11, w), 'матчей');
  assert.equal(plural(21, w), 'матч');
});

test('внимание: сортировка по срочности, без данных — пусто', () => {
  assert.deepEqual(attentionItems({}), []);
  const now = '2026-10-17T12:00:00Z';
  const items = attentionItems({
    now,
    noTime: [{ id: 't1', name: 'Open', n: 3 }],
    expiring: [{ id: 'r1', teamName: 'Alpha', tournamentId: 't1', tournamentName: 'Open', payUntil: '2026-10-17T13:00:00Z' },
      { id: 'r2', teamName: 'Beta', tournamentId: 't1', tournamentName: 'Open', payUntil: '2026-10-17T16:00:00Z' }],
    noBracket: [{ id: 't2', name: 'Cup', startsAt: '2026-10-18T10:00:00Z', paid: 1 }],
    overdue: [{ id: 't3', name: 'Live', n: 2 }],
    refunds: 2,
  });
  assert.deepEqual(items.map((i) => i.kind), ['payment_expiring', 'matches_overdue', 'payment_expiring', 'no_bracket', 'refunds_due', 'matches_no_time']);
  assert.equal(items[0].level, 'danger');
  assert.equal(items[2].level, 'warn');
  assert.match(items.find((i) => i.kind === 'no_bracket').text, /оплаченных команд 1/);
  assert.equal(items[0].href, '/admin/tournaments/t1');
});

test('просроченная оплата помечается как просрочена', () => {
  const [i] = attentionItems({ now: '2026-10-17T12:00:00Z', expiring: [{ teamName: 'A', tournamentId: 't', tournamentName: 'T', payUntil: '2026-10-17T11:00:00Z' }] });
  assert.match(i.text, /просрочена/);
});
