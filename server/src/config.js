import { fileURLToPath } from 'node:url';

// Настройки из server/.env. Модуль импортируется после dotenv/config (см. index.js).
const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (isProd) { console.error('JWT_SECRET не задан или короче 32 символов — запуск остановлен.'); process.exit(1); }
  jwtSecret = 'dev-only-secret-change-me-dev-only-secret';
  console.warn('⚠ JWT_SECRET не задан: используется ключ для разработки. Для продакшена обязательно задайте свой.');
}

// Вход через Steam. Steam вернёт игрока на {returnBase}/api/auth/steam/callback: это адрес сайта, а не сервера (в разработке запросы /api проходят через proxy Vite).
const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

export const config = {
  isProd,
  jwtSecret,
  clientUrl,
  steam: {
    returnBase: (process.env.STEAM_RETURN_BASE || clientUrl).replace(/\/$/, ''),
    apiKey: process.env.STEAM_API_KEY || '',   // необязателен: с ключом берём из Steam имя профиля, без него подписываем «Steam …1234»
  },
  cookieName: 'val_session',
  mailFrom: process.env.MAIL_FROM || 'VAL <no-reply@val-league.ru>',
  // Загруженные файлы (логотипы команд). В продакшене укажите путь вне папки с кодом и включите его в бэкапы.
  uploadsDir: process.env.UPLOADS_DIR || fileURLToPath(new URL('../uploads', import.meta.url)),
  // Карты CS2, из которых админ собирает пул турнира (клиент: client/src/views/admin-parts.js).
  maps: ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo'],
  // Лимиты команд: основа + запасные, сколько команд можно создать и в скольких состоять.
  // Регистрация на турниры. Эти значения — допущения по умолчанию; их согласуйте с организаторами (docs/REGISTRATION.md).
  registration: {
    closeMinutes: 60,        // за сколько минут до старта закрываются регистрация, отмена и смена состава
    payHours: 24,            // сколько держим место за неоплаченной заявкой
    waitlistMax: 8,          // размер листа ожидания
    requireSteam: process.env.REQUIRE_STEAM === 'true',   // требовать привязанный Steam у каждого игрока основы (включить после этапа 9)
    paymentDetails: process.env.PAYMENT_DETAILS || 'Реквизиты для перевода пришлёт организатор: напишите в Telegram лиги, указав код платежа.',
  },
  teams: { maxMain: 5, maxSub: 2, maxOwned: 3, maxJoined: 10, maxPendingInvites: 20 },
};
