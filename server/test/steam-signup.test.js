import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/index.js';
import { config } from '../src/config.js';
import { signSignup, readSignup, canUnlinkSteam, signState } from '../src/services/steam.js';
import * as steam from '../src/controllers/steam.js';
import { unlinkSteam } from '../src/controllers/account.js';
import jwt from 'jsonwebtoken';

const SECRET = config.jwtSecret;
const SID = '76561198000000001';

// ---------- Подставная БД: только то, что нужно этим сценариям ----------
function fakeDb() {
  const db = { users: [], log: [], busy: [] };
  const run = async (sql, p = []) => {
    db.log.push(sql);
    if (/^INSERT INTO users/.test(sql)) {
      if (db.users.some((u) => u.nick.toLowerCase() === p[0].toLowerCase())) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'users_nick_key' });
      if (db.users.some((u) => u.steam_id === p[1])) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'users_steam_id_key' });
      const u = { id: `u${db.users.length + 1}`, nick: p[0], steam_id: p[1], steam_name: p[2], email: null, password_hash: null, email_verified_at: null, role: 'player', blocked: false };
      db.users.push(u); return { rows: [u], rowCount: 1 };
    }
    if (/^SELECT \* FROM users WHERE id/.test(sql)) return { rows: db.users.filter((u) => u.id === p[0]) };
    if (/^SELECT \* FROM users WHERE steam_id/.test(sql)) return { rows: db.users.filter((u) => u.steam_id === p[0]) };
    if (/FROM tournament_registrations/.test(sql)) return { rows: db.busy };
    if (/^UPDATE users SET steam_id = NULL/.test(sql)) { const u = db.users.find((x) => x.id === p[0]); u.steam_id = null; u.steam_name = null; return { rows: [u] }; }
    if (/^UPDATE users SET blocked/.test(sql)) return { rows: [], rowCount: 0 };
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    throw new Error(`неожиданный SQL: ${sql}`);
  };
  pool.query = run;
  pool.connect = async () => ({ query: run, release() {} });
  return db;
}
const mkRes = () => {
  const r = { cookies: {}, cleared: [], code: 200, body: null, redirectTo: null };
  r.cookie = (n, v) => { r.cookies[n] = v; };
  r.clearCookie = (n) => { r.cleared.push(n); };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.redirect = (u) => { r.redirectTo = u; };
  return r;
};
const call = async (fn, req) => { const res = mkRes(); try { await fn({ body: {}, cookies: {}, query: {}, ...req }, res); } catch (e) { res.err = e; } return res; };
const cookieFor = (o = {}) => ({ val_steam_new: signSignup(SECRET, { steamId: SID, name: 'ProPlayer', next: '/account', ...o }) });

test('signSignup/readSignup: круг, чужая подпись, просрочка, плохой Steam ID, чужая аудитория', () => {
  const t = signSignup(SECRET, { steamId: SID, name: 'N', next: '/teams' });
  assert.deepEqual(readSignup(SECRET, t), { steamId: SID, name: 'N', next: '/teams' });
  assert.equal(readSignup('другой-секрет-другой-секрет-другой', t), null);
  assert.equal(readSignup(SECRET, ''), null);
  assert.equal(readSignup(SECRET, signState(SECRET, { mode: 'login', next: '/' })), null);   // токен состояния входа не годится
  assert.equal(readSignup(SECRET, jwt.sign({ sub: 'u1' }, SECRET)), null);                    // токен сессии не годится
  assert.equal(readSignup(SECRET, signSignup(SECRET, { steamId: '123', name: 'x', next: '/' })), null);
  assert.equal(readSignup(SECRET, jwt.sign({ s: SID }, SECRET, { audience: 'steam-signup', expiresIn: -10 })), null);
  assert.equal(readSignup(SECRET, signSignup(SECRET, { steamId: SID, name: 'x', next: '//evil.com' })).next, '/account');
});

