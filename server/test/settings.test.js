import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, KEYS, mergeSettings, normalizePatch, changedSettings, bannerActive, publicSettings, ratingPoints, endOfDayMoscow } from '../src/services/settings.js';
import { POINTS, buildRating } from '../src/services/rating.js';
import { ACTIONS } from '../src/services/audit.js';
import { sectionsFor } from '../src/services/permissions.js';

test('умолчания формулы рейтинга совпадают с запасными значениями rating.js', () => {
  assert.deepEqual(ratingPoints(DEFAULTS), POINTS);
});

test('mergeSettings: недостающее — из умолчаний, чужие ключи и значения не того типа игнорируются', () => {
  const s = mergeSettings([{ key: 'contactEmail', value: 'a@b.ru' }, { key: 'ratingPlace1', value: 'много' }, { key: 'чужой', value: 1 }, { key: 'bannerEnabled', value: true }]);
  assert.equal(s.contactEmail, 'a@b.ru');
  assert.equal(s.ratingPlace1, DEFAULTS.ratingPlace1);
  assert.equal(s.bannerEnabled, true);
  assert.ok(!('чужой' in s));
  assert.deepEqual(Object.keys(s).sort(), [...KEYS].sort());
});

test('normalizePatch: приводит значения и отклоняет плохие с именем поля', () => {
  assert.deepEqual(normalizePatch({ contactEmail: '  info@val.gg ' }).values, { contactEmail: 'info@val.gg' });
  assert.deepEqual(normalizePatch({ contactEmail: '' }).values, { contactEmail: '' });
  assert.equal(normalizePatch({ contactEmail: 'не почта' }).field, 'contactEmail');
  assert.equal(normalizePatch({ socialTelegram: 'http://t.me/val' }).field, 'socialTelegram');   // только https
  assert.equal(normalizePatch({ socialVk: 'javascript:alert(1)' }).field, 'socialVk');
  assert.equal(normalizePatch({ socialVk: 'https://vk.com/val league' }).field, 'socialVk');
  assert.equal(normalizePatch({ socialVk: 'https://vk.com/val' }).values.socialVk, 'https://vk.com/val');
  assert.equal(normalizePatch({ ratingMatchWin: -1 }).field, 'ratingMatchWin');
  assert.equal(normalizePatch({ ratingMatchWin: 1.5 }).field, 'ratingMatchWin');
  assert.equal(normalizePatch({ ratingMatchWin: 1001 }).field, 'ratingMatchWin');
  assert.equal(normalizePatch({ ratingMatchWin: '7' }).values.ratingMatchWin, 7);
  assert.equal(normalizePatch({ bannerEnabled: 'да' }).field, 'bannerEnabled');
  assert.equal(normalizePatch({ bannerUntil: '2026-13-40' }).field, 'bannerUntil');
  assert.equal(normalizePatch({ bannerUntil: '2026-02-30' }).field, 'bannerUntil');
  assert.equal(normalizePatch({ bannerText: 'я'.repeat(201) }).field, 'bannerText');
  assert.equal(normalizePatch({ неизвестный: 1 }).field, 'неизвестный');
  assert.equal(normalizePatch(null).error, 'invalid');
  assert.equal(normalizePatch([]).error, 'invalid');
});

test('normalizePatch: места по убыванию, у включённого баннера есть текст', () => {
  assert.equal(normalizePatch({ ratingPlace2: 150 }).field, 'ratingPlace2');           // 2 место больше первого (100)
  assert.equal(normalizePatch({ ratingPlace3: 70 }).field, 'ratingPlace3');           // 3 место больше второго (60)
  assert.ok(normalizePatch({ ratingPlace1: 200, ratingPlace2: 150, ratingPlace3: 100 }).values);
  assert.equal(normalizePatch({ bannerEnabled: true }).field, 'bannerText');
  assert.ok(normalizePatch({ bannerEnabled: true, bannerText: 'Регистрация открыта' }).values);
  assert.ok(normalizePatch({ bannerEnabled: true }, { ...DEFAULTS, bannerText: 'уже есть' }).values);
});

test('changedSettings: в журнал попадает только изменившееся', () => {
  const d = changedSettings(DEFAULTS, { contactEmail: '', ratingPlace1: 120 });
  assert.deepEqual(d, { before: { ratingPlace1: 100 }, after: { ratingPlace1: 120 }, changed: true });
  assert.equal(changedSettings(DEFAULTS, { contactEmail: '' }).changed, false);
});

test('баннер: выключен, без текста, до даты включительно (по Москве), после даты скрыт', () => {
  const on = { ...DEFAULTS, bannerEnabled: true, bannerText: 'Старт турнира' };
  assert.equal(bannerActive(DEFAULTS), false);
  assert.equal(bannerActive({ ...on, bannerText: '' }), false);
  assert.equal(bannerActive(on, new Date('2030-01-01T00:00:00Z')), true);                       // без срока — бессрочно
  const until = { ...on, bannerUntil: '2026-10-20' };
  assert.equal(bannerActive(until, new Date('2026-10-20T20:30:00Z')), true);                     // 23:30 по Москве — ещё действует
  assert.equal(bannerActive(until, new Date('2026-10-20T21:00:01Z')), false);                    // 00:00 по Москве следующего дня — уже нет
  assert.equal(endOfDayMoscow('2026-10-20'), Date.parse('2026-10-20T20:59:59.999Z'));
});

test('публичные настройки: без служебного, только заполненные соцсети, баннер только действующий', () => {
  const s = { ...DEFAULTS, contactEmail: 'info@val.gg', socialTelegram: 'https://t.me/val', bannerEnabled: true, bannerText: 'Ура', ratingPlace1: 500 };
  const p = publicSettings(s, new Date('2026-10-17T00:00:00Z'));
  assert.deepEqual(p, { contactEmail: 'info@val.gg', social: { telegram: 'https://t.me/val' }, banner: { text: 'Ура', until: null } });
  assert.deepEqual(publicSettings(DEFAULTS), { contactEmail: null, social: {}, banner: null });
  assert.ok(!JSON.stringify(p).includes('500'));
});

test('рейтинг считается по формуле из настроек', () => {
  const m = (round, a, b, winner) => ({ round, reg_a: a, reg_b: b, winner, status: 'finished', bye: false });
  const t = { id: 't1', slug: 't1', name: 't1', starts_at: '2026-05-10T15:00:00Z', status: 'finished', team_size: 5, match_format: 'bo1', winner_name: null };
  const input = { regs: [{ id: 'ra', tournament_id: 't1', team_name: 'ra', roster: [{ nick: 'Alex' }] }], tournaments: new Map([['t1', t]]), matchesByT: new Map([['t1', [m(1, 'ra', 'rb', 'a'), m(1, 'rc', 'rd', 'b'), m(2, 'ra', 'rd', 'a')]]]) };
  assert.equal(buildRating(input)[0].points, POINTS.participation + POINTS.place[1] + 2 * POINTS.matchWin);
  const custom = ratingPoints({ ...DEFAULTS, ratingParticipation: 1, ratingPlace1: 50, ratingMatchWin: 10 });
  assert.equal(buildRating({ ...input, points: custom })[0].points, 1 + 50 + 20);
});

test('журнал знает действия настроек; раздел «settings» только у админа', () => {
  assert.ok(ACTIONS.includes('settings.update') && ACTIONS.includes('settings.rating_recalc'));
  assert.ok(sectionsFor('admin').includes('settings'));
  assert.ok(!sectionsFor('moderator').includes('settings'));
});
