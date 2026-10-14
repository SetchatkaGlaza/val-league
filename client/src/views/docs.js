import rulesHtml from './partials/rules.html?raw';
import privacyHtml from './partials/privacy.html?raw';
import { mountDoc } from '../js/doc-effects.js';

const make = (title, description, html) => ({
  layout: 'doc',
  title,
  description,
  render: () => `<main class="doc">${html}</main>`,
  mount: (root) => mountDoc(root),
});

export const rules = make(
  'Регламент турниров',
  'Регламент онлайн-турниров по CS2 лиги VOLOGDA AMATEUR LEAGUE: участники, регистрация, правила игры, санкции и призы.',
  rulesHtml,
);
export const privacy = make(
  'Политика конфиденциальности',
  'Политика конфиденциальности VOLOGDA AMATEUR LEAGUE: какие данные мы собираем, как используем и защищаем, ваши права.',
  privacyHtml,
);
