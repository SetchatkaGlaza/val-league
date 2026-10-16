import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import teamRoutes, { inviteRoutes } from './routes/teams.js';
import accountRoutes from './routes/account.js';
import tournamentRoutes, { winnersRoutes } from './routes/tournaments.js';
import adminRoutes from './routes/admin.js';
import registrationRoutes from './routes/registrations.js';
import { sweepExpired } from './services/registrations.js';
import { ping } from './db/index.js';
import { config } from './config.js';
import { sameOrigin } from './middleware/auth.js';
import { HttpError } from './utils/http.js';

const app = express();
// За nginx/прокси: TRUST_PROXY=1, иначе лимиты попыток будут считать IP прокси, а не пользователя.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.use(helmet());
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: '32kb' }));   // описание турнира до 3000 символов (кириллица = 2 байта)
app.use(cookieParser());
// Файлы (логотипы) раздаём до общего лимита запросов: на странице турнира их десятки. Имена случайные, поэтому кэш «навсегда».
app.use('/api/files', (_req, res, next) => { res.set('Cross-Origin-Resource-Policy', 'cross-origin'); next(); },
  express.static(config.uploadsDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));
app.use('/api', sameOrigin);

app.get('/api/health', async (_req, res) => res.json({ ok: true, db: await ping() }));
app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/winners', winnersRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/admin', adminRoutes);
app.use((_req, res) => res.status(404).json({ code: 'not_found' }));
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ code: err.code, ...(err.field && { field: err.field }), ...(err.details && { details: err.details }) });
  if (err.type === 'entity.too.large') return res.status(413).json({ code: 'too_large' });
  if (err.status && err.status < 500) return res.status(err.status).json({ code: 'bad_request' });   // битый JSON и т. п.
  console.error(err);
  res.status(500).json({ code: 'server_error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`VAL API: http://localhost:${port}`));

// Раз в 5 минут снимаем заявки с истёкшим сроком оплаты и двигаем лист ожидания.
// (Если БД недоступна — просто пробуем в следующий раз.)
const sweep = () => sweepExpired().catch((e) => console.error('Проверка сроков оплаты не удалась:', e.message));
setTimeout(sweep, 10_000).unref();
setInterval(sweep, 5 * 60_000).unref();
