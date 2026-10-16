import { $, $$, gsap, motion } from '../js/ui.js';
import { teamsDirectory } from '../js/api.js';
import { getUser } from '../js/session.js';
import { esc } from './parts.js';
import { teamLogo, teamError, plural } from './team-parts.js';

const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const card = (t) => `
  <li><a class="team-card" href="/teams/${esc(t.slug)}">${teamLogo(t, 'lg')}
    <span class="mem-t"><b>${esc(t.name)}</b><span>${t.captain ? `Капитан: ${esc(t.captain)} · ` : ''}${t.members} ${plural(t.members, 'игрок', 'игрока', 'игроков')}</span></span></a></li>`;

export default {
  layout: 'doc',
  title: 'Команды',
  description: 'Команды VOLOGDA AMATEUR LEAGUE: найдите команду по названию, посмотрите состав и создайте свою.',

  render: () => `
    <main class="acc t-page">
      <div class="page-head"><h1 class="set-title">Команды</h1><p class="acc-sub">Найдите команду или создайте свою.</p></div>
      <div class="toolbar">
        <div class="field"><label class="sr-only" for="q">Поиск по названию</label><div class="control">${SEARCH}<input id="q" type="search" maxlength="40" placeholder="Поиск по названию" autocomplete="off" spellcheck="false" /></div></div>
        <a href="${getUser() ? '/teams/new' : '/login?next=/teams/new'}" class="btn btn-primary btn-sm">Создать команду</a>
      </div>
      <p class="hint-mut" id="found" role="status"></p>
      <ul class="team-grid" id="tg" aria-busy="true"></ul>
      <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" id="more" hidden>Показать ещё</button></div>
    </main>`,

  mount(root) {
    let alive = true, q = '', offset = 0, seq = 0, timer = 0;
    const grid = $('#tg', root), more = $('#more', root), found = $('#found', root);

    async function load(reset) {
      const my = ++seq;
      if (reset) { offset = 0; grid.innerHTML = ''; grid.setAttribute('aria-busy', 'true'); }
      more.disabled = true;
      try {
        const r = await teamsDirectory(q, offset);
        if (!alive || my !== seq) return;
        const fresh = r.teams.map(card).join('');
        grid.insertAdjacentHTML('beforeend', fresh);
        offset += r.teams.length;
        grid.removeAttribute('aria-busy');
        found.textContent = r.total ? `Найдено: ${r.total}` : '';
        more.hidden = offset >= r.total; more.disabled = false;
        if (!r.total) grid.innerHTML = `<li class="acc-empty big"><p>${q ? 'Команд с таким названием нет.' : 'Команд пока нет.'}</p><span>${q ? 'Проверьте написание или создайте свою.' : 'Создайте первую!'}</span></li>`;
        else if (motion && reset) gsap.from($$('.team-card', grid), { y: 16, opacity: 0, duration: .45, stagger: .04, ease: 'power3.out', clearProps: 'transform,opacity' });
      } catch (e) {
        if (!alive || my !== seq) return;
        grid.removeAttribute('aria-busy'); more.disabled = false;
        grid.insertAdjacentHTML('beforeend', `<li class="acc-empty big"><p>${esc(teamError(e, 'Не удалось загрузить команды.'))}</p><button type="button" class="btn btn-ghost btn-sm" id="retry">Повторить</button></li>`);
      }
    }

    $('#q', root).addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim(); load(true); }, 300); });
    more.addEventListener('click', () => load(false));
    root.addEventListener('click', (e) => { if (e.target.id === 'retry') { e.target.closest('li').remove(); load(offset === 0); } });
    if (motion) gsap.from($$('.page-head, .toolbar', root), { y: 18, opacity: 0, duration: .5, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  },
};
