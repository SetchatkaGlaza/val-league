import { $, $$, gsap, motion } from '../js/ui.js';
import { tournaments } from '../js/api.js';
import { ICON, esc } from './parts.js';
import { teamLogo } from './team-parts.js';
import { mountRegistration } from './registration-parts.js';
import { rub, dateLong, formatLine, feeLine, statusBadge, slotsLine, startCountdown, countdownHtml, tournamentError, mapName } from './tournament-parts.js';

const skeleton = '<div class="tm-skel" aria-busy="true"><div class="sk sk-hero"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>';
const PLACE = ['🥇', '🥈', '🥉'];

function prizes(t) {
  if (!t.prizePlaces.length) return '<p class="tm-empty">Призовые места пока не объявлены.</p>';
  return `<ol class="prize-list">${t.prizePlaces.map((p) => `<li><span class="pl">${p.place} место</span><b>${rub(p.amount)}</b></li>`).join('')}</ol>`;
}

/** Статичный текст для турниров, где регистрация уже невозможна. Для upcoming блок рисует mountRegistration. */
function staticAction(t) {
  if (t.status === 'cancelled') return '<p class="t-note bad">Турнир отменён организаторами.</p>';
  if (t.status === 'finished') return '<p class="t-note">Турнир завершён.</p>';
  if (t.status === 'live') return '<p class="t-note">Турнир идёт. Регистрация закрыта.</p>';
  return '';
}

function teamsBlock(t, teams) {
  const pending = t.teamsCount - t.paidCount;
  const extra = [pending > 0 ? `Ждут оплаты: ${pending}` : '', t.waitlistCount > 0 ? `В листе ожидания: ${t.waitlistCount}` : ''].filter(Boolean).join(' · ');
  if (!teams.length) return `<div class="acc-empty"><p>Подтверждённых команд пока нет.</p><span>${extra || 'Здесь появятся команды, которые оплатили участие.'}</span></div>`;
  return `<ul class="mem-list">${teams.map((x) => `<li class="mem">${x.slug
    ? `<a class="mem-link" href="/teams/${esc(x.slug)}">${teamLogo(x, 'sm')}<span class="mem-t"><b>${esc(x.name)}</b></span></a>`
    : `<span class="mem-link">${teamLogo(x, 'sm')}<span class="mem-t"><b>${esc(x.name)}</b></span></span>`}</li>`).join('')}</ul>${extra ? `<p class="hint-mut">${extra}</p>` : ''}`;
}

function page(d) {
  const t = d.tournament, s = slotsLine(t), upcoming = t.status === 'upcoming';
  return `
  <section class="tm-hero t-hero">
    <div class="tm-hero-t">
      <p class="label">${statusBadge(t)}</p>
      <h1>${esc(t.name)}</h1>
      <ul class="chips"><li>${dateLong(t.startsAt)}</li><li>${formatLine(t)}</li><li>${feeLine(t)}</li></ul>
      <div class="slots"><div class="slots-bar"><i style="width:${s.pct}%"></i></div><span>${s.text} · ${s.left}</span></div>
    </div>
    ${upcoming ? `<div class="t-timer"><p class="label">До старта</p>${countdownHtml(t.startsAt)}</div>` : ''}
  </section>
  ${t.winner ? `<section class="acc-card t-winner"><p class="label">Победитель</p><h2>${esc(t.winner.name)}</h2>${t.winner.roster.length ? `<p class="win-roster">${t.winner.roster.map(esc).join(' · ')}</p>` : ''}${t.prizePlaces[0] ? `<p class="win-prize">Приз: ${rub(t.prizePlaces[0].amount)}</p>` : ''}</section>` : ''}
  <div class="acc-grid t-grid2">
    <section class="acc-card"><h2>Призовой фонд</h2><p class="prize">${t.prizeTotal ? rub(t.prizeTotal) : '—'}</p>${prizes(t)}</section>
    <section class="acc-card"><h2>Участие</h2><div id="regBox">${staticAction(t)}</div></section>
    <section class="acc-card"><h2>Пул карт</h2>${t.mapPool.length ? `<ul class="chips maps">${t.mapPool.map((m) => `<li>${esc(mapName(m))}</li>`).join('')}</ul>` : '<p class="tm-empty">Пул карт объявят позже.</p>'}</section>
    <section class="acc-card"><h2>Формат</h2>
      <dl class="facts"><div><dt>Игра</dt><dd>Counter-Strike 2</dd></div><div><dt>Состав</dt><dd>${t.teamSize} на ${t.teamSize}</dd></div><div><dt>Сетка</dt><dd>Single Elimination</dd></div><div><dt>Матч</dt><dd>${t.matchFormat === 'bo3' ? 'BO3 (до двух побед)' : 'BO1 (одна карта)'}</dd></div></dl>
      <p class="hint-mut">Полные правила — в <a href="/rules" data-doc="rules" class="link">регламенте</a>.</p></section>
    ${t.description ? `<section class="acc-card tm-wide"><h2>Описание</h2><p class="tm-desc">${esc(t.description)}</p></section>` : ''}
    <section class="acc-card tm-wide"><h2>Команды <span class="tm-count">${t.paidCount} подтверждено · мест занято ${t.teamsCount} из ${t.maxTeams}</span></h2>${teamsBlock(t, d.teams)}</section>
  </div>`;
}

export default {
  layout: 'doc',
  title: 'Турнир',
  description: 'Страница турнира VOLOGDA AMATEUR LEAGUE: дата, формат, призовые, пул карт и список команд.',

  render: () => `
    <main class="acc tm t-detail">
      <a href="/tournaments" class="back">${ICON.back}Все турниры</a>
      <div id="tBody">${skeleton}</div>
    </main>`,

  mount(root, { params }) {
    let alive = true, stopCd = () => {}, stopReg = () => {};
    const body = $('#tBody', root);
    const state = (title, text, actions) => `<section class="stub tm-state"><h1>${title}</h1><p>${text}</p><div class="stub-actions">${actions}</div></section>`;

    /** silent: после действий с заявкой перерисовываем страницу без скелетона, чтобы не прыгал экран. */
    async function load(silent = false) {
      if (!silent) body.innerHTML = skeleton;
      try {
        const d = await tournaments.get(params.slug);
        if (!alive) return;
        stopCd(); stopReg();
        body.innerHTML = page(d);
        if (d.tournament.status === 'upcoming') stopReg = mountRegistration($('#regBox', body), d.tournament, { onChange: () => load(true) });
        document.title = `${d.tournament.name} — VOLOGDA AMATEUR LEAGUE`;
        // Когда таймер дошёл до нуля, перезагружаем данные: статус мог измениться
        stopCd = startCountdown(body, d.tournament.startsAt, () => setTimeout(() => alive && load(true), 4000));
        if (motion && !silent) gsap.from($$('.tm-hero, .acc-card', body), { y: 22, opacity: 0, duration: .6, stagger: .07, ease: 'power3.out', clearProps: 'transform,opacity' });
      } catch (e) {
        if (!alive) return;
        if (silent) return;   // при тихом обновлении оставляем прежнюю страницу
        body.innerHTML = e.code === 'not_found'
          ? state('Турнир не найден', 'Возможно, он ещё не опубликован или ссылка устарела.', '<a href="/tournaments" class="btn btn-primary">Все турниры</a>')
          : state('Не удалось загрузить', esc(tournamentError(e, 'Попробуйте обновить страницу.')), '<button type="button" class="btn btn-primary" data-retry>Повторить</button>');
      }
    }
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(); });
    load();
    return () => { alive = false; stopCd(); stopReg(); };
  },
};
