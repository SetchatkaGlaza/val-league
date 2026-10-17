import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeamName, disbandBlockers, buildTeamQuery, serializeTeam } from '../src/services/teams-admin.js';
import { ACTIONS, buildEntry } from '../src/services/audit.js';
import { sectionsFor } from '../src/services/permissions.js';

test('название команды: 3–24 символа, пробелы схлопываются, скобки и управляющие символы нельзя', () => {
  assert.deepEqual(normalizeTeamName('  Вологодские   волки '), { name: 'Вологодские волки' });
  assert.equal(normalizeTeamName('ab').error, 'validation');
  assert.equal(normalizeTeamName('x'.repeat(25)).error, 'validation');
  assert.equal(normalizeTeamName('<b>team</b>').error, 'validation');
  assert.equal(normalizeTeamName('te\u0007am').error, 'validation');
  assert.equal(normalizeTeamName(null).error, 'validation');
  assert.equal(normalizeTeamName('x'.repeat(24)).name.length, 24);
});

test('расформировать нельзя, пока есть живая заявка в черновике, анонсе или идущем турнире', () => {
  const reg = (status, tournamentStatus) => ({ status, tournamentStatus });
  assert.equal(disbandBlockers([]), null);
  assert.equal(disbandBlockers([reg('paid', 'finished'), reg('cancelled', 'upcoming'), reg('paid', 'cancelled')]), null);
  assert.equal(disbandBlockers([reg('paid', 'live')]), 'team_in_tournament');
  assert.equal(disbandBlockers([reg('pending_payment', 'upcoming')]), 'team_in_tournament');
  assert.equal(disbandBlockers([reg('waitlist', 'upcoming')]), 'team_in_tournament');
  assert.equal(disbandBlockers([reg('paid', 'draft')]), 'team_in_tournament');
});

test('список команд: поиск экранирует % и _, фильтры, сортировка из белого списка', () => {
  const r = buildTeamQuery({ q: '50%_x', logo: 'no', active: 'yes', sort: 'name' });
  assert.deepEqual(r.vals, ['%50\\%\\_x%']);
  assert.match(r.where, /t\.name ILIKE \$1 ESCAPE '\\' OR t\.slug ILIKE \$1/);
  assert.ok(r.where.includes('t.logo IS NULL'));
  assert.ok(r.where.includes(`'pending_payment','paid','waitlist'`));
  assert.match(r.order, /ORDER BY t\.name ASC, t\.id/);
  assert.match(buildTeamQuery({ sort: 'name; DROP TABLE teams' }).order, /ORDER BY t\.created_at DESC/);
  assert.equal(buildTeamQuery({}).where, '');
  assert.ok(buildTeamQuery({ logo: 'yes' }).where.includes('t.logo IS NOT NULL'));
  assert.ok(!buildTeamQuery({ q: "x' OR 1=1" }).where.includes('1=1'));
});

test('serializeTeam: без токена приглашения', () => {
  const t = serializeTeam({ id: '1', slug: 's', name: 'N', description: null, logo: null, captain_id: 'c', captain_nick: 'Cap', created_at: 'x', invite_token: 'SECRET', members: 5 });
  assert.ok(!JSON.stringify(t).includes('SECRET'));
  assert.deepEqual(t.captain, { id: 'c', nick: 'Cap' });
  assert.equal(t.description, '');
  assert.equal(serializeTeam({ id: '1', slug: 's', name: 'N', captain_id: null }).captain, null);
});

test('журнал знает действия над командами; раздел «Команды» виден и модератору, и админу', () => {
  for (const a of ['team.logo_remove', 'team.description_clear', 'team.rename', 'team.disband']) assert.ok(ACTIONS.includes(a), a);
  assert.ok(sectionsFor('moderator').includes('teams'));
  assert.ok(sectionsFor('admin').includes('teams'));
  assert.ok(!sectionsFor('player').includes('teams'));
  const e = buildEntry({ actor: { id: 'a', nick: 'A', role: 'moderator' }, action: 'team.rename', objectType: 'team', objectId: 't1', label: 'Волки',
    before: { name: 'Плохое' }, after: { name: 'Волки' }, meta: { reason: 'мат' }, diff: true });
  assert.deepEqual(e.before, { name: 'Плохое' });
  assert.deepEqual(e.after, { name: 'Волки' });
  assert.equal(e.object_type, 'team');
});
