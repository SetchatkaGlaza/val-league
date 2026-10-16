import { Router } from 'express';
import * as c from '../controllers/admin.js';
import * as reg from '../controllers/admin-registrations.js';
import { requireAuth, requireAdmin, writeLimiter } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/dashboard', h(c.dashboard));
router.get('/tournaments', h(c.list));
router.post('/tournaments', writeLimiter, h(c.create));
router.get('/tournaments/:id', h(c.get));
router.patch('/tournaments/:id', writeLimiter, h(c.update));
router.post('/tournaments/:id/status', writeLimiter, h(c.setStatus));
router.delete('/tournaments/:id', writeLimiter, h(c.remove));

router.get('/tournaments/:id/registrations', h(reg.list));
router.post('/registrations/:id/confirm', writeLimiter, h(reg.confirm));
router.post('/registrations/:id/cancel', writeLimiter, h(reg.cancel));
router.post('/registrations/:id/refunded', writeLimiter, h(reg.refunded));

export default router;
