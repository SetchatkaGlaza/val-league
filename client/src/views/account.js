import { $, $$, gsap, motion } from '../js/ui.js';
import { account, auth, teams, invites, registrations as registrationsApi, matches as matchesApi, ApiError, serverFallback } from '../js/api.js';
import { getUser, patchUser, clearUser } from '../js/session.js';
import { ICON, esc } from './parts.js';
import { teamLogo, teamError, plural } from './team-parts.js';
import { regBadge, CANCEL_REASON } from './registration-parts.js';
import { dateShort, tournamentError } from './tournament-parts.js';
import { whenShort } from './bracket-parts.js';

const TG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M21.5 4.3 2.9 11.4c-1.3.5-1.3 1.3-.2 1.6l4.8 1.5 1.8 5.6c.2.6.1.8.7.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.2-.5-1.8-1.5-1.4ZM9 14l9.3-5.9c.4-.3.8-.1.5.2L11.2 15.2l-.3 3.2L9 14Z"/></svg>';
const empty = (text, hint) => `<div class="acc-empty"><p>${text}</p>${hint ? `<span>${hint}</span>` : ''}</div>`;

const row = (icon, name, status, action) =>
  `<div class="link-row"><div class="link-ic">${icon}</div><div class="link-t"><b>${name}</b>${status}</div>${action}</div>`;
const btn = (act, label) => `<button type="button" class="btn btn-ghost btn-sm" data-act="${act}">${label}</button>`;

function linkedHtml(u, tg) {
  const steam = u.steam
    ? row(ICON.steam, 'Steam', `<span class="ok">${esc(u.steam.name)}</span>`, '<span class="tag">Привязан</span>')
    : row(ICON.steam, 'Steam', '<span>Не привязан</span>', btn('steam', 'Привязать'));
  const tgRow = u.telegram
    ? row(TG, 'Telegram', `<span class="ok">@${esc(u.telegram.username)}</span>`, btn('tg-off', 'Отвязать'))
    : row(TG, 'Telegram', '<span>Не привязан</span>', tg ? '' : btn('tg-on', 'Привязать'));
  const panel = tg ? `
    <div class="tg-panel">
      <p>Откройте <b>${esc(tg.bot)}</b> в Telegram и отправьте боту:</p>
      <code>/start ${esc(tg.code)}</code>
      <div class="tg-actions"><button type="button" class="btn btn-primary btn-sm" data-act="tg-check"><span class="label">Я отправил(а)</span><span class="spinner" aria-hidden="true"></span></button>
      ${btn('tg-cancel', 'Отмена')}</div>
    </div>` : '';
  return `<h2>Привязанные аккаунты</h2><p class="acc-sub">Steam подтверждает игрока, Telegram присылает уведомления о матчах.</p>${steam}${tgRow}${panel}<p class="err" id="linkErr" role="alert"></p>`;
}

const teamsHtml = (list) => (list.length
  ? `<ul class="mem-list">${list.map((t) => `<li class="mem"><a class="mem-link" href="/teams/${esc(t.slug)}">${teamLogo(t, 'sm')}<span class="mem-t"><b>${esc(t.name)}</b><span>${t.isCaptain ? 'Капитан' : t.role === 'main' ? 'Основа' : 'Запас'} · ${t.members} ${plural(t.members, 'игрок', 'игрока', 'игроков')}</span></span></a></li>`).join('')}</ul>`
  : empty('Вы пока не состоите в командах.', 'Создайте свою или примите приглашение капитана.'))
  + '<div class="tg-actions tm-create"><a href="/teams/new" class="btn btn-primary btn-sm">Создать команду</a><a href="/teams" class="btn btn-ghost btn-sm">Найти команду</a></div>';

const invitesHtml = (list) => `<ul class="mem-list">${list.map((i) => `
  <li class="mem">${teamLogo(i, 'sm')}<div class="mem-t"><b>${esc(i.name)}</b><span>${i.invitedBy ? `Пригласил(а): ${esc(i.invitedBy)}` : 'Приглашение капитана'}</span></div>
  <div class="tg-actions"><button type="button" class="btn btn-primary btn-sm" data-tact="accept" data-id="${i.id}">Принять</button><button type="button" class="btn btn-ghost btn-sm" data-tact="decline" data-id="${i.id}">Отклонить</button></div></li>`).join('')}</ul>
  <p class="err" id="invErr" role="alert"></p>`;

