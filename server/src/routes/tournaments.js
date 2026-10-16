import { Router } from 'express';
import * as c from '../controllers/tournaments.js';
import * as reg from '../controllers/registrations.js';
import * as bracket from '../controllers/bracket.js';
import { requireAuth, writeLimiter } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
router.get('/', h(c.list));
router.get('/next', h(c.next));      // до '/:slug', иначе «next» сочтётся адресом турнира
router.get('/:slug', h(c.get));
router.get('/:slug/bracket', h(bracket.publicBracket));
router.get('/:slug/registration', requireAuth, h(reg.eligibility));
router.post('/:slug/registrations', requireAuth, writeLimiter, h(reg.create));
export default router;

export const winnersRoutes = Router();
winnersRoutes.get('/', h(c.winners));
