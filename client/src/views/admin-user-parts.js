import { esc } from './parts.js';
import { tournamentError } from './tournament-parts.js';
import { ROLE_LABEL } from './admin-nav.js';

// Тексты ошибок раздела «Пользователи». Остальные коды разбирает tournamentError.
const ERR = {
  self_forbidden: 'Себя заблокировать или понизить нельзя.',
  last_admin: 'Это последний администратор: сначала назначьте другого.',
  no_change: 'Ничего не изменилось.',
  already_blocked: 'Пользователь уже заблокирован.',
  not_blocked: 'Пользователь не заблокирован.',
  no_email: 'У пользователя нет почты.',
  already_verified: 'Почта уже подтверждена.',
  not_linked: 'Привязки нет.',
  last_login_method: 'Нельзя: без Steam пользователь не сможет войти (нет почты или пароля).',
  nick_taken: 'Такой ник уже занят.',
  until_past: 'Дата окончания блокировки уже прошла.',
  until_too_far: 'Срок блокировки слишком большой (не больше 10 лет).',
  validation: 'Проверьте поля формы.',
};
export function userError(e, fallback) {
  if (e?.code && ERR[e.code]) return ERR[e.code];
  return tournamentError(e, fallback);
}

export const when = (iso) => (iso ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
export const day = (iso) => (iso ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');

/** Срок блокировки в человеческом виде. until — ISO-строка конца дня по Москве (минус миллисекунда не нужна: показываем предыдущий день). */
export const untilText = (iso) => (iso ? `до ${day(new Date(new Date(iso).getTime() - 1))}` : 'без срока');

export const roleBadge = (role) => `<span class="usr-badge usr-role-${esc(role)}">${esc(ROLE_LABEL[role] ?? role)}</span>`;
export const blockBadge = (b) => (b ? `<span class="usr-badge usr-blocked">Заблокирован · ${esc(untilText(b.until))}</span>` : '');
export const flags = (u) => [
  u.email ? (u.emailVerified ? '<span class="usr-badge usr-ok">Почта подтверждена</span>' : '<span class="usr-badge">Почта не подтверждена</span>') : '',
  u.steam ? '<span class="usr-badge usr-ok">Steam</span>' : '', u.telegram ? '<span class="usr-badge usr-ok">Telegram</span>' : '',
].join('');
