import login from './views/login.js';
import register from './views/register.js';
import forgot from './views/forgot.js';
import verifyEmail from './views/verify-email.js';
import resetPassword from './views/reset-password.js';
import { rules, privacy } from './views/docs.js';
import { home, notFound } from './views/stubs.js';

// Новая страница: файл в src/views + строка здесь. Все страницы входят в один бандл,
// поэтому переходы между ними мгновенные — без запросов к серверу.
export const routes = {
  '/': home,
  '/login': login,
  '/register': register,
  '/forgot': forgot,
  '/verify-email': verifyEmail,
  '/reset-password': resetPassword,
  '/rules': rules,
  '/privacy': privacy,
};
export { notFound };
