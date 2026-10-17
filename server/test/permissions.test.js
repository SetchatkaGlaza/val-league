import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, STAFF, isStaff, hasRole, sectionsFor, ROLE_LABEL } from '../src/services/permissions.js';

test('роли: игрок не сотрудник, модератор и админ — сотрудники', () => {
  assert.deepEqual(ROLES, ['player', 'moderator', 'admin']);
  assert.equal(isStaff('player'), false);
  assert.equal(isStaff('moderator'), true);
  assert.equal(isStaff('admin'), true);
  assert.equal(isStaff(undefined), false);
  assert.deepEqual(STAFF, ['moderator', 'admin']);
  for (const r of ROLES) assert.ok(ROLE_LABEL[r]);
});

test('hasRole', () => {
  assert.equal(hasRole('admin', 'admin'), true);
  assert.equal(hasRole('moderator', 'admin'), false);
});

test('разделы: журнал только у админа, у игрока ничего', () => {
  assert.ok(sectionsFor('admin').includes('audit'));
  assert.ok(!sectionsFor('moderator').includes('audit'));
  assert.ok(sectionsFor('moderator').includes('dashboard'));
  assert.deepEqual(sectionsFor('player'), []);
  assert.deepEqual(sectionsFor('что-то'), []);
});
