import { query } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, expireBlocks } from '../middleware/auth.js';
import { startSession } from './auth.js';
import { z } from 'zod';
import { HttpError, parse } from '../utils/http.js';
import { nick, publicUser } from './auth.js';
import { buildAuthUrl, readAssertion, verifyWithSteam, personaName, signState, readState, safeNext, loginDecision, signSignup, readSignup, SIGNUP_TTL_MIN } from '../services/steam.js';

const CLIENT = config.clientUrl;
const RETURN_TO = `${config.steam.returnBase}/api/auth/steam/callback`;
const REALM = new URL(RETURN_TO).origin;
const STATE_COOKIE = 'val_steam';
// Cookie видна только маршрутам Steam. SameSite=Lax нужен: Steam возвращает игрока обычным переходом по ссылке.
const SIGNUP_COOKIE = 'val_steam_new';
const signupOpts = { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/api/auth/steam', maxAge: SIGNUP_TTL_MIN * 60 * 1000 };
const stateOpts = { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/api/auth/steam', maxAge: 10 * 60 * 1000 };

/** Это переходы браузера, а не запросы из JS: ошибки показываем страницей сайта (/login?error=… или /account?error=…), а не JSON. */
const to = (res, path, params = {}) => res.redirect(`${CLIENT}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`);

/** Текущий пользователь по cookie сессии (проверки те же, что у requireAuth: блокировка, смена пароля), но без JSON-ответа 401. */
const currentUser = (req, res) => new Promise((resolve, reject) => {
  const quiet = { clearCookie: (...a) => res.clearCookie(...a), status: () => ({ json: () => resolve(null) }) };
  requireAuth(req, quiet, (err) => (err ? reject(err) : resolve(req.user)));
});

/** GET /api/auth/steam[?link=1][&next=/путь] — уводим на Steam. С link=1 привязываем Steam к вошедшему аккаунту, иначе входим. */
export async function start(req, res) {
  const mode = req.query.link ? 'link' : 'login';
  const next = safeNext(req.query.next, '/account');
  let userId = null;
  if (mode === 'link') {
    const user = await currentUser(req, res);
    if (!user) return to(res, '/login', { next: '/account' });
    if (user.steam_id) return to(res, '/account', { error: 'steam_already' });
    userId = user.id;
  }
  res.cookie(STATE_COOKIE, signState(config.jwtSecret, { mode, next, userId }), stateOpts);
  res.redirect(buildAuthUrl({ returnTo: RETURN_TO, realm: REALM }));
}

/** GET /api/auth/steam/callback — Steam вернул игрока. */
export async function callback(req, res) {
  const state = readState(config.jwtSecret, req.cookies?.[STATE_COOKIE]);
  res.clearCookie(STATE_COOKIE, { ...stateOpts, maxAge: undefined });
  const fail = (code) => to(res, state?.mode === 'link' ? '/account' : '/login', { error: code });
  if (!state) return fail('steam_failed');
  try {
    const a = readAssertion(req.query, { returnTo: RETURN_TO });
    if (a.reason === 'cancelled') return fail('steam_cancelled');
    if (!a.ok) return fail('steam_failed');
    let valid;
    try { valid = await verifyWithSteam(req.query); } catch { return fail('steam_unavailable'); }
    if (!valid) return fail('steam_failed');
    return state.mode === 'link' ? await link(req, res, state, a.steamId, fail) : await login(res, state, a.steamId, fail);
  } catch (e) {
    console.error('steam callback:', e);
    return fail('steam_failed');
  }
}

async function link(req, res, state, steamId, fail) {
  const user = await currentUser(req, res);
  if (!user || user.id !== state.userId) return fail('steam_failed');   // вышли или сменили аккаунт, пока были на Steam
  if (user.steam_id) return fail('steam_already');
  const name = await personaName(steamId, { apiKey: config.steam.apiKey });
  try {
    const { rowCount } = await query('UPDATE users SET steam_id = $2, steam_name = $3 WHERE id = $1 AND steam_id IS NULL', [user.id, steamId, name]);
    if (!rowCount) return fail('steam_already');
  } catch (e) {
    if (e.code === '23505') return fail('steam_taken');   // этот Steam уже привязан к другому аккаунту
    throw e;
  }
  return to(res, '/steam-done', { next: state.next, linked: '1' });
}

async function login(res, state, steamId, fail) {
  const { rows } = await query('SELECT * FROM users WHERE steam_id = $1', [steamId]);
  let user = rows[0];
  if (user?.blocked && user.blocked_until && new Date(user.blocked_until) <= new Date()) { await expireBlocks(); user = { ...user, blocked: false }; }
  const d = loginDecision(user);
  if (d === 'blocked') return fail('blocked');
  if (d === 'new') {
    // Аккаунта с этим Steam нет: предлагаем создать. Steam уже подтвердил игрока, запоминаем это в подписанной cookie на 15 минут.
    const name = await personaName(steamId, { apiKey: config.steam.apiKey });
    res.cookie(SIGNUP_COOKIE, signSignup(config.jwtSecret, { steamId, name, next: state.next }), signupOpts);
    return to(res, '/steam-signup');
  }
  startSession(res, user.id, false);
  return to(res, '/steam-done', { next: state.next });
}

const signupSchema = z.object({ nick, terms: z.literal(true) });
const clearSignup = (res) => res.clearCookie(SIGNUP_COOKIE, { ...signupOpts, maxAge: undefined });

/** GET /api/auth/steam/pending — для страницы выбора ника: имя профиля Steam, пока cookie подтверждения жива. */
export function pending(req, res) {
  const s = readSignup(config.jwtSecret, req.cookies?.[SIGNUP_COOKIE]);
  if (!s) throw new HttpError(401, 'steam_session_expired');
  res.json({ steam: { name: s.name }, next: s.next });
}

/**
 * POST /api/auth/steam/register { nick, terms } — создаёт аккаунт только по cookie, выданной после проверки Steam.
 * Почты и пароля у такого аккаунта нет: существующие аккаунты это не затрагивает (чужой аккаунт «захватить» нельзя —
 * мы ничего не привязываем, а только создаём новую запись; Steam ID уникален, ник уникален).
 */
export async function register(req, res) {
  const s = readSignup(config.jwtSecret, req.cookies?.[SIGNUP_COOKIE]);
  if (!s) throw new HttpError(401, 'steam_session_expired');
  const d = parse(signupSchema, req.body);
  let user;
  try {
    const { rows } = await query('INSERT INTO users (nick, steam_id, steam_name) VALUES ($1, $2, $3) RETURNING *', [d.nick, s.steamId, s.name || `Steam …${s.steamId.slice(-4)}`]);
    user = rows[0];
  } catch (e) {
    if (e.code === '23505') {
      if (/steam/.test(e.constraint || '')) { clearSignup(res); throw new HttpError(409, 'steam_exists'); }   // аккаунт с этим Steam уже создан (например, второй вкладкой)
      throw new HttpError(409, 'nick_taken', 'nick');
    }
    throw e;
  }
  clearSignup(res);
  startSession(res, user.id, false);
  res.status(201).json({ user: publicUser(user), next: s.next });
}
