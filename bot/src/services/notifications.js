import { z } from 'zod';
import { Markup } from 'telegraf';
import config from '../config.js';

const events = ['account.telegram_linked','team.invitation_created','tournament.registration_submitted','tournament.registration_approved','tournament.registration_rejected','tournament.payment_confirmed','match.scheduled','match.starting_soon','match.result_published','admin.system_alert'];
const schema = z.object({
  eventId:z.string().min(8).max(128),
  eventType:z.enum(events),
  recipientTelegramId:z.string().regex(/^\d{1,24}$/),
  message:z.string().min(1).max(3500),
  webAppUrl:z.string().url().optional()
});
// Best-effort process-local dedupe only. Replace with persistent storage/outbox before production.
const recent = new Map();
export async function deliverNotification(bot, input) {
  const p = schema.parse(input);
  if (recent.has(p.eventId)) return {accepted:true, duplicate:true};
  let keyboard;
  if (p.webAppUrl) {
    const u = new URL(p.webAppUrl), site = new URL(config.VAL_SITE_URL);
    if (u.host !== site.host || (config.NODE_ENV === 'production' && u.protocol !== 'https:')) throw new Error('Untrusted webAppUrl');
    keyboard = Markup.inlineKeyboard([[Markup.button.url('Открыть на сайте VAL',u.toString())]]);
  }
  await bot.telegram.sendMessage(p.recipientTelegramId,p.message,keyboard);
  recent.set(p.eventId,Date.now());
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  return {accepted:true, duplicate:false};
}
