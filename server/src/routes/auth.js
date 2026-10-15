import { Router } from 'express';
import * as c from '../controllers/auth.js';
import { formLimiter, loginLimiter, requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

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

// Вход через Steam (OpenID) ещё не сделан: возвращаем на сайт с понятным сообщением.
router.get('/steam', (req, res) => res.redirect(`${config.clientUrl}${req.query.link ? '/account' : '/login'}?error=steam_soon`));

export default router;
