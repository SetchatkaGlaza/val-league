import pg from 'pg';

// Один пул соединений на всё приложение.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});
pool.on('error', (e) => console.error('Ошибка соединения с БД:', e.message));

/** Всегда передавайте значения через $1, $2… — так нет SQL-инъекций. */
export const query = (text, params) => pool.query(text, params);

export async function ping() {
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}
