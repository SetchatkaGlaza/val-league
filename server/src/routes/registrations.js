import { Router } from 'express';
import * as c from '../controllers/registrations.js';
import { requireAuth, writeLimiter } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

router.get('/mine', h(c.listMine));                       // до '/:id'
router.get('/:id', h(c.get));
router.post('/:id/cancel', writeLimiter, h(c.cancel));
router.put('/:id/roster', writeLimiter, h(c.updateRoster));

export default router;
