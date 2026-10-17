import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/routes/admin.js';
import { requireRole } from '../src/middleware/auth.js';

const guards = (layer) => layer.route.stack.map((l) => l.handle).filter((f) => f.roles);

test('requireRole: пускает только указанные роли', () => {
  const run = (role, ...allowed) => {
    let status = null, nexted = false;
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    requireRole(...allowed)({ user: role ? { role } : undefined }, res, () => { nexted = true; });
    return { status, nexted };
  };
  assert.deepEqual(run('admin', 'admin'), { status: null, nexted: true });
  assert.deepEqual(run('moderator', 'admin'), { status: 403, nexted: false });
  assert.deepEqual(run('player', 'moderator', 'admin'), { status: 403, nexted: false });
  assert.deepEqual(run(undefined, 'admin'), { status: 403, nexted: false });
});

test('весь /api/admin закрыт ролью на уровне роутера: первые два слоя — requireAuth и staff', () => {
  const [auth, staff] = router.stack;
  assert.ok(auth && staff);
  assert.deepEqual(staff.handle.roles, ['moderator', 'admin']);
});

test('права по маршрутам: админские операции недоступны модератору', () => {
  const adminOnly = [
    ['get', '/audit'], ['post', '/tournaments'], ['patch', '/tournaments/:id'], ['post', '/tournaments/:id/status'], ['delete', '/tournaments/:id'],
    ['post', '/tournaments/:id/bracket'], ['delete', '/tournaments/:id/bracket'],
    ['get', '/users'], ['get', '/users/:id'], ['post', '/users/:id/block'], ['post', '/users/:id/unblock'], ['post', '/users/:id/role'],
    ['post', '/users/:id/verify-email'], ['post', '/users/:id/reset-steam'], ['post', '/users/:id/reset-telegram'], ['post', '/users/:id/nick'],
    ['post', '/teams/:id/disband'],
    ['post', '/tournaments/:id/duplicate'], ['post', '/tournaments/:id/cancel'], ['delete', '/notes/:id'],
    ['get', '/settings'], ['patch', '/settings'], ['post', '/settings/rating-recalc'],
  ];
  const staffOk = [
    ['get', '/dashboard'], ['get', '/tournaments'], ['get', '/tournaments/:id/registrations'], ['post', '/registrations/:id/confirm'],
    ['post', '/registrations/:id/cancel'], ['put', '/matches/:id/result'], ['patch', '/matches/:id'], ['post', '/tournaments/:id/schedule'],
    ['get', '/teams'], ['get', '/teams/:id'], ['post', '/teams/:id/remove-logo'], ['post', '/teams/:id/clear-description'], ['post', '/teams/:id/rename'],
    ['get', '/tournaments/:id/export'], ['post', '/tournaments/:id/refunds-done'],
    ['post', '/matches/:id/rollback'], ['get', '/matches/:id/history'], ['get', '/tournaments/:id/notes'], ['post', '/tournaments/:id/notes'],
  ];
  const routes = router.stack.filter((l) => l.route);
  const find = (m, p) => routes.find((l) => l.route.path === p && l.route.methods[m]);
  for (const [m, p] of adminOnly) {
    const l = find(m, p); assert.ok(l, `нет маршрута ${m} ${p}`);
    assert.ok(guards(l).some((g) => g.roles.length === 1 && g.roles[0] === 'admin'), `${m} ${p} должен быть только для админа`);
  }
  for (const [m, p] of staffOk) {
    const l = find(m, p); assert.ok(l, `нет маршрута ${m} ${p}`);
    assert.equal(guards(l).length, 0, `${m} ${p} открыт сотрудникам`);
  }
});

test('каждый маршрут админки покрыт одним из списков выше (новый маршрут без решения о правах не пройдёт)', () => {
  const known = new Set(['/me', '/dashboard', '/audit', '/tournaments', '/tournaments/:id', '/tournaments/:id/status', '/tournaments/:id/bracket', '/tournaments/:id/schedule',
    '/matches/:id/result', '/matches/:id', '/tournaments/:id/registrations', '/registrations/:id/confirm', '/registrations/:id/cancel', '/registrations/:id/refunded',
    '/users', '/users/:id', '/users/:id/block', '/users/:id/unblock', '/users/:id/role', '/users/:id/verify-email', '/users/:id/reset-steam', '/users/:id/reset-telegram', '/users/:id/nick',
    '/teams', '/teams/:id', '/teams/:id/remove-logo', '/teams/:id/clear-description', '/teams/:id/rename', '/teams/:id/disband',
    '/tournaments/:id/duplicate', '/tournaments/:id/cancel', '/tournaments/:id/export', '/tournaments/:id/refunds-done',
    '/matches/:id/rollback', '/matches/:id/history', '/tournaments/:id/notes', '/notes/:id',
    '/settings', '/settings/rating-recalc']);
  for (const l of router.stack.filter((x) => x.route)) assert.ok(known.has(l.route.path), `новый маршрут ${l.route.path}: решите, кому он доступен, и добавьте в тест`);
});
