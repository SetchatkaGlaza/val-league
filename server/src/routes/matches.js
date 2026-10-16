import { Router } from 'express';
import * as c from '../controllers/bracket.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
router.get('/mine', requireAuth, h(c.myMatches));      // до '/:id'
router.get('/:id', optionalAuth, h(c.getMatch));       // вход не обязателен: участникам дополнительно показываем данные лобби
export default router;
