import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  VAL_SITE_URL: z.string().url(),
  VAL_API_BASE_URL: z.string().url(),
  VAL_BOT_SHARED_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(4010),
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(''),
  VAL_PRIVACY_URL: z.string().url().optional()
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error('Invalid bot configuration: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
const c = parsed.data;
if (c.NODE_ENV === 'production' && (new URL(c.VAL_SITE_URL).protocol !== 'https:' || new URL(c.VAL_API_BASE_URL).protocol !== 'https:')) {
  throw new Error('VAL_SITE_URL and VAL_API_BASE_URL must use HTTPS in production');
}
export default Object.freeze({...c, VAL_SITE_URL:c.VAL_SITE_URL.replace(/\/$/,''), VAL_API_BASE_URL:c.VAL_API_BASE_URL.replace(/\/$/,''), VAL_PRIVACY_URL:c.VAL_PRIVACY_URL || `${c.VAL_SITE_URL}/privacy`});
