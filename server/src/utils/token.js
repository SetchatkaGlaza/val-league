import crypto from 'node:crypto';

/** Случайный токен для ссылок из писем. В БД хранится только его хеш. */
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
