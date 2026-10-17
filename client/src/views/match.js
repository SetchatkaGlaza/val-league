import { $, gsap, motion } from '../js/ui.js';
import { matches as matchesApi } from '../js/api.js';
import { getUser } from '../js/session.js';
import { ICON, esc } from './parts.js';
import { teamLogo } from './team-parts.js';
import { MATCH, dateLong, mapName, tournamentError } from './tournament-parts.js';
import { playerLink } from './player-link.js';
import { matchBadge, copyText, poll, safeUrl, nickOf, forfeitLabel } from './bracket-parts.js';

const skeleton = '<div class="tm-skel" aria-busy="true"><div class="sk sk-hero"></div><div class="sk sk-card"></div></div>';

function teamBlock(m, s, mySide) {
  const t = m[s], state = m.winner === s ? ' win' : m.winner ? ' lose' : '';
  if (!t) return `<div class="mt-team${state}"><div class="tm-logo ph" aria-hidden="true">?</div><div class="mt-name"><b>Ожидается</b><span>Соперник определится по итогам предыдущего матча</span></div></div>`;
  const name = t.slug ? `<a class="plain" href="/teams/${esc(t.slug)}">${esc(t.name)}</a>` : esc(t.name);
  return `<div class="mt-team${state}">${teamLogo(t, 'lg')}<div class="mt-name"><b>${name}</b><span>${t.seed ? `Посев № ${t.seed}` : ''}${mySide === s ? `${t.seed ? ' · ' : ''}ваша команда` : ''}</span></div></div>`;
}

function rosterCard(m, s) {
  const t = m[s], list = (s === 'a' ? m.rosterA : m.rosterB) || [];
  if (!t) return '';
  return `<section class="acc-card"><h2>${esc(t.name)}</h2><p class="acc-sub">Состав на матч</p>${list.length
    ? `<ul class="chips">${list.map((p) => `<li>${playerLink(nickOf(p))}</li>`).join('')}</ul>` : '<p class="tm-empty">Состав не указан.</p>'}</section>`;
}

function lobbyCard(d) {
  const m = d.match;
  if (m.status === 'finished' || m.bye) return '';
  if (!d.viewer.side && getUser()?.role !== 'admin') return '';
  if (m.lobby) return `<section class="acc-card tm-wide"><h2>Подключение к матчу</h2><p class="acc-sub">Эти данные видят только участники матча и организаторы. После окончания матча они скрываются.</p><pre class="lobby">${esc(m.lobby)}</pre><div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" data-copy>Скопировать</button></div></section>`;
  return `<section class="acc-card tm-wide"><h2>Подключение к матчу</h2><div class="acc-empty"><p>Данные лобби пока не добавлены.</p><span>Организаторы укажут их перед матчем. Страница обновляется сама.</span></div></section>`;
}

/** Счёт по картам (BO3): карта, очки раундов, демо карты. */
function mapsCard(m) {
  if (!m.maps?.length || !m.a || !m.b) return '';
  const rows = m.maps.map((x, i) => {
    const demo = safeUrl(x.demoUrl);
    return `<li class="mp-row"><span class="mp-n">${i + 1}</span><span class="mp-map">${x.map ? esc(mapName(x.map)) : 'Карта не указана'}</span><b class="mp-s"><span class="${x.a > x.b ? 'w' : ''}">${x.a}</span><i>:</i><span class="${x.b > x.a ? 'w' : ''}">${x.b}</span></b>${demo ? `<a class="link mp-demo" href="${esc(demo)}" target="_blank" rel="noopener noreferrer">Демо</a>` : '<span class="mp-demo"></span>'}</li>`;
  }).join('');
  return `<section class="acc-card tm-wide"><h2>Карты</h2><p class="acc-sub">${esc(m.a.name)} — ${esc(m.b.name)}, очки по раундам.</p><ol class="mp-list">${rows}</ol></section>`;
}

function prevCard(d) {
  if (!d.previous.length) return '';
  const row = (p) => {
    if (!p.a || !p.b) return `<li class="mem"><span class="mem-t"><b>${esc((p.a || p.b)?.name || '—')}</b><span>Прошла дальше без игры</span></span></li>`;
    const w = (s) => (p.winner === s ? ' class="pw"' : '');
    return `<li class="mem"><a class="mem-link" href="/matches/${esc(p.id)}"><span class="mem-t"><b><span${w('a')}>${esc(p.a.name)}</span> — <span${w('b')}>${esc(p.b.name)}</span></b><span>${p.status === 'finished' ? `Счёт ${p.scoreA}:${p.scoreB}` : 'Матч ещё не сыгран'}</span></span></a></li>`;
  };
  return `<section class="acc-card"><h2>Путь к этому матчу</h2><p class="acc-sub">Предыдущие матчи, победители которых играют здесь.</p><ul class="mem-list">${d.previous.map(row).join('')}</ul></section>`;
}

