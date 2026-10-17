// Настройки сайта (этап 8.4). Чистая логика без БД: значения по умолчанию, проверка, публичная выжимка.
// В базе настройки лежат построчно (таблица settings: ключ → значение); недостающие ключи берутся из DEFAULTS.

export const DEFAULTS = {
  contactEmail: '',
  socialTelegram: '', socialVk: '', socialDiscord: '', socialYoutube: '',
  bannerEnabled: false, bannerText: '', bannerUntil: '',          // bannerUntil: «ГГГГ-ММ-ДД», действует весь этот день по Москве
  ratingParticipation: 10, ratingPlace1: 100, ratingPlace2: 60, ratingPlace3: 40, ratingMatchWin: 3,
};
export const KEYS = Object.keys(DEFAULTS);
export const SOCIAL_KEYS = ['socialTelegram', 'socialVk', 'socialDiscord', 'socialYoutube'];
export const RATING_KEYS = ['ratingParticipation', 'ratingPlace1', 'ratingPlace2', 'ratingPlace3', 'ratingMatchWin'];
export const BANNER_MAX = 200;
export const POINTS_MAX = 1000;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Склеивает строки из БД с умолчаниями; неизвестные и испорченные значения игнорируются. */
export function mergeSettings(rows = []) {
  const out = { ...DEFAULTS };
  for (const r of rows) {
    if (!(r.key in DEFAULTS)) continue;
    if (typeof r.value === typeof DEFAULTS[r.key]) out[r.key] = r.value;
  }
  return out;
}

const validDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

/** Проверка одного значения. Возвращает { value } или { error } (код ошибки для поля). */
function check(key, raw) {
  if (key === 'bannerEnabled') return typeof raw === 'boolean' ? { value: raw } : { error: 'invalid' };
  if (RATING_KEYS.includes(key)) {
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    return Number.isInteger(n) && n >= 0 && n <= POINTS_MAX ? { value: n } : { error: 'invalid' };
  }
  if (typeof raw !== 'string') return { error: 'invalid' };
  const s = raw.trim();
  if (key === 'contactEmail') return !s || (s.length <= 120 && EMAIL_RE.test(s)) ? { value: s } : { error: 'invalid' };
  if (SOCIAL_KEYS.includes(key)) {
    if (!s) return { value: '' };
    if (s.length > 200 || /\s/.test(s)) return { error: 'invalid' };
    try { const u = new URL(s); return u.protocol === 'https:' && u.hostname.includes('.') ? { value: u.href } : { error: 'invalid' }; } catch { return { error: 'invalid' }; }
  }
  if (key === 'bannerText') return s.length <= BANNER_MAX && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) ? { value: s } : { error: 'invalid' };
  if (key === 'bannerUntil') return !s || validDate(s) ? { value: s } : { error: 'invalid' };
  return { error: 'unknown' };
}

/**
 * Проверяет частичное обновление настроек. Возвращает { values } (только известные ключи, приведённые к нужному виду)
 * или { field, error }. current — настройки до изменения (нужны для проверки связей: места по убыванию, текст при включённом баннере).
 */
export function normalizePatch(input, current = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { field: '', error: 'invalid' };
  const values = {};
  for (const [k, raw] of Object.entries(input)) {
    if (!KEYS.includes(k)) return { field: k, error: 'unknown' };
    const r = check(k, raw);
    if (r.error) return { field: k, error: r.error };
    values[k] = r.value;
  }
  const next = { ...current, ...values };
  if (next.ratingPlace1 < next.ratingPlace2) return { field: 'ratingPlace2', error: 'order' };
  if (next.ratingPlace2 < next.ratingPlace3) return { field: 'ratingPlace3', error: 'order' };
  if (next.bannerEnabled && !next.bannerText) return { field: 'bannerText', error: 'required' };
  return { values };
}

/** Только то, что действительно изменилось: { before, after } для журнала; пусто — ничего не изменилось. */
export function changedSettings(current, values) {
  const before = {}, after = {};
  for (const [k, v] of Object.entries(values)) if (current[k] !== v) { before[k] = current[k]; after[k] = v; }
  return { before, after, changed: Object.keys(after).length > 0 };
}

/** Конец дня «ГГГГ-ММ-ДД» по Москве (UTC+3, без перехода на летнее время) в миллисекундах. */
export const endOfDayMoscow = (s) => Date.parse(`${s}T23:59:59.999+03:00`);

/** Баннер действует, если включён, есть текст и срок не вышел. */
export function bannerActive(s, now = new Date()) {
  if (!s.bannerEnabled || !s.bannerText) return false;
  if (s.bannerUntil && validDate(s.bannerUntil) && now.getTime() > endOfDayMoscow(s.bannerUntil)) return false;
  return true;
}

/** Публичные настройки для сайта: контакты, соцсети, действующий баннер. Формула рейтинга и прочее служебное не отдаётся. */
export function publicSettings(s, now = new Date()) {
  return {
    contactEmail: s.contactEmail || null,
    social: Object.fromEntries(SOCIAL_KEYS.map((k) => [k.slice(6).toLowerCase(), s[k] || null]).filter(([, v]) => v)),
    banner: bannerActive(s, now) ? { text: s.bannerText, until: s.bannerUntil || null } : null,
  };
}

/** Формула рейтинга в виде, который понимает services/rating.js. */
export const ratingPoints = (s) => ({
  place: { 1: s.ratingPlace1, 2: s.ratingPlace2, 3: s.ratingPlace3 },
  participation: s.ratingParticipation,
  matchWin: s.ratingMatchWin,
});
