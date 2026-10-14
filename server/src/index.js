import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use((_req, res) => res.status(404).json({ code: 'not_found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ code: 'server_error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`VAL API: http://localhost:${port}`));
