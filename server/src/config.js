// Настройки из server/.env. Модуль импортируется после dotenv/config (см. index.js).
const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (isProd) { console.error('JWT_SECRET не задан или короче 32 символов — запуск остановлен.'); process.exit(1); }
  jwtSecret = 'dev-only-secret-change-me-dev-only-secret';
  console.warn('⚠ JWT_SECRET не задан: используется ключ для разработки. Для продакшена обязательно задайте свой.');
}

export const config = {
  isProd,
  jwtSecret,
  clientUrl: (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, ''),
  cookieName: 'val_session',
  mailFrom: process.env.MAIL_FROM || 'VAL <no-reply@val-league.ru>',
};
