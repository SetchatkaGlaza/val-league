// Сквозная проверка API: npm run smoke  (сервер должен быть запущен: npm run dev:server, БД — мигрирована)
// Создаёт тестовых игроков smoke_*, команду и турнир, проверяет основные сценарии и всё за собой удаляет.
import 'dotenv/config';
import { pool } from '../src/db/index.js';

const BASE = process.env.SMOKE_URL || `http://localhost:${process.env.PORT || 4000}/api`;
const run = Date.now().toString(36).slice(-5);
let failed = 0, passed = 0;

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) { const c = sc.map((s) => s.split(';')[0]).filter((s) => !/=$/.test(s)); cookie = c.length ? c.join('; ') : ''; }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`, extra ?? ''); }
}

async function makeUser(tag) {
  const api = client();
  const nick = `smk_${tag}_${run}`, email = `${nick}@example.com`, pass = 'Password1';
  const r = await api('POST', '/auth/register', { nick, email, password: pass, terms: true });
  if (r.status !== 201) throw new Error(`регистрация ${tag}: ${r.status} ${JSON.stringify(r.data)}`);
  await pool.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
  const l = await api('POST', '/auth/login', { email, password: pass });
  if (l.status !== 200) throw new Error(`вход ${tag}: ${l.status} ${JSON.stringify(l.data)}`);
  return { api, nick, email, pass, id: l.data.user.id };
}

const created = { users: [], teams: [], tournaments: [] };
try {
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok || !health.db) throw new Error('Сервер или БД недоступны. Запустите npm run dev:server и npm run db:migrate.');

  console.log('Аккаунты');
  const cap = await makeUser('cap'), pl = await makeUser('pl'), adm = await makeUser('adm');
  created.users.push(cap.email, pl.email, adm.email);
  await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adm.email]);
  check('профиль открывается', (await cap.api('GET', '/auth/me')).data.user?.nick === cap.nick);
  check('ник нельзя занять', (await pl.api('POST', '/account/profile', { nick: cap.nick.toUpperCase() })).status === 409);
  check('ник меняется', (await pl.api('POST', '/account/profile', { nick: `${pl.nick}x` })).status === 200);
  check('неверный текущий пароль', (await pl.api('POST', '/account/password', { current: 'Wrong123', password: 'Password2' })).status === 401);
  check('пароль меняется', (await pl.api('POST', '/account/password', { current: pl.pass, password: 'Password2' })).status === 200);
  check('после смены пароля сессия жива', (await pl.api('GET', '/auth/me')).status === 200);
  check('уведомления сохраняются', (await pl.api('POST', '/account/notifications', { registered: { email: true, tg: false }, tomorrow: { email: true, tg: false }, match30: { email: false, tg: false } })).status === 200);
  check('Telegram пока «скоро»', (await pl.api('POST', '/account/telegram/code', {})).status === 501);

  console.log('Команды');
  const t = await cap.api('POST', '/teams', { name: `Smoke ${run}`, description: 'тест' });
  check('команда создаётся', t.status === 201, t.data);
  const slug = t.data.slug; created.teams.push(slug);
  check('каталог находит команду', (await cap.api('GET', `/teams?q=${encodeURIComponent(`smoke ${run}`)}`)).data.teams?.some((x) => x.slug === slug));
  check('приглашение по нику', (await cap.api('POST', `/teams/${slug}/invites`, { nick: `${pl.nick}x` })).status === 201);
  const mine = await pl.api('GET', '/teams/mine');
  check('приглашение видно игроку', mine.data.invites?.length === 1);
  const acc = await pl.api('POST', '/invites/accept', { id: mine.data.invites[0].id });
  check('игрок вступает', acc.status === 200 && acc.data.slug === slug, acc.data);
  check('капитан не уйдёт', (await cap.api('DELETE', `/teams/${slug}/members/${cap.id}`)).status === 409);
  const del = await cap.api('POST', '/account/delete', { nick: cap.nick });
  check('удаление капитана с командой запрещено', del.status === 409 && del.data.code === 'captain_must_transfer' && del.data.details?.length === 1, del.data);
  check('капитанство передаётся', (await cap.api('POST', `/teams/${slug}/captain`, { userId: pl.id })).status === 200);

  console.log('Турниры');
  const start = new Date(Date.now() + 7 * 864e5).toISOString();
  const body = { name: `Smoke Cup ${run}`, startsAt: start, maxTeams: 16, fee: 500, mapPool: ['de_mirage', 'de_nuke'], prizePlaces: [{ place: 1, amount: 3000 }, { place: 2, amount: 1000 }] };
  check('игрок не админ', (await pl.api('POST', '/admin/tournaments', body)).status === 403);
  const c = await adm.api('POST', '/admin/tournaments', body);
  check('турнир создаётся черновиком', c.status === 201 && c.data.tournament.status === 'draft' && c.data.tournament.prizeTotal === 4000, c.data);
  const tid = c.data.tournament.id, tslug = c.data.tournament.slug; created.tournaments.push(tid);
  check('черновик не виден публично', (await pl.api('GET', `/tournaments/${tslug}`)).status === 404);
  check('кривой пул карт отклоняется', (await adm.api('PATCH', `/admin/tournaments/${tid}`, { mapPool: ['de_unknown'] })).status === 400);
  check('призы с пропуском места отклоняются', (await adm.api('PATCH', `/admin/tournaments/${tid}`, { prizePlaces: [{ place: 2, amount: 1 }] })).status === 400);
  check('турнир публикуется', (await adm.api('POST', `/admin/tournaments/${tid}/status`, { status: 'upcoming' })).status === 200);
  check('виден в «Предстоящих»', (await pl.api('GET', '/tournaments?tab=upcoming')).data.tournaments?.some((x) => x.slug === tslug));
  check('главная получает ближайший', !!(await pl.api('GET', '/tournaments/next')).data.tournament);
  check('нельзя сразу завершить', (await adm.api('POST', `/admin/tournaments/${tid}/status`, { status: 'finished' })).status === 409);
  check('идущий нельзя удалить', (await adm.api('DELETE', `/admin/tournaments/${tid}`)).status === 409);
  await adm.api('POST', `/admin/tournaments/${tid}/status`, { status: 'live' });
  check('в идущем нельзя менять взнос', (await adm.api('PATCH', `/admin/tournaments/${tid}`, { fee: 1 })).status === 409);
  check('описание менять можно', (await adm.api('PATCH', `/admin/tournaments/${tid}`, { description: 'ok' })).status === 200);
  const fin = await adm.api('POST', `/admin/tournaments/${tid}/status`, { status: 'finished', winnerName: 'Smoke Team', winnerRoster: ['a', 'b'] });
  check('турнир завершается с победителем', fin.status === 200 && fin.data.tournament.winner?.name === 'Smoke Team', fin.data);
  check('победитель на главной', (await pl.api('GET', '/winners?limit=20')).data.winners?.some((w) => w.slug === tslug));

  console.log('Заявки на турнир');
  // pl — капитан команды (slug) вместе с cap; adm — капитан второй команды вместе с x и pl
  const x = await makeUser('x'); created.users.push(x.email);
  const plNick = `${pl.nick}x`;
  const t2 = await adm.api('POST', '/teams', { name: `Smk2 ${run}` });
  check('вторая команда создаётся', t2.status === 201, t2.data);
  const slug2 = t2.data.slug; created.teams.push(slug2);
  for (const u of [{ api: x.api, nick: x.nick }, { api: pl.api, nick: plNick }]) {
    await adm.api('POST', `/teams/${slug2}/invites`, { nick: u.nick });
    const inv = await u.api('GET', '/teams/mine');
    await u.api('POST', '/invites/accept', { id: inv.data.invites.find((i) => i.slug === slug2)?.id });
  }
  const rb = { name: `Smoke Reg ${run}`, startsAt: new Date(Date.now() + 7 * 864e5).toISOString(), maxTeams: 1, fee: 500, teamSize: 2 };
  const rc = await adm.api('POST', '/admin/tournaments', rb);
  const rid = rc.data.tournament.id, rslug = rc.data.tournament.slug; created.tournaments.push(rid);
  const reg = (api, team, roster, accept = true) => api('POST', `/tournaments/${rslug}/registrations`, { teamSlug: team, roster, acceptRules: accept });
  check('регистрация на черновик недоступна', (await reg(pl.api, slug, [pl.id, cap.id])).status === 404);
  await adm.api('POST', `/admin/tournaments/${rid}/status`, { status: 'upcoming' });

  const e1 = await pl.api('GET', `/tournaments/${rslug}/registration`);
  check('капитан видит свою команду и может подать заявку', e1.data.canRegister === true && e1.data.teams?.some((t) => t.slug === slug), e1.data);
  check('не капитан заявку не подаёт', (await reg(cap.api, slug, [pl.id, cap.id])).status === 403);
  check('без согласия с регламентом нельзя', (await reg(pl.api, slug, [pl.id, cap.id], false)).status === 400);
  check('состав неверного размера', (await reg(pl.api, slug, [pl.id])).status === 400);
  check('в составе только игроки команды', (await reg(pl.api, slug, [pl.id, x.id])).status === 409);
  const r1 = await reg(pl.api, slug, [pl.id, cap.id]);
  check('заявка принята, ждёт оплату', r1.status === 201 && r1.data.registration.status === 'pending_payment' && /^VAL-/.test(r1.data.registration.payment?.code || ''), r1.data);
  const r1id = r1.data.registration.id;
  check('вторая заявка той же команды отклоняется', (await reg(pl.api, slug, [pl.id, cap.id])).status === 409);
  const busy = await reg(adm.api, slug2, [adm.id, pl.id]);
  check('игрок из чужой заявки занят', busy.status === 409 && busy.data.code === 'player_busy', busy.data);
  const r2 = await reg(adm.api, slug2, [adm.id, x.id]);
  check('мест нет: вторая команда в листе ожидания', r2.status === 201 && r2.data.registration.status === 'waitlist' && r2.data.registration.waitlistPosition === 1, r2.data);
  const r2id = r2.data.registration.id;

  check('заявленного игрока нельзя исключить', (await pl.api('DELETE', `/teams/${slug}/members/${cap.id}`)).status === 409);
  check('команду с заявкой нельзя удалить', (await pl.api('DELETE', `/teams/${slug}`)).status === 409);
  check('игрока из заявки нельзя удалить как аккаунт', (await x.api('POST', '/account/delete', { nick: x.nick })).data.code === 'in_tournament');
  check('чужую заявку не видно', (await x.api('GET', `/registrations/${r1id}`)).status === 404);
  check('игрок состава видит заявку', (await cap.api('GET', `/registrations/${r1id}`)).status === 200);

  check('игрок не подтверждает оплату', (await pl.api('POST', `/admin/registrations/${r1id}/confirm`, {})).status === 403);
  const conf = await adm.api('POST', `/admin/registrations/${r1id}/confirm`, {});
  check('админ подтверждает оплату', conf.status === 200 && conf.data.registration.status === 'paid', conf.data);
  check('оплаченная заявка в публичном списке', await pl.api('GET', `/tournaments/${rslug}`).then((r) => r.data.teams?.length === 1 && r.data.tournament.paidCount === 1 && r.data.tournament.waitlistCount === 1));
  check('состав заявки меняется до закрытия', (await pl.api('PUT', `/registrations/${r1id}/roster`, { roster: [cap.id, pl.id] })).status === 200);
  check('лимит мест можно расширить', (await adm.api('PATCH', `/admin/tournaments/${rid}`, { maxTeams: 2 })).status === 200);
  check('расширение лимита подвинуло лист ожидания', (await adm.api('GET', `/admin/tournaments/${rid}/registrations`)).data.registrations?.find((r) => r.id === r2id)?.status === 'pending_payment');
  check('формат состава с заявками менять нельзя', (await adm.api('PATCH', `/admin/tournaments/${rid}`, { teamSize: 5 })).status === 409);
  check('лимит ниже занятых мест нельзя', (await adm.api('PATCH', `/admin/tournaments/${rid}`, { maxTeams: 1 })).status === 409);

  const cn = await pl.api('POST', `/registrations/${r1id}/cancel`);
  check('капитан снимает оплаченную заявку, взнос к возврату', cn.status === 200 && cn.data.registration.status === 'cancelled' && cn.data.registration.refundDue === true, cn.data);
  check('снятую заявку нельзя снять повторно', (await pl.api('POST', `/registrations/${r1id}/cancel`)).status === 409);
  const mineAdm = await adm.api('GET', '/registrations/mine');
  check('«Мои заявки» показывают заявку капитана', mineAdm.data.registrations?.some((r) => r.id === r2id && r.isCaptain));

  check('турнир начинается', (await adm.api('POST', `/admin/tournaments/${rid}/status`, { status: 'live' })).status === 200);
  const after = (await adm.api('GET', `/admin/tournaments/${rid}/registrations`)).data.registrations;
  check('при старте неоплаченные заявки сняты', after.find((r) => r.id === r2id)?.status === 'cancelled' && after.find((r) => r.id === r2id)?.cancelReason === 'tournament_started', after);
  check('отменяем турнир', (await adm.api('POST', `/admin/tournaments/${rid}/status`, { status: 'cancelled' })).status === 200);
  check('турнир с невозвращённым взносом не удаляется', (await adm.api('DELETE', `/admin/tournaments/${rid}`)).data.code === 'has_payments');
  check('взнос отмечен возвращённым', (await adm.api('POST', `/admin/registrations/${r1id}/refunded`)).status === 200);
  check('теперь турнир удаляется', (await adm.api('DELETE', `/admin/tournaments/${rid}`)).status === 200);

  console.log('Удаление аккаунта');
  check('теперь капитан (бывший) удаляется', (await cap.api('POST', '/account/delete', { nick: cap.nick })).status === 200);
  check('сессия после удаления не работает', (await cap.api('GET', '/auth/me')).status === 401);
} catch (e) {
  failed++; console.error('\nОшибка сценария:', e.message);
} finally {
  // Уборка: тестовые данные удаляем по меткам.
  try {
    await pool.query('DELETE FROM tournaments WHERE id = ANY($1::uuid[])', [created.tournaments]);
    await pool.query('DELETE FROM teams WHERE slug = ANY($1::text[])', [created.teams]);
    await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [created.users]);
  } catch (e) { console.error('Уборка не удалась:', e.message); }
  await pool.end();
  console.log(`\n${failed ? 'ЕСТЬ ОШИБКИ' : 'Всё в порядке'}: пройдено ${passed}, провалено ${failed}`);
  process.exitCode = failed ? 1 : 0;
}