/** Заявки игрока: живые сверху; снятые показываем с причиной, чтобы было понятно, что произошло. */
function regsHtml(list) {
  if (!list.length) return empty('Вы ещё не участвовали в турнирах.', 'Здесь появятся предстоящие и прошедшие турниры вашей команды.');
  return `<ul class="mem-list">${list.slice(0, 8).map((r) => `
    <li class="mem"><a class="mem-link" href="/tournaments/${esc(r.tournament.slug)}">
      <span class="mem-t"><b>${esc(r.tournament.name)}</b><span>${esc(r.team.name)} · ${dateShort(r.tournament.startsAt)}${r.status === 'cancelled' && r.cancelReason ? ` · ${CANCEL_REASON[r.cancelReason] || ''}` : ''}${r.refundDue ? ' · взнос вернут организаторы' : ''}</span></span>
      <span class="mem-r">${regBadge(r)}</span></a></li>`).join('')}</ul>${list.length > 8 ? `<p class="hint-mut">Показаны последние 8 заявок.</p>` : ''}`;
}

/** «Мои матчи»: ближайшие и идущие сверху, затем сыгранные. Соперник и итог показаны с точки зрения команды игрока. */
function myMatchesHtml(list) {
  if (!list.length) return empty('Матчей пока нет.', 'Когда ваша команда попадёт в сетку турнира, ближайшие игры и результаты появятся здесь.');
  const rows = list.slice(0, 8).map((m) => {
    const me = m.side, op = me === 'a' ? 'b' : 'a';
    const mine = m[me], other = m[op], myScore = me === 'a' ? m.scoreA : m.scoreB, opScore = me === 'a' ? m.scoreB : m.scoreA;
    const fin = m.status === 'finished';
    const badge = fin
      ? `<span class="st st-${m.winner === me ? 'open' : 'cancel'}">${m.winner === me ? 'Победа' : 'Поражение'} ${myScore}:${opScore}${m.forfeit ? ' (тех.)' : ''}</span>`
      : m.status === 'live' ? '<span class="st st-live">Идёт</span>'
        : m.status === 'ready' ? '<span class="st st-soon">Готов к игре</span>' : '<span class="st st-draft">Ждёт соперника</span>';
    const info = [`Раунд ${m.round}`, fin ? '' : m.startsAt ? whenShort(m.startsAt) : 'время назначат позже', !fin && m.hasLobby ? 'есть данные для подключения' : ''].filter(Boolean).join(' · ');
    return `<li class="mem"><a class="mem-link" href="/matches/${esc(m.id)}"><span class="mem-t"><b>${esc(mine.name)} — ${other ? esc(other.name) : 'соперник определится'}</b><span>${esc(m.tournament.name)} · ${info}</span></span><span class="mem-r">${badge}</span></a></li>`;
  }).join('');
  return `<ul class="mem-list">${rows}</ul>${list.length > 8 ? '<p class="hint-mut">Показаны ближайшие и последние 8 матчей.</p>' : ''}`;
}

