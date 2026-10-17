import jwt from 'jsonwebtoken';

/**
 * Вход через Steam (OpenID 2.0). Чистая логика без базы и express, чтобы её можно было проверять тестами.
 * Порядок: buildAuthUrl → игрок на Steam → readAssertion (быстрые проверки) → verifyWithSteam (Steam подтверждает подпись).
 */
export const OPENID_NS = 'http://specs.openid.net/auth/2.0';
export const IDENTIFIER_SELECT = `${OPENID_NS}/identifier_select`;
export const STEAM_LOGIN = 'https://steamcommunity.com/openid/login';
const CLAIMED_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
// Эти поля должны быть под подписью Steam, иначе их можно подменить по дороге.
const MUST_BE_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'];

/** Адрес внутри сайта: только путь с «/», без «//» и обратных косых (иначе это уход на чужой сайт). */
export function safeNext(p, fallback = '/account') {
  if (typeof p !== 'string' || p.length > 200) return fallback;
  if (!p.startsWith('/') || p.startsWith('//') || /[\\\u0000-\u001f]/.test(p)) return fallback;
  return p;
}

export function buildAuthUrl({ returnTo, realm }) {
  const q = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_LOGIN}?${q}`;
}

/** Быстрая проверка ответа Steam до обращения к сети. Возвращает { ok, steamId } или { ok:false, reason }. */
export function readAssertion(query, { returnTo }) {
  const g = (k) => (typeof query?.[`openid.${k}`] === 'string' ? query[`openid.${k}`] : '');
  if (g('mode') === 'cancel') return { ok: false, reason: 'cancelled' };
  if (g('mode') !== 'id_res') return { ok: false, reason: 'mode' };
  if (g('ns') !== OPENID_NS) return { ok: false, reason: 'ns' };
  if (g('op_endpoint') !== STEAM_LOGIN) return { ok: false, reason: 'endpoint' };
  if (g('return_to') !== returnTo) return { ok: false, reason: 'return_to' };
  const claimed = CLAIMED_RE.exec(g('claimed_id'));
  if (!claimed || g('identity') !== g('claimed_id')) return { ok: false, reason: 'claimed_id' };
  const signed = g('signed').split(',');
  if (!MUST_BE_SIGNED.every((f) => signed.includes(f))) return { ok: false, reason: 'unsigned' };
  if (!g('sig')) return { ok: false, reason: 'sig' };
  return { ok: true, steamId: claimed[1] };
}

const withTimeout = async (fetchImpl, url, opts, ms = 8000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchImpl(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
};

/** Просим Steam подтвердить подпись. Steam заодно «сжигает» одноразовый ключ ответа, поэтому повторить чужой ответ нельзя. Сетевая ошибка — исключение. */
export async function verifyWithSteam(query, fetchImpl = fetch) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (k.startsWith('openid.') && typeof v === 'string') body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  const r = await withTimeout(fetchImpl, STEAM_LOGIN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`steam_http_${r.status}`);
  return /^is_valid:true$/m.test(await r.text());
}

/** Имя профиля. Без ключа Steam API или при сбое — запасная подпись, вход от этого не ломается. */
export async function personaName(steamId, { apiKey, fetchImpl = fetch } = {}) {
  const fallback = `Steam …${steamId.slice(-4)}`;
  if (!apiKey) return fallback;
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`;
    const r = await withTimeout(fetchImpl, url, {}, 5000);
    if (!r.ok) return fallback;
    const name = (await r.json())?.response?.players?.[0]?.personaname;
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : fallback;
  } catch { return fallback; }
}

// ---------- Состояние на время похода к Steam (cookie, живёт 10 минут) ----------
const AUD = 'steam-state';   // отдельная «аудитория»: токен сессии не подойдёт как состояние и наоборот
export const signState = (secret, { mode, next, userId = null }) => jwt.sign({ m: mode, n: next, u: userId }, secret, { expiresIn: '10m', audience: AUD });
export function readState(secret, raw) {
  if (!raw) return null;
  try {
    const d = jwt.verify(raw, secret, { audience: AUD });
    return d.m === 'link' || d.m === 'login' ? { mode: d.m, next: safeNext(d.n), userId: d.u || null } : null;
  } catch { return null; }
}

/** Что делать, когда Steam подтвердил игрока при обычном входе. */
export function loginDecision(user, now = new Date()) {
  if (!user) return 'new';
  if (user.blocked && !(user.blocked_until && new Date(user.blocked_until) <= now)) return 'blocked';
  return 'ok';
}

// ---------- Регистрация нового аккаунта через Steam (этап 9.2) ----------
// После того как Steam подтвердил игрока, но аккаунта с таким Steam ещё нет, сервер выдаёт короткую подписанную cookie
// «этот Steam подтверждён». Игрок выбирает ник, и только по этой cookie создаётся аккаунт: Steam ID из клиента не принимается никогда.
const AUD_SIGNUP = 'steam-signup';
export const SIGNUP_TTL_MIN = 15;
export const signSignup = (secret, { steamId, name, next }) => jwt.sign({ s: steamId, nm: name, n: next }, secret, { expiresIn: `${SIGNUP_TTL_MIN}m`, audience: AUD_SIGNUP });
export function readSignup(secret, raw) {
  if (!raw) return null;
  try {
    const d = jwt.verify(raw, secret, { audience: AUD_SIGNUP });
    if (typeof d.s !== 'string' || !/^7656119\d{10}$/.test(d.s)) return null;
    return { steamId: d.s, name: typeof d.nm === 'string' ? d.nm.slice(0, 60) : '', next: safeNext(d.n) };
  } catch { return null; }
}

/** Можно ли отвязать Steam самому игроку: нужен подтверждённый вход по почте и паролю, иначе аккаунт останется без способа входа. */
export function canUnlinkSteam(u) {
  if (!u.steam_id) return 'not_linked';
  if (!u.email || !u.password_hash || !u.email_verified_at) return 'last_login_method';
  return null;
}
