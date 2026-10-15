import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { query } from '../db/index.js';
import { config } from '../config.js';

const limited = (_req, res) => res.status(429).json({ code: 'rate_limited' });

/** Общий лимит на формы входа/регистрации/писем. */
export const formLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, handler: limited });

/** Подбор пароля: 10 неудачных попыток за 15 минут на пару «IP + почта». Успешные входы не считаются. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true, handler: limited,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
});

/** Состояние-меняющие запросы принимаем только со своего сайта (защита от CSRF поверх SameSite). */
export function sameOrigin(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== config.clientUrl) return res.status(403).json({ code: 'forbidden' });
  }
  next();
}

/** Лимит на действия с командами: считается по пользователю, а не по IP (за одним IP может сидеть вся компания в клубе). */
export const writeLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 80, standardHeaders: 'draft-7', legacyHeaders: false, handler: limited,
  keyGenerator: (req) => req.user?.id || req.ip,
});

export const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' };

/** Достаёт пользователя из cookie. Блокировка действует сразу: пользователь каждый раз читается из БД. */
export async function requireAuth(req, res, next) {
  try {
    const raw = req.cookies?.[config.cookieName];
    if (!raw) return res.status(401).json({ code: 'unauthorized' });
    const { sub } = jwt.verify(raw, config.jwtSecret);
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [sub]);
    if (!rows[0] || rows[0].blocked) {
      res.clearCookie(config.cookieName, cookieOptions);
      return res.status(401).json({ code: 'unauthorized' });
    }
    req.user = rows[0];
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
      res.clearCookie(config.cookieName, cookieOptions);
      return res.status(401).json({ code: 'unauthorized' });
    }
    next(e);
  }
}

/** Для публичных страниц, которым нужно знать, кто смотрит (капитан видит больше). Без входа просто идёт дальше. */
export async function optionalAuth(req, _res, next) {
  try {
    const raw = req.cookies?.[config.cookieName];
    if (raw) {
      const { sub } = jwt.verify(raw, config.jwtSecret);
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [sub]);
      if (rows[0] && !rows[0].blocked) req.user = rows[0];
    }
  } catch (e) {
    if (e.name !== 'JsonWebTokenError' && e.name !== 'TokenExpiredError') return next(e);
  }
  next();
}
