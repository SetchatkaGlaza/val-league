import test from 'node:test';
import assert from 'node:assert/strict';
import { NICK_RE, normalizeReason, untilFromDay, guardUserAction, canResetSteam, buildUserQuery, serializeUser } from '../src/services/users.js';
import { ACTIONS } from '../src/services/audit.js';
import { sectionsFor } from '../src/services/permissions.js';

const admin = { id: 'a1', role: 'admin' };
const user = (o = {}) => ({ id: 'u1', role: 'player', blocked: false, ...o });

test('ник: буквы, цифры, _ - ., 3–20 символов', () => {
  for (const ok of ['Vasya', 'Вася_77', 'a.b-c', 'abc']) assert.ok(NICK_RE.test(ok), ok);
  for (const bad of ['ab', 'a'.repeat(21), 'с пробелом', 'ник!', '<b>x</b>', '']) assert.ok(!NICK_RE.test(bad), bad);
});

test('причина: пробелы схлопываются', () => {
  assert.equal(normalizeReason('  читы   в\n матче '), 'читы в матче');
  assert.equal(normalizeReason(null), '');
});

test('срок блокировки: конец выбранного дня по Москве', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  assert.equal(untilFromDay('2026-10-20', now).until.toISOString(), '2026-10-20T21:00:00.000Z');   // 21:00 UTC = 00:00 МСК 21-го
  assert.equal(untilFromDay('2026-10-17', now).until.toISOString(), '2026-10-17T21:00:00.000Z');   // сегодня ещё действует
  assert.equal(untilFromDay('2026-10-16', now).error, 'past');
  assert.equal(untilFromDay('2036-10-20', now).error, 'too_far');
  assert.equal(untilFromDay('вчера', now).error, 'validation');
  assert.equal(untilFromDay('2026-02-31', now).error, 'validation');
});

test('блокировка: себя и последнего админа нельзя', () => {
  assert.equal(guardUserAction('block', { actor: admin, target: admin, otherAdmins: 3 }), 'self_forbidden');
  assert.equal(guardUserAction('block', { actor: admin, target: user({ role: 'admin' }), otherAdmins: 0 }), 'last_admin');
  assert.equal(guardUserAction('block', { actor: admin, target: user({ role: 'admin' }), otherAdmins: 1 }), null);
  assert.equal(guardUserAction('block', { actor: admin, target: user() }), null);
});

test('роль: себя понизить нельзя, последнего админа тоже, остальное можно', () => {
  assert.equal(guardUserAction('role', { actor: admin, target: admin, newRole: 'player', otherAdmins: 2 }), 'self_forbidden');
  assert.equal(guardUserAction('role', { actor: admin, target: user({ role: 'admin' }), newRole: 'moderator', otherAdmins: 0 }), 'last_admin');
  assert.equal(guardUserAction('role', { actor: admin, target: user({ role: 'admin' }), newRole: 'moderator', otherAdmins: 1 }), null);
  assert.equal(guardUserAction('role', { actor: admin, target: user(), newRole: 'admin' }), null);
  assert.equal(guardUserAction('role', { actor: admin, target: user(), newRole: 'moderator' }), null);
  assert.equal(guardUserAction('role', { actor: admin, target: user(), newRole: 'player' }), 'no_change');
  assert.equal(guardUserAction('role', { actor: admin, target: user(), newRole: 'бог' }), 'validation');
});

test('сброс Steam: нужны почта и пароль, иначе не войти', () => {
  assert.equal(canResetSteam({ steam_id: null }), 'not_linked');
  assert.equal(canResetSteam({ steam_id: '1', email: null, has_password: false }), 'last_login_method');
  assert.equal(canResetSteam({ steam_id: '1', email: 'a@b.c', has_password: false }), 'last_login_method');
  assert.equal(canResetSteam({ steam_id: '1', email: 'a@b.c', has_password: true }), null);
});

test('список: поиск экранирует % и _, значения идут параметрами, сортировка из белого списка', () => {
  const r = buildUserQuery({ q: '50%_x', role: 'moderator', verified: 'no', blocked: 'yes', steam: 'yes', telegram: 'no', sort: 'nick' });
  assert.deepEqual(r.vals, ['%50\\%\\_x%', 'moderator']);
  assert.match(r.where, /u\.nick ILIKE \$1 ESCAPE '\\' OR u\.email ILIKE \$1/);
  assert.match(r.where, /u\.role = \$2/);
  for (const part of ['email_verified_at IS NULL', 'u.blocked', 'steam_id IS NOT NULL', 'telegram_id IS NULL']) assert.ok(r.where.includes(part), part);
  assert.match(r.order, /ORDER BY u\.nick ASC, u\.id/);
  assert.match(buildUserQuery({ sort: "nick; DROP TABLE users" }).order, /ORDER BY u\.created_at DESC/);
  assert.equal(buildUserQuery({}).where, '');
  assert.ok(!buildUserQuery({ q: "x' OR 1=1" }).where.includes('1=1'));
});

test('serializeUser: без хеша пароля, срок блокировки и признак «истёк»', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  const u = serializeUser({ id: '1', nick: 'N', email: 'a@b.c', email_verified_at: now, role: 'player', password_hash: 'secret', steam_id: '7', steam_name: 'S', telegram_id: null,
    blocked: true, blocked_reason: 'читы', blocked_until: '2026-10-16T00:00:00Z', created_at: now }, now);
  assert.equal(u.hasPassword, true);
  assert.ok(!JSON.stringify(u).includes('secret'));
  assert.deepEqual(u.steam, { id: '7', name: 'S' });
  assert.equal(u.telegram, null);
  assert.equal(u.blocked.expired, true);
  assert.equal(serializeUser({ id: '1', nick: 'N', role: 'player', blocked: false }).blocked, null);
});

test('журнал знает действия над пользователями, админ видит раздел «users», модератор нет', () => {
  for (const a of ['user.block', 'user.unblock', 'user.role', 'user.verify_email', 'user.reset_steam', 'user.reset_telegram', 'user.nick']) assert.ok(ACTIONS.includes(a), a);
  assert.ok(sectionsFor('admin').includes('users'));
  assert.ok(!sectionsFor('moderator').includes('users'));
});