export default {
  layout: 'doc',
  protected: true,
  title: 'Личный кабинет',
  description: 'Профиль, привязанные аккаунты, команды и турниры игрока VOLOGDA AMATEUR LEAGUE.',

  render: () => {
    const u = getUser();
    return `
    <main class="acc">
      <section class="acc-hero">
        <div class="acc-avatar" aria-hidden="true">${esc(u.nick.slice(0, 1).toUpperCase())}</div>
        <div class="acc-id"><h1>${esc(u.nick)}</h1><p>${esc(u.email || '')}</p></div>
        ${u.role === 'admin' ? '<a href="/admin" class="btn btn-ghost btn-sm">Админка</a>' : ''}
        <a href="/settings" class="btn btn-ghost btn-sm">Настройки</a>
        <button type="button" class="btn btn-ghost btn-sm" id="logoutBtn">Выйти</button>
      </section>
      <div class="banner" id="accNote" role="status" ${u.steam ? 'hidden' : ''}>Привяжите Steam, чтобы участвовать в турнирах: так мы подтверждаем игрока.</div>
      <div class="acc-grid">
        <section class="acc-card" id="linked">${linkedHtml(u)}</section>
        <section class="acc-card" id="teamsCard"><h2>Мои команды</h2><div id="teamsBody"><p class="acc-sub">Загружаем…</p></div></section>
        <section class="acc-card" id="invCard" hidden><h2>Приглашения в команды</h2><div id="invBody"></div></section>
        <section class="acc-card" id="regCard"><h2>Мои турниры</h2><div id="regBody"><p class="acc-sub">Загружаем…</p></div></section>
        <section class="acc-card acc-wide" id="matchCard"><h2>Мои матчи</h2><div id="matchBody"><p class="acc-sub">Загружаем…</p></div></section>
      </div>
    </main>`;
  },

  mount(root, { navigate, query }) {
    let alive = true, tg = null;
    const card = $('#linked', root), note = $('#accNote', root);
    const draw = () => { card.innerHTML = linkedHtml(getUser(), tg); note.hidden = !!getUser().steam && !query.get('error'); };
    const busy = (btn, v) => { btn.disabled = v; btn.classList.toggle('loading', v); };
    // Сервер возвращает сюда, пока вход через Steam не готов (этап 9)
    if (query.get('error') === 'steam_soon') note.textContent = 'Привязка Steam появится на этапе входа через Steam. Пока она недоступна — это не ошибка аккаунта.';
    const fail = (e, el) => { const m = serverFallback(e instanceof ApiError ? e : new ApiError(0, 'network', ''), 'Не удалось выполнить. Попробуйте ещё раз.'); if (el) el.textContent = m; };

    /* Заявки на турниры: тоже отдельным запросом */
    const loadRegs = async () => {
      try {
        const r = await registrationsApi.mine();
        if (alive) $('#regBody', root).innerHTML = regsHtml(r.registrations);
      } catch (e) {
        if (alive) $('#regBody', root).innerHTML = `<div class="acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить турниры.'))}</p></div>`;
      }
    };

    /* Матчи: тоже отдельным запросом */
    const loadMatches = async () => {
      try {
        const r = await matchesApi.mine();
        if (alive) $('#matchBody', root).innerHTML = myMatchesHtml(r.matches);
      } catch (e) {
        if (alive) $('#matchBody', root).innerHTML = `<div class="acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить матчи.'))}</p></div>`;
      }
    };

    /* Команды и приглашения: грузим отдельно, чтобы кабинет открывался мгновенно */
    const loadTeams = async () => {
      try {
        const r = await teams.mine();
        if (!alive) return;
        $('#teamsBody', root).innerHTML = teamsHtml(r.teams);
        $('#invCard', root).hidden = !r.invites.length;
        $('#invBody', root).innerHTML = r.invites.length ? invitesHtml(r.invites) : '';
      } catch (e) {
        if (alive) $('#teamsBody', root).innerHTML = `<div class="acc-empty"><p>${esc(teamError(e, 'Не удалось загрузить команды.'))}</p></div>`;
      }
    };
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tact]'); if (!b || b.disabled) return;
      b.disabled = true; b.classList.add('loading');
      try {
        if (b.dataset.tact === 'accept') { const r = await invites.accept({ id: b.dataset.id }); if (alive) navigate(`/teams/${r.slug}`); return; }
        await invites.decline(b.dataset.id);
        if (alive) await loadTeams();
      } catch (err) {
        if (!alive) return;
        b.disabled = false; b.classList.remove('loading');
        // Приглашение могло устареть или состав заполнился: обновляем список, затем объясняем причину.
        if (['invite_invalid', 'team_full', 'already_member'].includes(err.code)) await loadTeams();
        const el = $('#invErr', root); if (el && alive) el.textContent = teamError(err);
      }
    });
    loadTeams(); loadRegs(); loadMatches();

    if (motion) gsap.from($$('.acc-hero, .acc-card', root), { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act], #logoutBtn'); if (!btn || btn.disabled) return;
      const act = btn.dataset.act || 'logout';
      try {
        if (act === 'logout') { busy(btn, true); await account.logout().catch(() => {}); clearUser(); navigate('/'); return; }
        if (act === 'steam') { busy(btn, true); const r = await account.steamLink(); if (alive && r) { patchUser({ steam: r.steam }); draw(); } }
        if (act === 'tg-on') { busy(btn, true); tg = await account.telegramCode(); if (alive) draw(); }
        if (act === 'tg-cancel') { tg = null; draw(); }
        if (act === 'tg-check') { busy(btn, true); const r = await account.telegramCheck(); if (alive) { patchUser({ telegram: r.telegram }); tg = null; draw(); } }
        if (act === 'tg-off') { busy(btn, true); await account.telegramUnlink(); if (alive) { patchUser({ telegram: null }); draw(); } }
      } catch (err) { if (alive) { busy(btn, false); fail(err, $('#linkErr', root)); } }
    });
    return () => { alive = false; };
  },
};
