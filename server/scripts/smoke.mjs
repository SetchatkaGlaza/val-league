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
    if (res.status === 429) throw new Error('Сработал лимит запросов. Для автопроверки добавьте в server/.env строки WRITE_LIMIT=1000 и API_LIMIT=1000, перезапустите сервер и повторите (после проверки строки можно убрать).');
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
  check('начать турнир без сетки нельзя', (await adm.api('POST', `/admin/tournaments/${tid}/status`, { status: 'live' })).data.code === 'bracket_required');
  await pool.query(`UPDATE tournaments SET status = 'live' WHERE id = $1`, [tid]);   // дальше проверяем правила редактирования идущего турнира; сетка — в разделе «Сетка и матчи»
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

  const after = (await adm.api('GET', `/admin/tournaments/${rid}/registrations`)).data.registrations;
  check('отмена турнира снимает неоплаченные заявки', (await adm.api('POST', `/admin/tournaments/${rid}/status`, { status: 'cancelled' })).status === 200
    && (await adm.api('GET', `/admin/tournaments/${rid}/registrations`)).data.registrations.find((r) => r.id === r2id)?.cancelReason === 'tournament_cancelled', after);
  check('турнир с невозвращённым взносом не удаляется', (await adm.api('DELETE', `/admin/tournaments/${rid}`)).data.code === 'has_payments');
  check('взнос отмечен возвращённым', (await adm.api('POST', `/admin/registrations/${r1id}/refunded`)).status === 200);
  check('теперь турнир удаляется', (await adm.api('DELETE', `/admin/tournaments/${rid}`)).status === 200);

  console.log('Сетка и матчи');
  const anon = client();
  const bt = await adm.api('POST', '/admin/tournaments', { name: `Smoke Bracket ${run}`, startsAt: new Date(Date.now() + 7 * 864e5).toISOString(), maxTeams: 2, fee: 0, teamSize: 2, matchFormat: 'bo3' });
  const bid = bt.data.tournament.id, bslug = bt.data.tournament.slug; created.tournaments.push(bid);
  await adm.api('POST', `/admin/tournaments/${bid}/status`, { status: 'upcoming' });
  const breg = (api, team, roster) => api('POST', `/tournaments/${bslug}/registrations`, { teamSlug: team, roster, acceptRules: true });
  const b1 = await breg(pl.api, slug, [pl.id, cap.id]);
  check('бесплатная заявка сразу подтверждена', b1.status === 201 && b1.data.registration.status === 'paid', b1.data);
  check('сетка без команд пустая и предварительная', await anon('GET', `/tournaments/${bslug}/bracket`).then((r) => r.status === 200 && r.data.rounds.length === 0 && r.data.preliminary === true));
  check('одну команду в сетку не поставить', (await adm.api('POST', `/admin/tournaments/${bid}/bracket`, {})).data.code === 'not_enough_teams');
  const b2 = await breg(adm.api, slug2, [adm.id, x.id]);
  check('вторая команда подтверждена', b2.status === 201 && b2.data.registration.status === 'paid', b2.data);
  check('игрок не формирует сетку', (await pl.api('POST', `/admin/tournaments/${bid}/bracket`, {})).status === 403);
  check('ручной порядок проверяется', (await adm.api('POST', `/admin/tournaments/${bid}/bracket`, { seeding: 'manual', order: [b1.data.registration.id] })).status === 400);
  const g = await adm.api('POST', `/admin/tournaments/${bid}/bracket`, { seeding: 'manual', order: [b2.data.registration.id, b1.data.registration.id] });
  const fm = g.data.rounds?.[0]?.matches?.[0];
  check('сетка из двух команд: один финал, сид №1 — вторая команда', g.status === 201 && g.data.totalRounds === 1 && fm?.status === 'ready' && fm.a?.seed === 1 && fm.a?.name === `Smk2 ${run}` && g.data.rounds[0].name === 'Финал', g.data);
  const mid = fm.id;

  // Любое изменение состава оплаченных команд делает готовую сетку недействительной
  check('снятие оплаченной команды сбрасывает сетку', (await adm.api('POST', `/admin/registrations/${b2.data.registration.id}/cancel`, {})).status === 200
    && (await adm.api('GET', `/admin/tournaments/${bid}/bracket`)).data.rounds.length === 0);
  const b2b = await breg(adm.api, slug2, [adm.id, x.id]);
  check('команда регистрируется заново', b2b.status === 201 && b2b.data.registration.status === 'paid', b2b.data);
  const g2 = await adm.api('POST', `/admin/tournaments/${bid}/bracket`, { seeding: 'random' });
  check('сетка формируется заново (жеребьёвка)', g2.status === 201 && g2.data.rounds[0].matches.length === 1, g2.data);
  const mid2 = g2.data.rounds[0].matches[0].id;
  check('результат до старта турнира не вводится', (await adm.api('PUT', `/admin/matches/${mid2}/result`, { scoreA: 2, scoreB: 0 })).data.code === 'bad_state');

  check('игрок не вводит результат', (await pl.api('PUT', `/admin/matches/${mid2}/result`, { scoreA: 2, scoreB: 0 })).status === 403);
  check('расписание и лобби сохраняются', (await adm.api('PATCH', `/admin/matches/${mid2}`, { startsAt: new Date(Date.now() + 8 * 864e5).toISOString(), lobby: 'connect 10.0.0.1:27015' })).status === 200);
  check('турнир начинается при готовой сетке', (await adm.api('POST', `/admin/tournaments/${bid}/status`, { status: 'live' })).status === 200);
  check('в идущем турнире оплаченную команду не снять', (await adm.api('POST', `/admin/registrations/${b2b.data.registration.id}/cancel`, {})).data.code === 'tournament_live');

  const mp = await pl.api('GET', `/matches/${mid2}`);
  check('участник видит лобби', mp.status === 200 && mp.data.match.lobby === 'connect 10.0.0.1:27015' && mp.data.viewer.side !== null && mp.data.match.rosterA.length === 2, mp.data);
  const ma = await anon('GET', `/matches/${mid2}`);
  check('посторонний лобби не видит', ma.status === 200 && ma.data.match.lobby === undefined && ma.data.match.hasLobby === true, ma.data);
  check('«Мои матчи»', (await pl.api('GET', '/matches/mine')).data.matches?.some((m) => m.id === mid2 && m.status === 'ready'));
  check('матч можно отметить идущим', (await adm.api('PATCH', `/admin/matches/${mid2}`, { status: 'live' })).data.match?.status === 'live');

  check('ничья в BO3 недопустима', (await adm.api('PUT', `/admin/matches/${mid2}/result`, { scoreA: 2, scoreB: 2 })).data.code === 'tie');
  check('счёт BO3 проверяется', (await adm.api('PUT', `/admin/matches/${mid2}/result`, { scoreA: 3, scoreB: 0 })).data.code === 'bad_score');
  const rf = await adm.api('PUT', `/admin/matches/${mid2}/result`, { scoreA: 2, scoreB: 1 });
  const winName = g2.data.rounds[0].matches[0].a.name;
  check('финал завершает турнир и записывает победителя', rf.status === 200 && rf.data.match.winner === 'a' && rf.data.tournament.status === 'finished' && rf.data.tournament.winner === winName, rf.data);
  check('результат финала можно исправить, победитель меняется', (await adm.api('PUT', `/admin/matches/${mid2}/result`, { scoreA: 0, scoreB: 2 })).data.tournament?.winner === g2.data.rounds[0].matches[0].b.name);
  check('победитель сетки на главной', (await anon('GET', '/winners?limit=20')).data.winners?.some((w) => w.slug === bslug));
  // Итоги: после исправления результата победитель — вторая сторона финала; двое в сетке — призёров 3 места нет
  const bm = g2.data.rounds[0].matches[0];
  const pub = await anon('GET', `/tournaments/${bslug}`);
  check('страница турнира содержит призёров', pub.data.tournament.podium?.first?.name === bm.b.name && pub.data.tournament.podium?.second?.name === bm.a.name && pub.data.tournament.podium?.thirds?.length === 0, pub.data.tournament?.podium);
  const arch = await anon('GET', '/winners?limit=50');
  check('архив победителей: итоги и ссылка на сетку', arch.data.winners?.some((w) => w.slug === bslug && w.hasBracket === true && w.podium?.first?.name === bm.b.name) && arch.data.total >= 1, arch.data);
  check('вкладка «Прошедшие» содержит призёров', (await anon('GET', '/tournaments?tab=past')).data.tournaments?.some((t) => t.slug === bslug && t.podium?.first?.name === bm.b.name));
  // История команды (этап 6.2): победитель финала — 1 место, финалист — 2 место; несуществующая команда — 404
  const slugOf = async (name) => (await anon('GET', `/teams?q=${encodeURIComponent(name)}`)).data.teams?.find((x) => x.name === name)?.slug;
  const winSlug = await slugOf(bm.b.name), lossSlug = await slugOf(bm.a.name);
  const hw = winSlug ? await anon('GET', `/teams/${winSlug}/history`) : null;
  const hl = lossSlug ? await anon('GET', `/teams/${lossSlug}/history`) : null;
  const inHist = (r) => r?.data?.history?.find((x) => x.tournament.slug === bslug);
  check('история победителя: 1 место, победа в сетке, титул в статистике', inHist(hw)?.place === 1 && inHist(hw)?.record?.wins >= 1 && hw.data.stats.titles >= 1, hw?.data);
  check('история финалиста: 2 место', inHist(hl)?.place === 2, hl?.data);
  check('история несуществующей команды: 404', (await anon('GET', '/teams/no-such-team-xyz/history')).status === 404);
  // Профиль игрока (этап 6.3): игрок из состава победителя финала видит титул; неизвестный ник — 404
  const wReg = (await anon('GET', `/tournaments/${bslug}`)).data.tournament.podium?.first?.roster?.[0];
  const pp = wReg ? await anon('GET', `/players/${encodeURIComponent(wReg)}`) : null;
  const pEntry = pp?.data?.history?.find((x) => x.tournament.slug === bslug);
  check('профиль игрока: 1 место и титул в статистике', pEntry?.place === 1 && pp.data.stats.titles >= 1, pp?.data);
  check('профиль игрока: место и очки в рейтинге', pp?.data?.rating?.rank >= 1 && pp.data.rating.points > 0, pp?.data?.rating);
  check('профиль игрока: ник без учёта регистра', wReg && (await anon('GET', `/players/${encodeURIComponent(wReg.toUpperCase())}`)).status === 200);
  // Рейтинг игроков (этап 7.1): игрок из состава победителя есть в списке и имеет очки
  const rt = await anon('GET', '/players?limit=50');
  const rrow = rt.data.players?.find((x) => x.nick.toLowerCase() === String(wReg).toLowerCase());
  check('рейтинг: игрок победителя есть в списке с очками и местом', rt.status === 200 && rrow?.points > 0 && rrow.rank >= 1 && rt.data.total >= 1, rt.data);
  check('профиль несуществующего игрока: 404', (await anon('GET', '/players/no_such_player_xyz')).status === 404);
  check('после финала лобби скрыто', (await pl.api('GET', `/matches/${mid2}`)).data.match.lobby === undefined);

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