test('canUnlinkSteam: нужен подтверждённый вход по почте и паролю', () => {
  const ok = { steam_id: SID, email: 'a@b.ru', password_hash: 'h', email_verified_at: new Date() };
  assert.equal(canUnlinkSteam(ok), null);
  assert.equal(canUnlinkSteam({ ...ok, steam_id: null }), 'not_linked');
  assert.equal(canUnlinkSteam({ ...ok, email: null }), 'last_login_method');
  assert.equal(canUnlinkSteam({ ...ok, password_hash: null }), 'last_login_method');
  assert.equal(canUnlinkSteam({ ...ok, email_verified_at: null }), 'last_login_method');
});

test('регистрация: создаёт аккаунт без почты и пароля, выдаёт сессию, гасит cookie', async () => {
  const db = fakeDb();
  const r = await call(steam.register, { cookies: cookieFor(), body: { nick: 'Shadow', terms: true } });
  assert.equal(r.err, undefined);
  assert.equal(r.code, 201);
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].steam_id, SID);
  assert.equal(db.users[0].steam_name, 'ProPlayer');
  assert.equal(db.users[0].email, null);
  assert.ok(r.cookies[config.cookieName], 'cookie сессии выдана');
  assert.ok(r.cleared.includes('val_steam_new'), 'cookie подтверждения погашена');
  assert.equal(r.body.user.nick, 'Shadow');
  assert.equal(r.body.user.email, null);
  assert.equal(r.body.user.hasPassword, false);
  assert.equal(r.body.next, '/account');
  assert.equal(r.body.user.password_hash, undefined);
});

test('регистрация без cookie или с чужой cookie — 401, аккаунт не создаётся', async () => {
  const db = fakeDb();
  for (const cookies of [{}, { val_steam_new: 'мусор' }, { val_steam_new: signState(SECRET, { mode: 'login', next: '/' }) }]) {
    const r = await call(steam.register, { cookies, body: { nick: 'Shadow', terms: true } });
    assert.equal(r.err?.status, 401); assert.equal(r.err?.code, 'steam_session_expired');
  }
  assert.equal(db.users.length, 0);
});

test('регистрация: Steam ID из тела запроса игнорируется', async () => {
  const db = fakeDb();
  const r = await call(steam.register, { cookies: cookieFor(), body: { nick: 'Shadow', terms: true, steamId: '76561198999999999', steam_id: '76561198999999999' } });
  assert.equal(r.code, 201);
  assert.equal(db.users[0].steam_id, SID);
});

test('регистрация: проверка ника и согласия', async () => {
  const db = fakeDb();
  for (const body of [{ nick: 'ab', terms: true }, { nick: 'bad nick!', terms: true }, { nick: 'admin', terms: true }, { nick: 'Shadow' }, { nick: 'Shadow', terms: false }, {}]) {
    const r = await call(steam.register, { cookies: cookieFor(), body });
    assert.equal(r.err?.status, 400, JSON.stringify(body)); assert.equal(r.err.code, 'validation');
  }
  assert.equal(db.users.length, 0);
});

test('регистрация: занятый ник (без учёта регистра) — 409 nick_taken, cookie остаётся для повтора', async () => {
  const db = fakeDb();
  db.users.push({ id: 'u0', nick: 'Shadow', steam_id: null, email: 'a@b.ru' });
  const r = await call(steam.register, { cookies: cookieFor(), body: { nick: 'shadow', terms: true } });
  assert.equal(r.err.status, 409); assert.equal(r.err.code, 'nick_taken'); assert.equal(r.err.field, 'nick');
  assert.equal(r.cleared.length, 0);
  assert.equal(db.users.length, 1);
  const r2 = await call(steam.register, { cookies: cookieFor(), body: { nick: 'Shadow2', terms: true } });
  assert.equal(r2.code, 201);
});

test('регистрация: этот Steam уже зарегистрирован — 409 steam_exists, чужой аккаунт не затронут, сессии нет', async () => {
  const db = fakeDb();
  db.users.push({ id: 'u0', nick: 'Owner', steam_id: SID, email: 'o@b.ru', password_hash: 'h' });
  const r = await call(steam.register, { cookies: cookieFor(), body: { nick: 'Shadow', terms: true } });
  assert.equal(r.err.status, 409); assert.equal(r.err.code, 'steam_exists');
  assert.equal(r.cookies[config.cookieName], undefined);
  assert.equal(db.users.length, 1); assert.equal(db.users[0].nick, 'Owner');
});

