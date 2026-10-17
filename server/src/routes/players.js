import { Router } from 'express';
import * as c from '../controllers/players.js';
import { h } from '../utils/http.js';

const router = Router();
router.get('/', h(c.rating));    // рейтинг игроков (этап 7.1)
router.get('/:nick', h(c.get));   // публичный профиль игрока (этап 6.3)
export default router;
