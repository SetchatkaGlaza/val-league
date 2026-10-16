import { $, gsap, motion } from '../js/ui.js';
import { bracket as bracketApi } from '../js/api.js';
import { ICON, esc } from './parts.js';
import { statusBadge, tournamentError, formatLine, dateLong } from './tournament-parts.js';
import { bracketHtml, jumpHtml, bindJump, champion, poll } from './bracket-parts.js';

const skeleton = '<div class="tm-skel" aria-busy="true"><div class="sk sk-hero"></div><div class="sk sk-card"></div></div>';

function page(d) {
  const t = d.tournament, champ = champion(d), has = d.rounds.length > 0;
  return `
  <section class="tm-hero bk-hero">
    <div class="tm-hero-t">
      <p class="label">${statusBadge(t)}</p>
      <h1>${esc(t.name)}</h1>
      <ul class="chips"><li>${dateLong(t.startsAt)}</li><li>${formatLine(t)}</li>${has ? `<li>Раундов: ${d.totalRounds}</li>` : ''}</ul>
    </div>
    ${champ ? `<div class="bk-champ"><p class="label">Победитель</p><b>${esc(champ.name)}</b></div>` : ''}
  </section>
  ${has && d.preliminary ? '<div class="banner" role="status">Сетка предварительная: до старта турнира организаторы могут её изменить, например при смене состава команд.</div>' : ''}
  ${has ? `${jumpHtml(d)}${bracketHtml(d)}<p class="bk-hint">Листайте сетку вправо, чтобы увидеть следующие раунды. Нажмите на матч, чтобы открыть его страницу.</p>`
    : `<div class="acc-empty big"><p>Сетка пока не сформирована.</p><span>${t.status === 'upcoming' ? 'Её составят после закрытия регистрации и оплаты участия.' : 'Для этого турнира сетка не создавалась.'}</span><a class="btn btn-ghost btn-sm" href="/tournaments/${esc(t.slug)}">К турниру</a></div>`}`;
}

export default {
  layout: 'doc',
  title: 'Турнирная сетка',
  description: 'Сетка плей-офф турнира VOLOGDA AMATEUR LEAGUE: пары, счёт и путь команд к финалу.',

  render: ({ params }) => `
    <main class="acc tm bk-page">
      <a href="/tournaments/${esc(params.slug)}" class="back">${ICON.back}К турниру</a>
      <div id="bBody">${skeleton}</div>
    </main>`,

  mount(root, { params }) {
    let alive = true, stopPoll = () => {}, stopJump = () => {}, sig = '';
    const body = $('#bBody', root);
    const state = (title, text, actions) => `<section class="stub tm-state"><h1>${title}</h1><p>${text}</p><div class="stub-actions">${actions}</div></section>`;

    function paint(d, keepScroll) {
      const left = keepScroll ? ($('.bk-scroll', body)?.scrollLeft || 0) : 0;
      body.innerHTML = page(d);
      const sc = $('.bk-scroll', body); if (sc && left) sc.scrollLeft = left;
      document.title = `Сетка — ${d.tournament.name} — VOLOGDA AMATEUR LEAGUE`;
    }

    async function load(silent = false) {
      if (!silent) body.innerHTML = skeleton;
      try {
        const d = await bracketApi.get(params.slug);
        if (!alive) return;
        const s = JSON.stringify(d);
        if (silent && s === sig) return;      // ничего не изменилось: не трогаем экран
        sig = s; paint(d, silent);
        if (motion && !silent) gsap.from(body.children, { y: 20, opacity: 0, duration: .55, stagger: .07, ease: 'power3.out', clearProps: 'transform,opacity' });
        stopPoll(); stopPoll = d.tournament.status === 'live' || d.preliminary ? poll(() => load(true), 30) : () => {};
      } catch (e) {
        if (!alive || silent) return;
        body.innerHTML = e.code === 'not_found'
          ? state('Турнир не найден', 'Возможно, он ещё не опубликован или ссылка устарела.', '<a href="/tournaments" class="btn btn-primary">Все турниры</a>')
          : state('Не удалось загрузить', esc(tournamentError(e, 'Попробуйте обновить страницу.')), '<button type="button" class="btn btn-primary" data-retry>Повторить</button>');
      }
    }
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(); });
    stopJump = bindJump(root);
    load();
    return () => { alive = false; stopPoll(); stopJump(); };
  },
};
