import test from 'node:test';
import assert from 'node:assert/strict';
import { rollbackBlocker, historyItem, noteItem, nextAfterRollback } from '../src/services/match-tools.js';
import { ACTIONS } from '../src/services/audit.js';

const done = { bye: false, status: 'finished', winner: 'a' };

test('откат: можно, пока следующий матч не начат', () => {
  assert.equal(rollbackBlocker({ tournamentStatus: 'live', match: done, next: { status: 'pending' } }), null);
  assert.equal(rollbackBlocker({ tournamentStatus: 'live', match: done, next: { status: 'ready' } }), null);
});
test('откат: нельзя, если следующий матч идёт или сыгран', () => {
  assert.equal(rollbackBlocker({ tournamentStatus: 'live', match: done, next: { status: 'live' } }), 'next_match_played');
  assert.equal(rollbackBlocker({ tournamentStatus: 'live', match: done, next: { status: 'finished' } }), 'next_match_played');
});
test('откат финала возможен в завершённом турнире', () => {
  assert.equal(rollbackBlocker({ tournamentStatus: 'finished', match: done, next: null }), null);
});
test('откат: нельзя без результата, в проходе без игры и в неподходящем статусе турнира', () => {
  assert.equal(rollbackBlocker({ tournamentStatus: 'live', match: { ...done, status: 'ready', winner: null }, next: null }), 'not_finished');
  assert.equal(rollbackBlocker({ tournamentStatus: 'live', match: { ...done, bye: true }, next: null }), 'bye_match');
  for (const s of ['draft', 'upcoming', 'cancelled']) assert.equal(rollbackBlocker({ tournamentStatus: s, match: done, next: null }), 'bad_state');
});
test('следующий матч после отката ждёт соперника', () => assert.deepEqual(nextAfterRollback(), { status: 'pending' }));

test('historyItem: без IP, причина берётся из meta', () => {
  const h = historyItem({ id: 7n, created_at: 'x', actor_nick: 'boss', actor_role: 'moderator', action: 'match.rollback', before: { a: 1 }, after: null, meta: { reason: 'ошибка' }, ip: '1.2.3.4' });
  assert.deepEqual(h, { id: '7', at: 'x', actor: { nick: 'boss', role: 'moderator' }, action: 'match.rollback', before: { a: 1 }, after: null, reason: 'ошибка' });
  assert.equal(historyItem({ id: 1, actor_nick: 'a', actor_role: 'admin', action: 'match.result', meta: null }).reason, null);
});
test('noteItem', () => {
  assert.deepEqual(noteItem({ id: 3, match_id: null, match_label: null, body: 'текст', created_at: 't', author_nick: 'm', author_role: 'moderator' }),
    { id: '3', matchId: null, matchLabel: null, body: 'текст', at: 't', author: { nick: 'm', role: 'moderator' } });
});
test('новые действия журнала', () => { for (const a of ['match.rollback', 'note.create', 'note.delete']) assert.ok(ACTIONS.includes(a)); });