test('регистрация: повторный запрос с той же cookie не создаёт второй аккаунт', async () => {
  const db = fakeDb();
  const c = cookieFor();
  assert.equal((await call(steam.register, { cookies: c, body: { nick: 'Shadow', terms: true } })).code, 201);
  const again = await call(steam.register, { cookies: c, body: { nick: 'Shadow3', terms: true } });
  assert.equal(again.err.code, 'steam_exists');
  assert.equal(db.users.length, 1);
});

test('pending: отдаёт имя Steam по cookie, без неё 401', async () => {
  const ok = await call(steam.pending, { cookies: cookieFor() });
  assert.deepEqual(ok.body, { steam: { name: 'ProPlayer' }, next: '/account' });
  const no = await call(steam.pending, {});
  assert.equal(no.err.status, 401);
});

// ---------- Отвязка Steam ----------
const withPass = async (extra = {}) => ({ id: 'u1', nick: 'Pl', steam_id: SID, steam_name: 'S', email: 'a@b.ru', password_hash: await bcrypt.hash('Password1', 4), email_verified_at: new Date(), ...extra });

test('отвязка: верный пароль — Steam снят, аккаунт и почта целы', async () => {
  const db = fakeDb(); db.users.push(await withPass());
  const r = await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } });
  assert.equal(r.err, undefined);
  assert.equal(db.users[0].steam_id, null);
  assert.equal(r.body.user.steam, null);
  assert.equal(r.body.user.email, 'a@b.ru');
});

test('отвязка: неверный пароль — 401, Steam остаётся', async () => {
  const db = fakeDb(); db.users.push(await withPass());
  const r = await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Wrong123' } });
  assert.equal(r.err.status, 401); assert.equal(r.err.field, 'password');
  assert.equal(db.users[0].steam_id, SID);
});

test('отвязка: Steam-аккаунт без почты и пароля — 409 last_login_method, без неподтверждённой почты тоже', async () => {
  const db = fakeDb(); db.users.push(await withPass({ email: null, password_hash: null }));
  assert.equal((await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } })).err.code, 'last_login_method');
  db.users[0] = await withPass({ email_verified_at: null });
  assert.equal((await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } })).err.code, 'last_login_method');
  assert.equal(db.users[0].steam_id, SID);
});

test('отвязка: Steam не привязан — 409; пустой пароль — 400', async () => {
  const db = fakeDb(); db.users.push(await withPass({ steam_id: null }));
  assert.equal((await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } })).err.code, 'steam_not_linked');
  assert.equal((await call(unlinkSteam, { user: { id: 'u1' }, body: {} })).err.status, 400);
});

test('отвязка при REQUIRE_STEAM: нельзя, пока игрок в активной заявке; без REQUIRE_STEAM можно', async () => {
  const db = fakeDb(); db.users.push(await withPass()); db.busy = [{ name: 'VAL Cup' }];
  config.registration.requireSteam = true;
  try {
    const r = await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } });
    assert.equal(r.err.code, 'in_tournament'); assert.deepEqual(r.err.details, ['VAL Cup']);
    assert.equal(db.users[0].steam_id, SID);
    db.busy = [];
    assert.equal((await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } })).err, undefined);
  } finally { config.registration.requireSteam = false; }
  db.users[0].steam_id = SID; db.busy = [{ name: 'VAL Cup' }];
  assert.equal((await call(unlinkSteam, { user: { id: 'u1' }, body: { password: 'Password1' } })).err, undefined);
});

// ---------- Возврат со Steam: новый игрок уходит на выбор ника ----------
const RETURN_TO = `${config.steam.returnBase}/api/auth/steam/callback`;
const assertion = (id = SID) => ({
  'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
  'openid.return_to': RETURN_TO, 'openid.claimed_id': `https://steamcommunity.com/openid/id/${id}`, 'openid.identity': `https://steamcommunity.com/openid/id/${id}`,
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce', 'openid.sig': 'x', 'openid.response_nonce': 'n',
});
const withSteam = async (valid, fn) => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => `ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`, json: async () => ({}) });
  try { return await fn(); } finally { globalThis.fetch = orig; }
};
const stateCookie = (mode = 'login') => ({ val_steam: signState(SECRET, { mode, next: '/teams', userId: null }) });

