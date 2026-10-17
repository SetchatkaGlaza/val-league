import { $, $$, gsap, motion } from '../js/ui.js';
import { tournaments } from '../js/api.js';
import { esc } from './parts.js';
import { rub, dateShort, tournamentError } from './tournament-parts.js';
import { podiumBlock } from './podium-parts.js';

const PAGE = 8;
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

function card(w) {
  const chips = [`${w.teamSize}x${w.teamSize} · ${w.matchFormat === 'bo3' ? 'BO3' : 'BO1'}`, `${w.teamsCount} ${plural(w.teamsCount, 'команда', 'команды', 'команд')}`, w.prizeTotal ? `Призовой фонд ${rub(w.prizeTotal)}` : ''].filter(Boolean);
  const podium = podiumBlock(w.podium, w.prizeTotal ? [{ amount: w.prize }] : []);
  return `
  <article class="arch-card">
    <header class="arch-h">
      <div><p class="label">${dateShort(w.date)}</p><h2><a class="plain" href="/tournaments/${esc(w.slug)}">${esc(w.tournament)}</a></h2></div>
      <ul class="chips">${chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    </header>
    ${podium || `<p class="pd-single">Победитель: <b>${esc(w.team)}</b></p>`}
    <div class="t-actions"><a href="/tournaments/${esc(w.slug)}" class="btn btn-ghost btn-sm">Итоги турнира</a>${w.hasBracket ? `<a href="/tournaments/${esc(w.slug)}/bracket" class="btn btn-ghost btn-sm">Сетка</a>` : ''}</div>
  </article>`;
}

export default {
  layout: 'doc',
  title: 'Победители',
  description: 'Архив победителей VOLOGDA AMATEUR LEAGUE: итоги прошедших турниров по CS2, призёры и турнирные сетки.',

  render: () => `
    <main class="acc t-page">
      <div class="page-head"><h1 class="set-title">Архив победителей</h1><p class="acc-sub">Итоги прошедших турниров: победители, призёры и сетки.</p></div>
      <div id="archList" aria-live="polite" aria-busy="true"><div class="sk sk-card"></div></div>
      <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" id="archMore" hidden>Показать ещё</button></div>
    </main>`,

  mount(root) {
    let alive = true, offset = 0, seq = 0;
    const list = $('#archList', root), more = $('#archMore', root);

    async function load(reset) {
      const my = ++seq;
      if (reset) { offset = 0; list.innerHTML = '<div class="sk sk-card"></div>'; }
      more.disabled = true;
      try {
        const r = await tournaments.winners(PAGE, offset);
        if (!alive || my !== seq) return;
        list.removeAttribute('aria-busy');
        if (reset) list.innerHTML = '';
        if (!r.total) {
          list.innerHTML = '<div class="acc-empty big"><p>Завершённых турниров пока нет.</p><span>Здесь появятся победители и призёры, как только пройдёт первый турнир.</span><a href="/tournaments" class="btn btn-primary btn-sm">Предстоящие турниры</a></div>';
          more.hidden = true; return;
        }
        const before = $$('.arch-card', list).length;
        list.insertAdjacentHTML('beforeend', r.winners.map(card).join(''));
        offset += r.winners.length;
        more.hidden = offset >= r.total; more.disabled = false;
        if (motion) gsap.from($$('.arch-card', list).slice(before), { y: 18, opacity: 0, duration: .5, stagger: .06, ease: 'power3.out', clearProps: 'transform,opacity' });
      } catch (e) {
        if (!alive || my !== seq) return;
        list.removeAttribute('aria-busy'); more.disabled = false;
        const msg = `<div class="acc-empty big"><p>${esc(tournamentError(e, 'Не удалось загрузить архив.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`;
        if (reset) list.innerHTML = msg; else list.insertAdjacentHTML('beforeend', msg);
      }
    }

    more.addEventListener('click', () => load(false));
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-retry]'); if (b) { b.closest('.acc-empty').remove(); load(offset === 0); } });
    if (motion) gsap.from($('.page-head', root), { y: 18, opacity: 0, duration: .5, ease: 'power3.out', clearProps: 'transform,opacity' });
    load(true);
    return () => { alive = false; };
  },
};
