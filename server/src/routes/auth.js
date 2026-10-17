import { Router } from 'express';
import * as c from '../controllers/auth.js';
import * as steam from '../controllers/steam.js';
import { formLimiter, loginLimiter, requireAuth } from '../middleware/auth.js';

const router = Router();
// Express 4 не ловит ошибки async-обработчиков сам — оборачиваем.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post('/register', formLimiter, h(c.register));
router.post('/login', loginLimiter, h(c.login));
router.post('/logout', c.logout);
router.get('/me', requireAuth, c.me);
router.post('/verify-email', formLimiter, h(c.verifyEmail));
router.post('/resend-verification', formLimiter, h(c.resendVerification));
router.post('/forgot-password', formLimiter, h(c.forgotPassword));
router.post('/reset-password', formLimiter, h(c.resetPassword));

// Вход и привязка через Steam (OpenID): это переходы браузера, поэтому ответы — редиректы на страницы сайта.
router.get('/steam', formLimiter, h(steam.start));
router.get('/steam/callback', formLimiter, h(steam.callback));
router.get('/steam/pending', formLimiter, h(steam.pending));
router.post('/steam/register', formLimiter, h(steam.register));

export default router;
