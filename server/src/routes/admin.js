import { Router } from 'express';
import * as c from '../controllers/admin.js';
import * as reg from '../controllers/admin-registrations.js';
import * as bracket from '../controllers/bracket.js';
import * as audit from '../controllers/admin-audit.js';
import * as users from '../controllers/admin-users.js';
import * as teams from '../controllers/admin-teams.js';
import * as notes from '../controllers/admin-notes.js';
import * as settings from '../controllers/admin-settings.js';
import { requireAuth, requireRole, writeLimiter } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
// Вся админка — только для сотрудников. Что можно модератору, а что только админу, решают защиты у каждого маршрута.
const staff = requireRole('moderator', 'admin');
const adminOnly = requireRole('admin');
router.use(requireAuth, staff);

router.get('/me', h(c.me));
router.get('/dashboard', h(c.dashboard));
router.get('/audit', adminOnly, h(audit.list));

// Пользователи: личные данные (почта, Steam), блокировки и роли — только админ
router.get('/users', adminOnly, h(users.list));
router.get('/users/:id', adminOnly, h(users.get));
router.post('/users/:id/block', adminOnly, writeLimiter, h(users.block));
router.post('/users/:id/unblock', adminOnly, writeLimiter, h(users.unblock));
router.post('/users/:id/role', adminOnly, writeLimiter, h(users.setRole));
router.post('/users/:id/verify-email', adminOnly, writeLimiter, h(users.verifyEmail));
router.post('/users/:id/reset-steam', adminOnly, writeLimiter, h(users.resetSteam));
router.post('/users/:id/reset-telegram', adminOnly, writeLimiter, h(users.resetTelegram));
router.post('/users/:id/nick', adminOnly, writeLimiter, h(users.rename));

// Команды: модератор смотрит, снимает логотип и описание, переименовывает; расформировать может только админ
router.get('/teams', h(teams.list));
router.get('/teams/:id', h(teams.get));
router.post('/teams/:id/remove-logo', writeLimiter, h(teams.removeLogo));
router.post('/teams/:id/clear-description', writeLimiter, h(teams.clearDescription));
router.post('/teams/:id/rename', writeLimiter, h(teams.rename));
router.post('/teams/:id/disband', adminOnly, writeLimiter, h(teams.disband));

// Настройки сайта (контакты, баннер, формула рейтинга) — только админ
router.get('/settings', adminOnly, h(settings.get));
router.patch('/settings', adminOnly, writeLimiter, h(settings.update));
router.post('/settings/rating-recalc', adminOnly, writeLimiter, h(settings.recalc));

router.get('/tournaments', h(c.list));
router.post('/tournaments', adminOnly, writeLimiter, h(c.create));
router.get('/tournaments/:id', h(c.get));
router.patch('/tournaments/:id', adminOnly, writeLimiter, h(c.update));
router.post('/tournaments/:id/status', adminOnly, writeLimiter, h(c.setStatus));
router.delete('/tournaments/:id', adminOnly, writeLimiter, h(c.remove));
router.post('/tournaments/:id/duplicate', adminOnly, writeLimiter, h(c.duplicate));
router.post('/tournaments/:id/cancel', adminOnly, writeLimiter, h(c.cancel));

router.get('/tournaments/:id/bracket', h(bracket.adminBracket));
router.post('/tournaments/:id/bracket', adminOnly, writeLimiter, h(bracket.generate));
router.delete('/tournaments/:id/bracket', adminOnly, writeLimiter, h(bracket.removeBracket));
router.post('/tournaments/:id/schedule', writeLimiter, h(bracket.schedule));
router.put('/matches/:id/result', writeLimiter, h(bracket.setResult));
router.patch('/matches/:id', writeLimiter, h(bracket.patchMatch));
router.post('/matches/:id/rollback', writeLimiter, h(bracket.rollbackResult));
router.get('/matches/:id/history', h(notes.matchHistory));

// Внутренние заметки: добавлять и читать могут модераторы и админы, удалять — только админ
router.get('/tournaments/:id/notes', h(notes.list));
router.post('/tournaments/:id/notes', writeLimiter, h(notes.create));
router.delete('/notes/:id', adminOnly, writeLimiter, h(notes.remove));

router.get('/tournaments/:id/registrations', h(reg.list));
router.get('/tournaments/:id/export', writeLimiter, h(reg.exportCsv));
router.post('/tournaments/:id/refunds-done', writeLimiter, h(reg.refundedAll));
router.post('/registrations/:id/confirm', writeLimiter, h(reg.confirm));
router.post('/registrations/:id/cancel', writeLimiter, h(reg.cancel));
router.post('/registrations/:id/refunded', writeLimiter, h(reg.refunded));

export default router;
