import login from './views/login.js';
import register from './views/register.js';
import forgot from './views/forgot.js';
import verifyEmail from './views/verify-email.js';
import resetPassword from './views/reset-password.js';
import account from './views/account.js';
import settingsPage from './views/settings.js';
import { rules, privacy } from './views/docs.js';
import home from './views/home.js';
import teamNew from './views/team-new.js';
import team from './views/team.js';
import invite from './views/invite.js';
import { notFound } from './views/stubs.js';

// Новая страница: файл в src/views + строка здесь. Все страницы входят в один бандл,
// поэтому переходы между ними мгновенные — без запросов к серверу.
export const routes = {
  '/': home,
  '/login': login,
  '/register': register,
  '/forgot': forgot,
  '/verify-email': verifyEmail,
  '/reset-password': resetPassword,
  '/account': account,
  '/settings': settingsPage,
  '/rules': rules,
  '/privacy': privacy,
  '/teams/new': teamNew,
  '/invite': invite,
};

// Адреса с параметром: [шаблон, имя параметра, страница]. Точные адреса из таблицы выше проверяются первыми.
const dynamic = [
  [/^\/teams\/([a-z0-9-]{1,40})$/, 'slug', team],
];

export function resolve(path) {
  if (routes[path]) return { view: routes[path], params: {} };
  for (const [re, name, view] of dynamic) {
    const m = re.exec(path);
    if (m) return { view, params: { [name]: m[1] } };
  }
  return null;
}
export { notFound };