function page(d) {
  const m = d.match, t = d.tournament, side = d.viewer.side, fin = m.status === 'finished' && !m.bye;
  const demo = safeUrl(m.demoUrl);
  const when = m.startsAt ? dateLong(m.startsAt) : 'Время назначат позже';
  return `
  <section class="tm-hero mt-hero">
    <div class="tm-hero-t">
      <p class="label">${esc(m.roundName)} ${matchBadge(m)}</p>
      <h1><a class="plain" href="/tournaments/${esc(t.slug)}">${esc(t.name)}</a></h1>
      <ul class="chips"><li>${MATCH[t.matchFormat]}</li><li>${fin ? 'Матч сыгран' : when}</li></ul>
    </div>
  </section>
  ${side ? `<div class="banner ok" role="status">Вы играете в этом матче: ${esc(m[side].name)}.</div>` : ''}
  <section class="mt-board" aria-label="Счёт матча">
    ${teamBlock(m, 'a', side)}
    <div class="mt-mid">${fin ? `<div class="mt-score"><b class="${m.winner === 'a' ? 'w' : ''}">${m.scoreA}</b><i>:</i><b class="${m.winner === 'b' ? 'w' : ''}">${m.scoreB}</b></div><small>${m.forfeit ? `${forfeitLabel(m)}: ${esc(m[m.forfeit]?.name || '')}` : t.matchFormat === 'bo3' ? 'по картам' : 'по раундам'}</small>` : '<span class="mt-vs">VS</span>'}</div>
    ${teamBlock(m, 'b', side)}
  </section>
  <div class="acc-grid t-grid2">
    ${lobbyCard(d)}
    ${fin ? mapsCard(m) : ''}
    ${rosterCard(m, 'a')}${rosterCard(m, 'b')}
    ${prevCard(d)}
    <section class="acc-card"><h2>Дальше</h2>
      ${m.nextId ? `<p class="acc-sub">Победитель выходит в следующий матч сетки.</p><div class="tg-actions"><a class="btn btn-ghost btn-sm" href="/matches/${esc(m.nextId)}">Следующий матч</a></div>`
        : '<p class="acc-sub">Это финал: победитель становится победителем турнира.</p>'}
      ${demo ? `<p class="mt-demo"><a class="link" href="${esc(demo)}" target="_blank" rel="noopener noreferrer">Демо матча</a></p>` : ''}
      <div class="tg-actions mt-links"><a class="btn btn-ghost btn-sm" href="/tournaments/${esc(t.slug)}/bracket">Вся сетка</a></div>
    </section>
  </div>`;
}

export default {
  layout: 'doc',
  title: 'Матч',
  description: 'Страница матча VOLOGDA AMATEUR LEAGUE: команды, счёт и подключение для участников.',

  render: () => `
    <main class="acc tm bk-page mt-page">
      <a href="/tournaments" class="back" id="mBack">${ICON.back}К турнирам</a>
      <div id="mBody">${skeleton}</div>
    </main>`,

  mount(root, { params }) {
    let alive = true, stopPoll = () => {}, sig = '', cur = null;
    const body = $('#mBody', root);
    const state = (title, text, actions) => `<section class="stub tm-state"><h1>${title}</h1><p>${text}</p><div class="stub-actions">${actions}</div></section>`;

    async function load(silent = false) {
      if (!silent) body.innerHTML = skeleton;
      try {
        const d = await matchesApi.get(params.id);
        if (!alive) return;
        const s = JSON.stringify(d);
        if (silent && s === sig) return;
        sig = s; cur = d;
        body.innerHTML = page(d);
        const back = $('#mBack', root);
        back.setAttribute('href', `/tournaments/${d.tournament.slug}/bracket`); back.lastChild.textContent = 'К сетке';
        document.title = `${d.match.a?.name || 'Матч'} — ${d.match.b?.name || 'ожидается'} — VOLOGDA AMATEUR LEAGUE`;
        if (motion && !silent) gsap.from(body.children, { y: 20, opacity: 0, duration: .55, stagger: .07, ease: 'power3.out', clearProps: 'transform,opacity' });
        stopPoll();
        // Пока матч не сыгран, обновляем страницу сами: лобби и время могут появиться в любой момент
        stopPoll = d.match.status !== 'finished' ? poll(() => load(true), 20) : () => {};
      } catch (e) {
        if (!alive || silent) return;
        body.innerHTML = e.code === 'not_found'
          ? state('Матч не найден', 'Возможно, сетку пересоздали или ссылка устарела.', '<a href="/tournaments" class="btn btn-primary">Все турниры</a>')
          : state('Не удалось загрузить', esc(tournamentError(e, 'Попробуйте обновить страницу.')), '<button type="button" class="btn btn-primary" data-retry>Повторить</button>');
      }
    }
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) load();
      const c = e.target.closest('[data-copy]');
      if (c && cur?.match.lobby) copyText(cur.match.lobby, c);
    });
    load();
    return () => { alive = false; stopPoll(); };
  },
};
