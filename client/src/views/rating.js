import { $, gsap, motion } from '../js/ui.js';
import { players } from '../js/api.js';
import { esc } from './parts.js';
import { plural } from './team-parts.js';
import { playerLink } from './player-link.js';

const PAGE = 20;

const row = (p) => `
  <li class="rt-row">
    <span class="rt-rank${p.rank <= 3 ? ` r${p.rank}` : ''}" aria-label="Место ${p.rank}">${p.rank}</span>
    <span class="rt-nick"><b>${playerLink(p.nick)}</b><small>${p.tournaments} ${plural(p.tournaments, 'турнир', 'турнира', 'турниров')}${p.titles ? ` · ${p.titles} ${plural(p.titles, 'победа', 'победы', 'побед')}` : ''}${p.matchWins + p.matchLosses ? ` · матчи ${p.matchWins}–${p.matchLosses}` : ''}</small></span>
    <b class="rt-pts" title="Очки рейтинга">${p.points}</b>
  </li>`;

/** Строка рейтинга (используется и на главной). */
export const ratingRow = row;

/** Как считаются очки: строка-подсказка из значений, которые прислал сервер. */
const rules = (pt) => `За участие в турнире ${pt.participation}, за 1 / 2 / 3 место ${pt.place[1]} / ${pt.place[2]} / ${pt.place[3]}, за каждую победу команды в матче сетки ${pt.matchWin}. Учитываются только завершённые турниры.`;

export default {
  layout: 'doc',
  title: 'Рейтинг игроков',
  description: 'Рейтинг игроков VOLOGDA AMATEUR LEAGUE по результатам завершённых турниров.',

  render: () => `
    <main class="acc tm rt-page">
      <a href="/" class="back">На главную</a>
      <section class="tm-hero"><div class="tm-hero-t"><h1>Рейтинг игроков</h1><p class="tm-desc" id="rtRules">Очки начисляются за результаты команды в завершённых турнирах.</p></div></section>
      <section class="acc-card tm-wide" id="rtCard" aria-busy="true"><p class="th-note">Загружаем рейтинг…</p></section>
    </main>`,

  mount(root) {
    let alive = true, offset = 0, total = 0;
    const card = $('#rtCard', root);

    const load = async (first) => {
      try {
        const d = await players.rating(PAGE, offset);
        if (!alive) return;
        total = d.total;
        $('#rtRules', root).textContent = rules(d.points);
        if (first) {
          card.removeAttribute('aria-busy');
          card.innerHTML = total
            ? '<ol class="rt-list" id="rtList"></ol><button type="button" class="btn btn-ghost" id="rtMore" hidden>Показать ещё</button>'
            : '<div class="acc-empty"><p>Рейтинг пока пуст.</p><span>Он появится после первого завершённого турнира.</span></div>';
          if (motion) gsap.from(card, { y: 20, opacity: 0, duration: .5, ease: 'power3.out', clearProps: 'transform,opacity' });
        }
        if (total) $('#rtList', root).insertAdjacentHTML('beforeend', d.players.map(row).join(''));
        offset += d.players.length;
        const more = $('#rtMore', root);
        if (more) { more.hidden = offset >= total; more.disabled = false; more.classList.remove('loading'); }
      } catch {
        if (!alive) return;
        if (first) card.innerHTML = '<p class="th-note">Не удалось загрузить рейтинг. <button type="button" class="btn btn-ghost btn-sm" data-act="retry">Повторить</button></p>';
        else { const more = $('#rtMore', root); if (more) { more.disabled = false; more.classList.remove('loading'); more.textContent = 'Не удалось. Повторить'; } }
      }
    };
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="retry"]')) { card.innerHTML = '<p class="th-note">Загружаем рейтинг…</p>'; load(true); return; }
      const more = e.target.closest('#rtMore');
      if (more && !more.disabled) { more.disabled = true; more.classList.add('loading'); more.textContent = 'Показать ещё'; load(false); }
    });
    load(true);
    return () => { alive = false; };
  },
};
