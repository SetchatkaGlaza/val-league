import { ApiError, serverFallback, logoUrl } from '../js/api.js';
import { esc } from './parts.js';

/** Логотип команды или заглушка с первой буквой названия. */
export const teamLogo = (team, cls = '') => team.logo
  ? `<img class="tm-logo ${cls}" src="${esc(logoUrl(team.logo))}" alt="" width="96" height="96" loading="lazy" />`
  : `<div class="tm-logo ph ${cls}" aria-hidden="true">${esc([...team.name][0].toUpperCase())}</div>`;

export const TEAM_ERRORS = {
  name_taken: 'Команда с таким названием уже есть.',
  too_many_owned: 'Вы уже капитан максимального числа команд. Удалите одну из них или передайте капитанство.',
  too_many_teams: 'Вы состоите в максимальном числе команд. Выйдите из одной, чтобы вступить в новую.',
  team_full: 'В команде нет свободных мест.',
  main_full: 'В основном составе уже 5 игроков. Сначала переведите кого-то в запас.',
  sub_full: 'Запас заполнен.',
  user_not_found: 'Игрока с таким ником нет. Проверьте написание.',
  already_member: 'Этот игрок уже в команде.',
  already_invited: 'Этому игроку приглашение уже отправлено.',
  too_many_invites: 'Слишком много неотвеченных приглашений. Отзовите лишние.',
  captain_cannot_leave: 'Капитан не может покинуть команду: передайте капитанство или удалите команду.',
  already_captain: 'Вы уже капитан.',
  forbidden: 'Это действие доступно только капитану.',
  not_found: 'Не найдено — возможно, страница уже изменилась. Обновите её.',
  bad_image: 'Не удалось принять картинку. Подойдёт PNG, JPG или WebP.',
  too_large: 'Файл слишком большой.',
  invite_invalid: 'Приглашение недействительно.',
  roster_locked: 'Игрок заявлен на турнир, поэтому его нельзя исключить или он не может уйти. Капитан сначала меняет состав заявки на странице турнира (до закрытия регистрации).',
  team_registered: 'Команда подала заявку на турнир. Сначала отмените заявку на странице турнира.',
};

/** Понятный текст ошибки для любого исключения из API. */
export const teamError = (e, base = 'Не удалось выполнить. Попробуйте ещё раз.') => {
  const err = e instanceof ApiError ? e : new ApiError(0, 'network', '');
  return TEAM_ERRORS[err.code] || serverFallback(err, base);
};

/** Разовое сообщение для следующей страницы (например, «команда создана, но логотип не загрузился»). */
const FLASH = 'val:flash';
export const flash = {
  set(text) { try { sessionStorage.setItem(FLASH, text); } catch { /* хранилище недоступно */ } },
  take() { try { const t = sessionStorage.getItem(FLASH); sessionStorage.removeItem(FLASH); return t; } catch { return null; } },
};

export const longDate = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