test('callback: Steam подтвердил, аккаунта нет — cookie подтверждения и переход на /steam-signup, сессии нет', async () => {
  const db = fakeDb();
  const r = await withSteam('true', () => call(steam.callback, { cookies: stateCookie(), query: assertion() }));
  assert.ok(r.redirectTo.endsWith('/steam-signup'), r.redirectTo);
  assert.equal(r.cookies[config.cookieName], undefined);
  assert.deepEqual(readSignup(SECRET, r.cookies.val_steam_new), { steamId: SID, name: `Steam …${SID.slice(-4)}`, next: '/teams' });
  assert.equal(db.users.length, 0, 'аккаунт создаётся только после выбора ника');
});

test('callback: Steam не подтвердил подпись — аккаунт не предлагается', async () => {
  fakeDb();
  const r = await withSteam('false', () => call(steam.callback, { cookies: stateCookie(), query: assertion() }));
  assert.match(r.redirectTo, /error=steam_failed/);
  assert.equal(r.cookies.val_steam_new, undefined);
});

test('callback: режим привязки никогда не создаёт аккаунт', async () => {
  const db = fakeDb();
  const r = await withSteam('true', () => call(steam.callback, { cookies: stateCookie('link'), query: assertion() }));
  assert.equal(r.cookies.val_steam_new, undefined);
  assert.equal(db.users.length, 0);
});

test('callback: у Steam есть аккаунт — обычный вход, а не регистрация; заблокированный не входит', async () => {
  const db = fakeDb();
  db.users.push({ id: 'u0', nick: 'Owner', steam_id: SID, blocked: false });
  let r = await withSteam('true', () => call(steam.callback, { cookies: stateCookie(), query: assertion() }));
  assert.ok(r.cookies[config.cookieName]); assert.equal(r.cookies.val_steam_new, undefined);
  db.users[0].blocked = true;
  r = await withSteam('true', () => call(steam.callback, { cookies: stateCookie(), query: assertion() }));
  assert.match(r.redirectTo, /error=blocked/); assert.equal(r.cookies[config.cookieName], undefined); assert.equal(r.cookies.val_steam_new, undefined);
});

// ---------- Состав заявки: Steam-аккаунт без почты считается подтверждённым ----------
import { validateRoster } from '../src/services/registrations.js';
const rosterDb = (users) => ({ query: async (sql) => (/FROM team_members/.test(sql) ? { rows: users } : { rows: [] }) });
const rosterArgs = (ids) => ({ team: { id: 't1' }, tournament: { id: 'x', team_size: ids.length }, rosterIds: ids });

test('состав: игрок с одним лишь Steam (без почты) допускается, игрок без почты и без Steam — нет, заблокированный — нет', async () => {
  const mk = (id, extra) => ({ id, nick: `P${id}`, email_verified_at: null, blocked: false, steam_id: null, ...extra });
  const okRes = await validateRoster(rosterDb([mk('a', { steam_id: SID })]), rosterArgs(['a']));
  assert.deepEqual(okRes, [{ id: 'a', nick: 'Pa' }]);
  await assert.rejects(() => validateRoster(rosterDb([mk('b')]), rosterArgs(['b'])), (e) => e.code === 'roster_unverified' && e.details[0] === 'Pb');
  await assert.rejects(() => validateRoster(rosterDb([mk('c', { steam_id: SID, blocked: true })]), rosterArgs(['c'])), (e) => e.code === 'roster_unverified');
  assert.equal((await validateRoster(rosterDb([mk('d', { email_verified_at: new Date() })]), rosterArgs(['d']))).length, 1);   // по почте, как раньше
});

test('состав при REQUIRE_STEAM: без Steam нельзя, со Steam можно', async () => {
  config.registration.requireSteam = true;
  try {
    const u = { id: 'e', nick: 'Pe', email_verified_at: new Date(), blocked: false, steam_id: null };
    await assert.rejects(() => validateRoster(rosterDb([u]), rosterArgs(['e'])), (e) => e.code === 'roster_no_steam');
    assert.equal((await validateRoster(rosterDb([{ ...u, steam_id: SID }]), rosterArgs(['e']))).length, 1);
  } finally { config.registration.requireSteam = false; }
});
