import { $ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { adminNav } from './admin-nav.js';
import { day } from './admin-user-parts.js';
import { teamError, logoThumb } from './admin-team-parts.js';

const yn = (label, name) => `<div class="field"><label for="tl-${name}">${label}</label><div class="control"><select id="tl-${name}" name="${name}"><option value="">Любой</option><option value="yes">Да</option><option value="no">Нет</option></select></div></div>`;

const row = (t) => `<li><a class="usr-row tm-row" href="/admin/teams/${esc(t.id)}">
  ${logoThumb(t)}
  <span class="tm-info">
    <span class="usr-main"><b>${esc(t.name)}</b>${t.activeRegistrations ? `<span class="usr-badge usr-ok">В турнирах: ${t.activeRegistrations}</span>` : ''}${t.logo ? '' : '<span class="usr-badge">без логотипа</span>'}</span>
    <span class="usr-mail">Капитан: ${t.captain?.nick ? esc(t.captain.nick) : 'не назначен'} · игроков: ${t.members ?? 0}</span>
    <span class="usr-flags"><small>создана ${day(t.createdAt)}</small></span>
  </span></a></li>`;

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  title: 'Команды',
  description: 'Список команд сайта.',

  render: () => `
    <main class="acc adm">
      <div class="page-head"><h1 class="set-title">Команды</h1><p class="acc-sub">Поиск, модерация логотипов и названий, расформирование.</p></div>
      ${adminNav('teams')}
      <form class="acc-card au-filter" id="tlForm" novalidate>
        <div class="au-grid">
          <div class="field"><label for="tl-q">Название или адрес</label><div class="control"><input id="tl-q" name="q" type="search" maxlength="60" autocomplete="off" /></div></div>
          ${yn('Есть логотип', 'logo')}${yn('Заявка в турнире', 'active')}
          <div class="field"><label for="tl-sort">Сортировка</label><div class="control"><select id="tl-sort" name="sort"><option value="created">Сначала новые</option><option value="name">По названию</option><option value="members">По числу игроков</option></select></div></div>
        </div>
        <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm">Показать</button><button type="reset" class="btn btn-ghost btn-sm">Сбросить</button></div>
      </form>
      <section class="acc-card"><h2>Список <small id="tlTotal" class="usr-total"></small></h2>
        <div id="tlList" aria-live="polite"><div class="sk sk-card"></div></div>
        <p class="err" id="tl-err" role="alert"></p>
        <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" id="tlMore" hidden>Показать ещё</button></div>
      </section>
    </main>`,

  mount(root) {
    let alive = true, next = 0, filter = {}, seq = 0;
    const list = $('#tlList', root), more = $('#tlMore', root), err = $('#tl-err', root), form = $('#tlForm', root), total = $('#tlTotal', root);

    async function load(append) {
      const my = ++seq;
      more.disabled = true; err.textContent = '';
      if (!append) { list.innerHTML = '<div class="sk sk-card"></div>'; more.hidden = true; total.textContent = ''; next = 0; }
      try {
        const r = await admin.teams({ ...filter, ...(append ? { offset: next } : {}) });
        if (!alive || my !== seq) return;
        next = r.nextOffset;
        if (!append) {
          total.textContent = `найдено: ${r.total}`;
          list.innerHTML = r.teams.length ? '<ul class="usr-list"></ul>' : '<div class="acc-empty"><p>Команд не нашли.</p><span>Измените поиск или фильтры.</span></div>';
        }
        const ul = $('.usr-list', list);
        if (ul) ul.insertAdjacentHTML('beforeend', r.teams.map(row).join(''));
        more.hidden = next === null; more.disabled = false;
      } catch (e) {
        if (!alive || my !== seq) return;
        more.disabled = false;
        if (append) err.textContent = teamError(e, 'Не удалось подгрузить список.');
        else { list.innerHTML = `<div class="acc-empty"><p>${esc(teamError(e, 'Не удалось загрузить список.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`; more.hidden = true; }
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      for (const k of Object.keys(f)) if (!String(f[k]).trim()) delete f[k];
      filter = f; load(false);
    });
    form.addEventListener('reset', () => { filter = {}; setTimeout(() => load(false)); });
    more.addEventListener('click', () => load(true));
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(false); });
    load(false);
    return () => { alive = false; };
  },
};
