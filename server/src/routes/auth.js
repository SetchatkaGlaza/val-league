import { Router } from 'express';

const router = Router();
// Заглушки: реализуем следующим шагом (БД, bcrypt, JWT-cookie, Steam OpenID).
const todo = (_req, res) => res.status(501).json({ code: 'not_implemented' });
router.post('/login', todo);
router.post('/register', todo);
router.get('/steam', todo);
export default router;
