import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, diffObjects, buildEntry, buildAuditFilter, ACTIONS } from '../src/services/audit.js';

const actor = { id: '11111111-1111-1111-1111-111111111111', nick: 'Boss', role: 'admin' };

test('sanitize: секреты убираются, даты в строки, длинные строки обрезаются', () => {
  const out = sanitize({ nick: 'a', password_hash: 'x', token: 'y', nested: { resetToken: 'z', ok: 1 }, at: new Date('2026-10-17T10:00:00Z'), long: 'я'.repeat(600), u: undefined });
  assert.equal(out.password_hash, undefined);
  assert.equal(out.token, undefined);
  assert.equal(out.nested.resetToken, undefined);
  assert.equal(out.nested.ok, 1);
  assert.equal(out.at, '2026-10-17T10:00:00.000Z');
  assert.equal(out.long.length, 501);
  assert.equal(out.u, null);
});

test('diffObjects: только изменившиеся поля', () => {
  const d = diffObjects({ a: 1, b: [1, 2], c: 'x' }, { a: 1, b: [1, 3], c: 'x', d: true });
  assert.deepEqual(d.before, { b: [1, 2], d: null });
  assert.deepEqual(d.after, { b: [1, 3], d: true });
  assert.deepEqual(diffObjects({ a: 1 }, { a: 1 }), { before: null, after: null });
});

test('buildEntry: снимок исполнителя, неизвестное действие запрещено', () => {
  const e = buildEntry({ actor, ip: '1.2.3.4', action: 'tournament.status', objectType: 'tournament', objectId: 'abc', label: 'VAL Open', before: { status: 'draft' }, after: { status: 'upcoming' } });
  assert.equal(e.actor_nick, 'Boss');
  assert.equal(e.actor_role, 'admin');
  assert.equal(e.object_id, 'abc');
  assert.deepEqual(e.after, { status: 'upcoming' });
  assert.equal(e.ip, '1.2.3.4');
  assert.throws(() => buildEntry({ actor, action: 'nope', objectType: 'x' }));
});

test('buildEntry с diff=true', () => {
  const e = buildEntry({ actor, action: 'tournament.update', objectType: 'tournament', before: { fee: 100, name: 'A' }, after: { fee: 200, name: 'A' }, diff: true });
  assert.deepEqual(e.before, { fee: 100 });
  assert.deepEqual(e.after, { fee: 200 });
});

test('buildAuditFilter: пустой, полный, экранирование LIKE', () => {
  assert.deepEqual(buildAuditFilter({}), { where: '', vals: [] });
  const f = buildAuditFilter({ actor: '50%_', action: 'tournament.', objectType: 'match', from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-02T00:00:00Z'), before: '100' });
  assert.match(f.where, /^WHERE actor_nick ILIKE \$1 ESCAPE '\\' AND action LIKE \$2 ESCAPE '\\' AND object_type = \$3 AND created_at >= \$4 AND created_at < \$5 AND id < \$6$/);
  assert.equal(f.vals[0], '%50\\%\\_%');
  assert.equal(f.vals[1], 'tournament.%');
  assert.equal(f.vals.length, 6);
  const one = buildAuditFilter({ action: 'match.result' });
  assert.match(one.where, /action = \$1/);
});

test('в журнале нет дублей действий', () => {
  assert.equal(new Set(ACTIONS).size, ACTIONS.length);
});
