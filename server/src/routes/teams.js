import express, { Router } from 'express';
import * as c from '../controllers/teams.js';
import { requireAuth, optionalAuth, writeLimiter } from '../middleware/auth.js';
import { h } from '../utils/http.js';

const router = Router();
const logoBody = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '1mb' });
const auth = [requireAuth, writeLimiter];

router.get('/mine', requireAuth, h(c.listMine));
router.post('/', ...auth, h(c.create));
router.get('/:slug', optionalAuth, h(c.get));
router.patch('/:slug', ...auth, h(c.update));
router.delete('/:slug', ...auth, h(c.remove));

router.put('/:slug/logo', ...auth, logoBody, h(c.setLogo));
router.delete('/:slug/logo', ...auth, h(c.removeLogo));

router.post('/:slug/invites', ...auth, h(c.inviteByNick));
router.delete('/:slug/invites/:inviteId', ...auth, h(c.revokeInvite));
router.post('/:slug/invite-link/reset', ...auth, h(c.resetInviteLink));

router.patch('/:slug/members/:userId', ...auth, h(c.setMemberRole));
router.delete('/:slug/members/:userId', ...auth, h(c.removeMember));
router.post('/:slug/captain', ...auth, h(c.transferCaptain));

export default router;

/** Страница «Вас пригласили»: посмотреть приглашение, принять, отклонить. */
export const inviteRoutes = Router();
inviteRoutes.get('/preview', requireAuth, h(c.previewInvite));
inviteRoutes.post('/accept', ...auth, h(c.acceptInvite));
inviteRoutes.post('/decline', ...auth, h(c.declineInvite));
