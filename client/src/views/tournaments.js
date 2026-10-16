import { $, $$, gsap, motion } from '../js/ui.js';
import { tournaments } from '../js/api.js';
import { esc } from './parts.js';
import { tournamentCard, tournamentError, skeletonCards } from './tournament-parts.js';

const TABS = [['upcoming', 'Предстоящие'], ['live', 'Идут сейчас'], ['past', 'Прошедшие']];
const EMPTY = {
  upcoming: ['Пока нет анонсированных турниров.', 'Загляните позже: новые турниры появляются здесь.'],
  live: ['Сейчас турниры не идут.', 'Ближайшие — на вкладке «Предстоящие».'],
  past: ['Прошедших турниров пока нет.', 'Здесь будет архив с результатами.'],
};

export default {
  layout: 'doc',
  title: 'Турниры',
  description: 'Турниры VOLOGDA AMATEUR LEAGUE по CS2: предстоящие, идущие сейчас и прошедшие. Формат, взнос, призовой фонд и список команд.',

  render: () => `
    <main class="acc t-page">
      <div class="page-head"><h1 class="set-title">Турниры</h1><p class="acc-sub">Онлайн-турниры по CS2 для любителей Вологды.</p></div>
      <div class="tabs" role="tablist" aria-label="Разделы турниров">
        ${TABS.map(([k, l]) => `<button type="button" role="tab" class="tab" id="tab-${k}" data-tab="${k}" aria-selected="false" aria-controls="tList" tabindex="-1">${l}<i class="tab-n" data-n="${k}" hidden></i></button>`).join('')}
      </div>
      <section id="tList" role="tabpanel" aria-live="polite">${skeletonCards()}</section>
    </main>`,

  mount(root, { query }) {
    let alive = true, tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'upcoming', seq = 0;
    const list = $('#tList', root);

    const mark = () => $$('.tab', root).forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    const counts = (c) => $$('.tab-n', root).forEach((i) => { i.textContent = c[i.dataset.n]; i.hidden = !c[i.dataset.n]; });

    async function load(first = false) {
      const my = ++seq;
      mark();
      list.setAttribute('aria-labelledby', `tab-${tab}`);
      list.innerHTML = skeletonCards();
      try {
        const r = await tournaments.list(tab);
        if (!alive || my !== seq) return;
        counts(r.counts);
        // Если на «Предстоящих» пусто, а турнир уже идёт, сразу показываем «Идут сейчас» (только при первом открытии).
        if (first && !r.tournaments.length && !query.get('tab') && r.counts.live) { tab = 'live'; return load(); }
        list.innerHTML = r.tournaments.length
          ? `<div class="t-grid">${r.tournaments.map(tournamentCard).join('')}</div>`
          : `<div class="acc-empty big"><p>${EMPTY[tab][0]}</p><span>${EMPTY[tab][1]}</span></div>`;
        if (motion) gsap.from($$('.t-card', list), { y: 18, opacity: 0, duration: .5, stagger: .06, ease: 'power3.out', clearProps: 'transform,opacity' });
      } catch (e) {
        if (!alive || my !== seq) return;
        list.innerHTML = `<div class="acc-empty big"><p>${esc(tournamentError(e, 'Не удалось загрузить турниры.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`;
      }
    }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b && b.dataset.tab !== tab) { tab = b.dataset.tab; load(); }
      if (e.target.closest('[data-retry]')) load();
    });
    // Стрелки ← → переключают вкладки (как в стандартных табах)
    root.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !e.target.closest('.tab')) return;
      const i = TABS.findIndex(([k]) => k === tab), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      tab = n; load(); $(`#tab-${n}`, root).focus();
    });

    if (motion) gsap.from($$('.page-head, .tabs', root), { y: 18, opacity: 0, duration: .5, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
    load(true);
    return () => { alive = false; };
  },
};
