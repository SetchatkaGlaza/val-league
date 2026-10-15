const BASE = import.meta.env.VITE_API_URL || '/api';
const MOCK = import.meta.env.VITE_MOCK === 'true';
export const IS_MOCK = MOCK;

export class ApiError extends Error {
  constructor(status, code, message, field) {
    super(message); this.status = status; this.code = code; this.field = field;
  }
}

async function request(path, { method = 'GET', body, timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      method, credentials: 'include', signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.code || 'error', data.message || '', data.field);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e.name === 'AbortError' ? 'timeout' : 'network', '');
  } finally { clearTimeout(timer); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, data, mock) => (MOCK ? mock(data) : request(path, { method: 'POST', body: data }));

// Демо без сервера (VITE_MOCK=true)
const mocks = {
  async login({ email, password }) {
    await wait(900);
    const e = email.toLowerCase();
    if (e === 'limit@val.gg') throw new ApiError(429, 'rate_limited', '');
    if (e === 'unverified@val.gg') throw new ApiError(403, 'email_not_verified', '');
    if (e === 'player@val.gg' && password === 'Password1') return { user: { nick: 'Player', email: e, steam: null, telegram: null } };
    throw new ApiError(401, 'invalid_credentials', '');
  },
  async register({ email, nick }) {
    await wait(1100);
    if (email.toLowerCase() === 'limit@val.gg') throw new ApiError(429, 'rate_limited', '');
    if (email.toLowerCase() === 'taken@val.gg') throw new ApiError(409, 'email_taken', '', 'email');
    if (nick.toLowerCase() === 'taken') throw new ApiError(409, 'nick_taken', '', 'nick');
    return { ok: true };
  },
  async forgot({ email }) {
    await wait(900);
    if (email.toLowerCase() === 'limit@val.gg') throw new ApiError(429, 'rate_limited', '');
    return { ok: true };
  },
  async logout() { await wait(300); return { ok: true }; },
  async telegramCode() { await wait(500); return { code: String(Math.floor(100000 + Math.random() * 900000)), bot: '@val_league_bot' }; },
  async telegramCheck() { await wait(900); return { telegram: { username: 'player_tg' } }; },
  async telegramUnlink() { await wait(500); return { ok: true }; },
  async steamLink() { await wait(900); return { steam: { name: 'Player', id: '76561198000000000' } }; },
  async updateProfile({ nick }) {
    await wait(700);
    if (nick.toLowerCase() === 'taken') throw new ApiError(409, 'nick_taken', '', 'nick');
    return { user: { nick } };
  },
  async changePassword({ current }) {
    await wait(900);
    if (current !== 'Password1') throw new ApiError(401, 'invalid_credentials', '', 'current'); // демо-пароль player@val.gg
    return { ok: true };
  },
  async saveNotifications(d) { await wait(350); return d; },
  async deleteAccount() { await wait(900); return { ok: true }; },
  // Демо: /verify-email?token=demo — успех, ?token=expired — ссылка устарела
  async verifyEmail({ token }) {
    await wait(900);
    if (token === 'expired') throw new ApiError(400, 'token_invalid', '');
    return { ok: true };
  },
  async resendVerification({ email }) {
    await wait(800);
    if (email.toLowerCase() === 'limit@val.gg') throw new ApiError(429, 'rate_limited', '');
    return { ok: true };
  },
  // Демо: /reset-password?token=demo — успех, ?token=expired — ссылка устарела
  async resetPassword({ token }) {
    await wait(1000);
    if (token === 'expired') throw new ApiError(400, 'token_invalid', '');
    return { ok: true };
  },
};

export const auth = {
  login: (d) => post('/auth/login', d, mocks.login),
  register: (d) => post('/auth/register', d, mocks.register),
  forgot: (d) => post('/auth/forgot-password', d, mocks.forgot),
  verifyEmail: (d) => post('/auth/verify-email', d, mocks.verifyEmail),
  resendVerification: (d) => post('/auth/resend-verification', d, mocks.resendVerification),
  resetPassword: (d) => post('/auth/reset-password', d, mocks.resetPassword),
  me: () => request('/auth/me'),
  steamUrl: () => `${BASE}/auth/steam`,
};

export const account = {
  logout: () => post('/auth/logout', {}, mocks.logout),
  telegramCode: () => post('/account/telegram/code', {}, mocks.telegramCode),
  telegramCheck: () => post('/account/telegram/check', {}, mocks.telegramCheck),
  telegramUnlink: () => post('/account/telegram/unlink', {}, mocks.telegramUnlink),
  /** Демо привязывает Steam сразу; на сервере это переход на OpenID: /auth/steam?link=1 */
  steamLink: () => (MOCK ? mocks.steamLink() : location.assign(`${BASE}/auth/steam?link=1`)),
};

export const settings = {
  updateProfile: (d) => post('/account/profile', d, mocks.updateProfile),
  changePassword: (d) => post('/account/password', d, mocks.changePassword),
  saveNotifications: (d) => post('/account/notifications', d, mocks.saveNotifications),
  deleteAccount: (d) => post('/account/delete', d, mocks.deleteAccount),
};

export const COMMON_ERRORS = {
  rate_limited: 'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
  network: 'Нет соединения с сервером. Проверьте интернет и повторите.',
  timeout: 'Сервер долго не отвечает. Попробуйте ещё раз.',
};
export const serverFallback = (e, base = 'Что-то пошло не так. Попробуйте ещё раз.') =>
  COMMON_ERRORS[e.code] || (e.status >= 500 ? 'Ошибка на сервере. Мы уже разбираемся — попробуйте позже.' : base);
