import { esc } from './parts.js';
import { logoUrl } from '../js/api.js';
import { userError } from './admin-user-parts.js';

// Тексты ошибок раздела «Команды». Остальные коды разбирает userError (а он — tournamentError).
const ERR = {
  name_taken: 'Такое название команды уже занято.',
  no_change: 'Ничего не изменилось.',
  no_logo: 'У команды нет логотипа.',
  no_description: 'У команды нет описания.',
  team_in_tournament: 'Команда участвует в турнире (черновик, анонс или идёт). Сначала снимите её заявки в разделе турнира.',
  validation: 'Проверьте поля формы: название 3–24 символа, причина не короче 3.',
};
export function teamError(e, fallback) {
  if (e?.code && ERR[e.code]) return ERR[e.code];
  return userError(e, fallback);
}

/** Маленький логотип; без файла — заглушка с первой буквой. */
export const logoThumb = (t, size = 'sm') => (t.logo
  ? `<img class="tm-logo tm-logo-${size}" src="${esc(logoUrl(t.logo))}" alt="Логотип команды ${esc(t.name)}" loading="lazy" width="${size === 'lg' ? 96 : 40}" height="${size === 'lg' ? 96 : 40}" />`
  : `<span class="tm-logo tm-logo-${size} tm-logo-empty" aria-hidden="true">${esc([...t.name][0] ?? '?')}</span>`);
