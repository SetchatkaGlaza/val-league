const BASE = import.meta.env.VITE_API_URL || '/api';
const MOCK = import.meta.env.VITE_MOCK === 'true';
export const IS_MOCK = MOCK;

export class ApiError extends Error {
  constructor(status, code, message, field, details) {
    super(message); this.status = status; this.code = code; this.field = field; this.details = details;
  }
}

async function request(path, { method = 'GET', body, timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      method, credentials: 'include', signal: ctrl.signal,
      // Blob (логотип) уходит как есть, всё остальное — JSON
      headers: body ? { 'Content-Type': body instanceof Blob ? body.type : 'application/json' } : undefined,
      body: body ? (body instanceof Blob ? body : JSON.stringify(body)) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.code || 'error', data.message || '', data.field, data.details);
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

// Команды работают только с сервером: в демо-режиме (VITE_MOCK=true) данных для них нет.
const live = (fn) => (...a) => (MOCK ? Promise.reject(new ApiError(0, 'mock', '')) : fn(...a));
const enc = encodeURIComponent;
const send = (method, path, body) => request(path, { method, body: body ?? {} });

export const teams = {
  mine: live(() => request('/teams/mine')),
  create: live((d) => send('POST', '/teams', d)),
  get: live((slug) => request(`/teams/${enc(slug)}`)),
  history: live((slug) => request(`/teams/${enc(slug)}/history`)),
  update: live((slug, d) => send('PATCH', `/teams/${enc(slug)}`, d)),
  remove: live((slug) => send('DELETE', `/teams/${enc(slug)}`)),
  setLogo: live((slug, blob) => request(`/teams/${enc(slug)}/logo`, { method: 'PUT', body: blob, timeout: 30000 })),
  removeLogo: live((slug) => send('DELETE', `/teams/${enc(slug)}/logo`)),
  invite: live((slug, nick) => send('POST', `/teams/${enc(slug)}/invites`, { nick })),
  revokeInvite: live((slug, id) => send('DELETE', `/teams/${enc(slug)}/invites/${enc(id)}`)),
  resetLink: live((slug) => send('POST', `/teams/${enc(slug)}/invite-link/reset`)),
  setRole: live((slug, userId, role) => send('PATCH', `/teams/${enc(slug)}/members/${enc(userId)}`, { role })),
  kick: live((slug, userId) => send('DELETE', `/teams/${enc(slug)}/members/${enc(userId)}`)),
  makeCaptain: live((slug, userId) => send('POST', `/teams/${enc(slug)}/captain`, { userId })),
};

export const players = {
  get: live((nick) => request(`/players/${enc(nick)}`)),
  rating: live((limit = 20, offset = 0) => request(`/players?limit=${limit}&offset=${offset}`)),
};

/** Приглашение — либо по ссылке ({ token }), либо персональное ({ id }). */
export const invites = {
  preview: live((pick) => request(`/invites/preview?${new URLSearchParams(pick)}`)),
  accept: live((pick) => send('POST', '/invites/accept', pick)),
  decline: live((id) => send('POST', '/invites/decline', { id })),
};

// Турниры и админка тоже работают только с сервером.
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')).toString();

export const tournaments = {
  list: live((tab) => request(`/tournaments?${qs({ tab })}`)),
  next: live(() => request('/tournaments/next')),
  get: live((slug) => request(`/tournaments/${enc(slug)}`)),
  winners: live((limit = 3, offset = 0) => request(`/winners?limit=${limit}${offset ? `&offset=${offset}` : ''}`)),
};

/** Сетка и матчи: публичные страницы (вход нужен только для «Моих матчей»). */
export const bracket = {
  get: live((slug) => request(`/tournaments/${enc(slug)}/bracket`)),
};
export const matches = {
  get: live((id) => request(`/matches/${enc(id)}`)),
  mine: live(() => request('/matches/mine')),
};

export const registrations = {
  eligibility: live((slug) => request(`/tournaments/${enc(slug)}/registration`)),
  create: live((slug, d) => send('POST', `/tournaments/${enc(slug)}/registrations`, d)),
  mine: live(() => request('/registrations/mine')),
  cancel: live((id) => send('POST', `/registrations/${enc(id)}/cancel`)),
  roster: live((id, roster) => send('PUT', `/registrations/${enc(id)}/roster`, { roster })),
};

export const teamsDirectory = live((q, offset = 0) => request(`/teams?${qs({ q, offset: offset || undefined })}`));

export const admin = {
  dashboard: live(() => request('/admin/dashboard')),
  list: live(() => request('/admin/tournaments')),
  get: live((id) => request(`/admin/tournaments/${enc(id)}`)),
  create: live((d) => send('POST', '/admin/tournaments', d)),
  update: live((id, d) => send('PATCH', `/admin/tournaments/${enc(id)}`, d)),
  setStatus: live((id, d) => send('POST', `/admin/tournaments/${enc(id)}/status`, d)),
  remove: live((id) => send('DELETE', `/admin/tournaments/${enc(id)}`)),
  registrations: live((id) => request(`/admin/tournaments/${enc(id)}/registrations`)),
  confirm: live((id, note) => send('POST', `/admin/registrations/${enc(id)}/confirm`, note ? { note } : {})),
  cancelReg: live((id, note) => send('POST', `/admin/registrations/${enc(id)}/cancel`, note ? { note } : {})),
  refunded: live((id) => send('POST', `/admin/registrations/${enc(id)}/refunded`, {})),
  // Сетка и результаты (этап 5)
  bracket: live((id) => request(`/admin/tournaments/${enc(id)}/bracket`)),
  generateBracket: live((id, d) => send('POST', `/admin/tournaments/${enc(id)}/bracket`, d)),
  removeBracket: live((id) => send('DELETE', `/admin/tournaments/${enc(id)}/bracket`)),
  setResult: live((id, d) => send('PUT', `/admin/matches/${enc(id)}/result`, d)),
  patchMatch: live((id, d) => send('PATCH', `/admin/matches/${enc(id)}`, d)),
  scheduleBracket: live((id, d) => send('POST', `/admin/tournaments/${enc(id)}/schedule`, d)),
};

export const logoUrl = (file) => (file ? `${BASE}/files/logos/${file}` : null);

export const COMMON_ERRORS = {
  soon: 'Эта возможность появится на этапе уведомлений и входа через Steam.',
  forbidden: 'Недостаточно прав для этого действия.',
  mock: 'Этот раздел работает только с подключённым сервером (сейчас включён демо-режим).',
  rate_limited: 'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
  network: 'Нет соединения с сервером. Проверьте интернет и повторите.',
  timeout: 'Сервер долго не отвечает. Попробуйте ещё раз.',
};
export const serverFallback = (e, base = 'Что-то пошло не так. Попробуйте ещё раз.') =>
  COMMON_ERRORS[e.code] || (e.status >= 500 ? 'Ошибка на сервере. Мы уже разбираемся — попробуйте позже.' : base);
