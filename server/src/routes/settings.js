import { Router } from 'express';
import * as c from '../controllers/settings.js';
import { h } from '../utils/http.js';

const router = Router();
router.get('/', h(c.getPublic));   // контакты, соцсети, баннер (этап 8.4)
export default router;
