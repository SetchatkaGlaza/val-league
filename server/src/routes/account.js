import { Router } from 'express';
import * as c from '../controllers/account.js';
import { requireAuth, writeLimiter, passwordLimiter } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

router.post('/profile', writeLimiter, h(c.updateProfile));
// Смену пароля ограничиваем как вход: иначе по украденной сессии можно подбирать текущий пароль.
router.post('/password', passwordLimiter, h(c.changePassword));
router.post('/notifications', writeLimiter, h(c.saveNotifications));
// Отвязка Steam: пароль подтверждаем так же, как при смене пароля (лимит на подбор).
router.post('/steam/unlink', passwordLimiter, h(c.unlinkSteam));
router.post('/delete', writeLimiter, h(c.deleteAccount));

router.post('/telegram/code', c.soon);
router.post('/telegram/check', c.soon);
router.post('/telegram/unlink', c.soon);

export default router;
