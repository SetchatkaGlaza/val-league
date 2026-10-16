import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { Telegraf } from 'telegraf';
import config from './config.js';
import { registerStartHandlers } from './handlers/start.js';
import { registerHelpHandlers } from './handlers/help.js';
import { deliverNotification } from './services/notifications.js';

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
const app = express();
bot.catch(err => console.error('Telegram update failed:', err.message));
registerStartHandlers(bot);
registerHelpHandlers(bot);

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({limit:'16kb', strict:true}));
app.use('/internal', rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false}));
app.get('/health', (_req,res) => res.json({ok:true,service:'val-telegram-bot'}));

function equalSecret(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
app.post('/internal/notify', async (req,res,next) => {
  const auth=req.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || !equalSecret(auth.slice(7),config.VAL_BOT_SHARED_SECRET)) return res.status(401).json({ok:false,error:'unauthorized'});
  next();
}, async (req,res) => {
  try { res.status(202).json({ok:true,...await deliverNotification(bot,req.body)}); }
  catch(err) {
    const status=err.name==='ZodError' ? 400 : 502;
    console.error('Notification delivery failed:',err.message);
    res.status(status).json({ok:false,error:status===400?'invalid_payload':'delivery_failed'});
  }
});

const server=app.listen(config.PORT,()=>console.log(`VAL bot service listening on ${config.PORT}`));
let launched=false;
try { await bot.launch(); launched=true; console.log('Telegram polling started'); }
catch(err) { console.error('Telegram bot failed to start:',err.message); server.close(()=>process.exit(1)); }
async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  if (launched) bot.stop(signal);
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),10000).unref();
}
process.once('SIGINT',()=>shutdown('SIGINT'));
process.once('SIGTERM',()=>shutdown('SIGTERM'));
