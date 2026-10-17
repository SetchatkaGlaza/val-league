import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  buildAuthUrl, readAssertion, verifyWithSteam, personaName, safeNext, signState, readState, loginDecision,
  OPENID_NS, STEAM_LOGIN,
} from '../src/services/steam.js';

const RETURN = 'https://val.test/api/auth/steam/callback';
const ID = '76561198000000001';
const good = () => ({
  'openid.ns': OPENID_NS, 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_LOGIN, 'openid.return_to': RETURN,
  'openid.claimed_id': `https://steamcommunity.com/openid/id/${ID}`, 'openid.identity': `https://steamcommunity.com/openid/id/${ID}`,
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
  'openid.response_nonce': '2026-10-17T10:00:00Zabc', 'openid.assoc_handle': '1234', 'openid.sig': 'c2ln',
});

test('адрес для Steam: нужные параметры и возврат на наш адрес', () => {
  const u = new URL(buildAuthUrl({ returnTo: RETURN, realm: 'https://val.test' }));
  assert.equal(u.origin + u.pathname, STEAM_LOGIN);
  assert.equal(u.searchParams.get('openid.mode'), 'checkid_setup');
  assert.equal(u.searchParams.get('openid.return_to'), RETURN);
  assert.equal(u.searchParams.get('openid.realm'), 'https://val.test');
  assert.equal(u.searchParams.get('openid.ns'), OPENID_NS);
});

test('ответ Steam: правильный ответ даёт Steam ID', () => {
  assert.deepEqual(readAssertion(good(), { returnTo: RETURN }), { ok: true, steamId: ID });
});

test('ответ Steam: отмена, чужой адрес возврата, чужой сервер и подмена ID отклоняются', () => {
  const bad = (patch, reason) => assert.deepEqual(readAssertion({ ...good(), ...patch }, { returnTo: RETURN }), { ok: false, reason });
  bad({ 'openid.mode': 'cancel' }, 'cancelled');
  bad({ 'openid.mode': 'setup_needed' }, 'mode');
  bad({ 'openid.ns': 'x' }, 'ns');
  bad({ 'openid.op_endpoint': 'https://evil.test/openid/login' }, 'endpoint');
  bad({ 'openid.return_to': 'https://evil.test/cb' }, 'return_to');
  bad({ 'openid.claimed_id': 'https://evil.test/openid/id/76561198000000001' }, 'claimed_id');
  bad({ 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123' }, 'claimed_id');
  bad({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000002' }, 'claimed_id');
  bad({ 'openid.signed': 'signed,op_endpoint,claimed_id,identity' }, 'unsigned');
  bad({ 'openid.sig': '' }, 'sig');
  assert.equal(readAssertion({}, { returnTo: RETURN }).ok, false);
  assert.equal(readAssertion({ ...good(), 'openid.claimed_id': [good()['openid.claimed_id']] }, { returnTo: RETURN }).ok, false);
});

const fakeFetch = (text, { ok = true, status = 200, spy } = {}) => async (url, opts) => { spy?.push({ url, opts }); return { ok, status, text: async () => text, json: async () => JSON.parse(text) }; };

test('проверка у Steam: отправляем те же поля с режимом check_authentication', async () => {
  const calls = [];
  const ok = await verifyWithSteam({ ...good(), foo: 'bar' }, fakeFetch('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n', { spy: calls }));
  assert.equal(ok, true);
  assert.equal(calls[0].url, STEAM_LOGIN);
  assert.equal(calls[0].opts.method, 'POST');
  const body = new URLSearchParams(String(calls[0].opts.body));
  assert.equal(body.get('openid.mode'), 'check_authentication');
  assert.equal(body.get('openid.sig'), 'c2ln');
  assert.equal(body.has('foo'), false, 'чужие параметры не пересылаем');
});

test('проверка у Steam: is_valid:false и сбои', async () => {
  assert.equal(await verifyWithSteam(good(), fakeFetch('is_valid:false\n')), false);
  assert.equal(await verifyWithSteam(good(), fakeFetch('is_valid:truex')), false);
  await assert.rejects(verifyWithSteam(good(), fakeFetch('', { ok: false, status: 502 })));
  await assert.rejects(verifyWithSteam(good(), async () => { throw new Error('network'); }));
});

test('имя профиля: из Steam API, иначе запасная подпись', async () => {
  assert.equal(await personaName(ID, { apiKey: '' }), 'Steam …0001');
  assert.equal(await personaName(ID, { apiKey: 'k', fetchImpl: fakeFetch(JSON.stringify({ response: { players: [{ personaname: '  Vasya  ' }] } })) }), 'Vasya');
  assert.equal(await personaName(ID, { apiKey: 'k', fetchImpl: fakeFetch(JSON.stringify({ response: { players: [] } })) }), 'Steam …0001');
  assert.equal(await personaName(ID, { apiKey: 'k', fetchImpl: fakeFetch('', { ok: false, status: 403 }) }), 'Steam …0001');
  assert.equal(await personaName(ID, { apiKey: 'k', fetchImpl: async () => { throw new Error('x'); } }), 'Steam …0001');
  const long = await personaName(ID, { apiKey: 'k', fetchImpl: fakeFetch(JSON.stringify({ response: { players: [{ personaname: 'я'.repeat(100) }] } })) });
  assert.equal([...long].length, 60);
});

test('куда вернуть после входа: только адреса внутри сайта', () => {
  assert.equal(safeNext('/admin/users'), '/admin/users');
  for (const bad of ['//evil.test', 'https://evil.test', '/\\evil.test', '/a\nb', undefined, 5, '/' + 'a'.repeat(300)]) assert.equal(safeNext(bad), '/account', String(bad));
  assert.equal(safeNext('x', '/'), '/');
});

test('состояние входа: подпись, срок, «аудитория»', () => {
  const secret = 'x'.repeat(40);
  const raw = signState(secret, { mode: 'link', next: '/account', userId: 'u1' });
  assert.deepEqual(readState(secret, raw), { mode: 'link', next: '/account', userId: 'u1' });
  assert.equal(readState('y'.repeat(40), raw), null, 'чужой ключ');
  assert.equal(readState(secret, ''), null);
  assert.equal(readState(secret, 'мусор'), null);
  assert.equal(readState(secret, jwt.sign({ sub: 'u1' }, secret, { expiresIn: '2d' })), null, 'токен сессии не годится как состояние');
  assert.equal(readState(secret, jwt.sign({ m: 'login', n: '/' }, secret, { expiresIn: '10m' })), null, 'без аудитории');
  assert.equal(readState(secret, jwt.sign({ m: 'admin', n: '/' }, secret, { expiresIn: '10m', audience: 'steam-state' })), null, 'неизвестный режим');
  const old = jwt.sign({ m: 'login', n: '/' }, secret, { expiresIn: -5, audience: 'steam-state' });
  assert.equal(readState(secret, old), null, 'просрочено');
  assert.equal(readState(secret, signState(secret, { mode: 'login', next: '//evil.test' })).next, '/account', 'next очищается при чтении');
});

test('решение при входе: новый Steam, заблокирован, срок блокировки истёк', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(loginDecision(null, now), 'new');
  assert.equal(loginDecision({ blocked: false }, now), 'ok');
  assert.equal(loginDecision({ blocked: true, blocked_until: null }, now), 'blocked');
  assert.equal(loginDecision({ blocked: true, blocked_until: '2026-10-18T00:00:00Z' }, now), 'blocked');
  assert.equal(loginDecision({ blocked: true, blocked_until: '2026-10-17T11:00:00Z' }, now), 'ok');
});
