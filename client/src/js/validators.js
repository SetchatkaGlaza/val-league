export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NICK_RE = /^[A-Za-zА-Яа-яЁё0-9_.\-]{3,20}$/;
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'val', 'vologdaamateurleague'];

export const emailError = (raw) => {
  const v = raw.trim();
  if (!v) return 'Введите почту';
  return v.length > 254 || !EMAIL_RE.test(v) ? 'Проверьте почту, например name@mail.ru' : '';
};
export const loginPasswordError = (v) => (!v ? 'Введите пароль' : v.length < 8 ? 'Пароль — минимум 8 символов' : '');
export const nickError = (raw) => {
  const v = raw.trim();
  if (!v) return 'Придумайте ник';
  if (v.length < 3 || v.length > 20) return 'Ник — от 3 до 20 символов';
  if (!NICK_RE.test(v)) return 'Только буквы, цифры и символы _ . -';
  if (RESERVED.includes(v.toLowerCase())) return 'Этот ник зарезервирован';
  return '';
};
export const newPasswordError = (v) => {
  if (!v) return 'Придумайте пароль';
  if (v.length < 8) return 'Пароль — минимум 8 символов';
  if (v.length > 128) return 'Пароль слишком длинный';
  if (!/[A-Za-zА-Яа-я]/.test(v) || !/\d/.test(v)) return 'Нужны и буквы, и цифры';
  return '';
};
/** 0–4 для индикатора надёжности. */
export function passwordScore(v) {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (/[a-zа-я]/.test(v) && /[A-ZА-Я]/.test(v)) s++;
  if (/\d/.test(v) && /[A-Za-zА-Яа-я]/.test(v)) s++;
  if (v.length >= 12 || /[^A-Za-zА-Яа-я0-9]/.test(v)) s++;
  return v.length < 8 ? Math.min(s, 1) : Math.max(s, 1);
}
/** Принимаем только внутренние пути, чтобы ?next= нельзя было использовать для фишинга. */
export const safeNext = (p, fb = '/') => (p && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') ? p : fb);

const TEAM_RE = /^[A-Za-zА-Яа-яЁё0-9 _.\-]+$/;
const RESERVED_TEAMS = ['val', 'admin', 'administrator', 'moderator', 'support', 'vologdaamateurleague'];
export const teamNameError = (raw) => {
  const v = raw.trim().replace(/\s+/g, ' ');
  if (!v) return 'Придумайте название команды';
  if (v.length < 3 || v.length > 24) return 'Название — от 3 до 24 символов';
  if (!TEAM_RE.test(v)) return 'Только буквы, цифры, пробел и символы _ . -';
  if (RESERVED_TEAMS.includes(v.toLowerCase().replace(/\s/g, ''))) return 'Это название зарезервировано';
  return '';
};
export const teamDescError = (v) => (v.trim().length > 300 ? 'Описание — не длиннее 300 символов' : '');
