import 'dotenv/config';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const sql = fs.readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
try {
  await pool.query(sql);
  console.log('Схема БД применена.');
} catch (e) {
  console.error('Не удалось применить схему:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
