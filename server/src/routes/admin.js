import { Router } from 'express';
import * as c from '../controllers/admin.js';
import * as reg from '../controllers/admin-registrations.js';
import * as bracket from '../controllers/bracket.js';
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

router.get('/tournaments/:id/bracket', h(bracket.adminBracket));
router.post('/tournaments/:id/bracket', writeLimiter, h(bracket.generate));
router.delete('/tournaments/:id/bracket', writeLimiter, h(bracket.removeBracket));
router.post('/tournaments/:id/schedule', writeLimiter, h(bracket.schedule));
router.put('/matches/:id/result', writeLimiter, h(bracket.setResult));
router.patch('/matches/:id', writeLimiter, h(bracket.patchMatch));

router.get('/tournaments/:id/registrations', h(reg.list));
router.post('/registrations/:id/confirm', writeLimiter, h(reg.confirm));
router.post('/registrations/:id/cancel', writeLimiter, h(reg.cancel));
router.post('/registrations/:id/refunded', writeLimiter, h(reg.refunded));

export default router;
