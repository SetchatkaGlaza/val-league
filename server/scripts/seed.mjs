// Тестовые данные: npm run db:seed        — создать (повторный запуск сначала удаляет старые тестовые данные)
//                  npm run db:seed -- --remove — только удалить
// Создаёт 12 команд (по 5 основных игроков, у части есть 1–2 запасных), все аккаунты с подтверждённой почтой
// и турнир «VAL Test Cup» (5×5, BO1) с 10 оплаченными заявками, 1 заявкой «ждёт оплату» и 1 командой без заявки.
// Всё тестовое помечено почтой @seed.val.test и адресом турнира val-test-cup, на реальные данные не влияет.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { pool, withTx } from '../src/db/index.js';
import { randomToken } from '../src/utils/token.js';

const DOMAIN = '@seed.val.test';
const PASSWORD = 'Password1';
const T_SLUG = 'val-test-cup';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// [название, адрес, [основа...], [запасные...]] — первый в основе капитан
const TEAMS = [
  ['Северный Ветер', 'severnyy-veter', ['Veter', 'Zima', 'Kedr', 'Lyod', 'Sneg'], ['Ugol']],
  ['Красный Кремль', 'krasnyy-kreml', ['Kreml', 'Bashnya', 'Zvezda', 'Orel', 'Gerb'], []],
  ['Вологодское Масло', 'vologodskoe-maslo', ['Maslo', 'Slivki', 'Tvorog', 'Kefir', 'Smetana'], ['Moloko', 'Syr']],
  ['Кружевные', 'kruzhevnye', ['Kruzhevo', 'Nit', 'Uzor', 'Igla', 'Petlya'], []],
  ['Колокольня', 'kolokolnya', ['Zvon', 'Kolokol', 'Blagovest', 'Nabat', 'Shpil'], ['Kupol']],
  ['Шексна Рейд', 'sheksna-reyd', ['Sheksna', 'Bakren', 'Plot', 'Lodka', 'Prichal'], []],
  ['Лёд и Пламя', 'lyod-i-plamya', ['Plamya', 'Iskra', 'Zola', 'Ember', 'Frost'], ['Dym', 'Pepel']],
  ['Золотое Кольцо', 'zolotoe-koltso', ['Koltso', 'Zoloto', 'Slitok', 'Karat', 'Proba'], []],
  ['Тихая Гавань', 'tikhaya-gavan', ['Gavan', 'Tishina', 'Volna', 'Bukhta', 'Maya'], ['Shtil']],
  ['Ночной Вокзал', 'nochnoy-vokzal', ['Vokzal', 'Perron', 'Rels', 'Semafor', 'Platforma'], []],
  ['Берёзовый Сок', 'berezovyy-sok', ['Bereza', 'Sok', 'Listva', 'Roshcha', 'Kora'], ['Vetka']],
  ['Лесной Патруль', 'lesnoy-patrul', ['Patrul', 'Les', 'Chashcha', 'Mokh', 'Tropa'], []],
];

const code = () => `VAL-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

async function remove(db) {
  await db.query('DELETE FROM tournaments WHERE slug = $1', [T_SLUG]);               // заявки и матчи уйдут каскадом
  await db.query('DELETE FROM teams WHERE slug = ANY($1::text[])', [TEAMS.map((t) => t[1])]);
  const { rowCount } = await db.query('DELETE FROM users WHERE email LIKE $1', [`%${DOMAIN}`]);
  return rowCount;
}

try {
  if (!(await pool.query('SELECT to_regclass(\'public.matches\') AS t')).rows[0].t) throw new Error('Схема БД не применена. Сначала: npm run db:migrate');
  const hash = await bcrypt.hash(PASSWORD, 10);

  const summary = await withTx(async (db) => {
    const removed = await remove(db);
    if (process.argv.includes('--remove')) return { removed };

    const teamIds = [];
    for (const [name, slug, main, subs] of TEAMS) {
      const players = [];
      for (const [i, nick] of [...main, ...subs].entries()) {
        const n = `${nick}`.slice(0, 20);
        const { rows: [u] } = await db.query(
          `INSERT INTO users (nick, email, password_hash, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id, nick`,
          [n, `${slug}-${i + 1}${DOMAIN}`, hash]);
        players.push({ ...u, role: i < main.length ? 'main' : 'sub' });
      }
      const { rows: [team] } = await db.query(
        `INSERT INTO teams (slug, name, description, captain_id, invite_token) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [slug, name, 'Тестовая команда', players[0].id, randomToken()]);
      for (const p of players) await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [team.id, p.id, p.role]);
      teamIds.push({ id: team.id, name, captain: players[0].id, roster: players.filter((p) => p.role === 'main').map((p) => ({ id: p.id, nick: p.nick })) });
    }

    const { rows: [t] } = await db.query(
      `INSERT INTO tournaments (slug, name, description, starts_at, team_size, match_format, fee, prize_places, max_teams, map_pool, status, registration_open)
       VALUES ($1, 'VAL Test Cup', 'Тестовый турнир для проверки сетки', now() + interval '3 days', 5, 'bo1', 300, $2::jsonb, 16,
               ARRAY['de_mirage','de_nuke','de_inferno'], 'upcoming', true) RETURNING id`,
      [T_SLUG, JSON.stringify([{ place: 1, amount: 3000 }, { place: 2, amount: 1000 }])]);

    for (const [i, tm] of teamIds.slice(0, 11).entries()) {
      const paid = i < 10;
      await db.query(
        `INSERT INTO tournament_registrations
           (tournament_id, team_id, team_name, status, roster, roster_ids, registered_by, fee, payment_code, pay_until, paid_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::uuid[], $7, 300, $8, $9, $10)`,
        [t.id, tm.id, tm.name, paid ? 'paid' : 'pending_payment', JSON.stringify(tm.roster), tm.roster.map((p) => p.id), tm.captain,
          code(), paid ? null : new Date(Date.now() + 2 * 864e5), paid ? new Date() : null]);
    }
    return { removed, teams: TEAMS.length };
  });

  if (process.argv.includes('--remove')) console.log(`Тестовые данные удалены (аккаунтов: ${summary.removed}).`);
  else {
    console.log(`Готово: ${summary.teams} команд, турнир «VAL Test Cup» (/tournaments/${T_SLUG}).`);
    console.log('  10 заявок оплачено, 1 ждёт оплаты (Берёзовый Сок), 1 команда без заявки (Лесной Патруль).');
    console.log(`  Вход капитаном: veter / severnyy-veter-1${DOMAIN}, пароль ${PASSWORD} (у всех команд: <адрес-команды>-1${DOMAIN}).`);
    console.log('  Удалить всё тестовое: npm run db:seed -- --remove');
  }
} catch (e) {
  console.error('Не удалось:', e.message); process.exitCode = 1;
} finally { await pool.end(); }
