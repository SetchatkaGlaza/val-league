import 'dotenv/config';
import { pool } from './index.js';

// Использование: npm run admin:make -- you@mail.ru   (или ник игрока). Модератор: добавьте --moderator. Снять права: --remove
const who = process.argv[2];
const remove = process.argv.includes('--remove');
const role = remove ? 'player' : process.argv.includes('--moderator') ? 'moderator' : 'admin';
if (!who || who.startsWith('--')) {
  console.error('Укажите почту или ник: npm run admin:make -- you@mail.ru');
  process.exit(1);
}
try {
  const { rows } = await pool.query(
    'UPDATE users SET role = $2 WHERE email = $1 OR nick = $1 RETURNING nick, email, role', [who, role]);
  if (!rows[0]) { console.error(`Пользователь «${who}» не найден. Сначала зарегистрируйтесь на сайте.`); process.exitCode = 1; }
  else console.log(`${rows[0].nick} (${rows[0].email || 'без почты'}) → ${rows[0].role}. Обновите страницу или войдите снова, чтобы в шапке появилась «Админка».`);
} catch (e) {
  console.error('Не удалось:', e.message); process.exitCode = 1;
} finally { await pool.end(); }
