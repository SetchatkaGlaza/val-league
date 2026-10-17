import { $ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { adminNav, ROLE_LABEL } from './admin-nav.js';
import { userError, day, roleBadge, blockBadge, flags } from './admin-user-parts.js';

const yn = (label, name) => `<div class="field"><label for="us-${name}">${label}</label><div class="control"><select id="us-${name}" name="${name}"><option value="">Любой</option><option value="yes">Да</option><option value="no">Нет</option></select></div></div>`;

const row = (u) => `<li><a class="usr-row" href="/admin/users/${esc(u.id)}">
  <span class="usr-main"><b>${esc(u.nick)}</b>${roleBadge(u.role)}${blockBadge(u.blocked)}</span>
  <span class="usr-mail">${u.email ? esc(u.email) : 'без почты (вход через Steam)'}</span>
  <span class="usr-flags">${flags(u)}<small>с ${day(u.createdAt)}</small></span></a></li>`;

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  adminOnly: true,
  title: 'Пользователи',
  description: 'Список пользователей сайта.',

  render: () => `
    <main class="acc adm">
      <div class="page-head"><h1 class="set-title">Пользователи</h1><p class="acc-sub">Поиск, блокировки, роли и привязки. Раздел виден только администраторам.</p></div>
      ${adminNav('users')}
      <form class="acc-card au-filter" id="usForm" novalidate>
        <div class="au-grid">
          <div class="field"><label for="us-q">Ник или почта</label><div class="control"><input id="us-q" name="q" type="search" maxlength="60" autocomplete="off" /></div></div>
          <div class="field"><label for="us-role">Роль</label><div class="control"><select id="us-role" name="role"><option value="">Любая</option>${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div></div>
          ${yn('Почта подтверждена', 'verified')}${yn('Заблокирован', 'blocked')}${yn('Есть Steam', 'steam')}${yn('Есть Telegram', 'telegram')}
          <div class="field"><label for="us-sort">Сортировка</label><div class="control"><select id="us-sort" name="sort"><option value="created">Сначала новые</option><option value="nick">По нику</option><option value="role">По роли</option></select></div></div>
        </div>
        <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm">Показать</button><button type="reset" class="btn btn-ghost btn-sm">Сбросить</button></div>
      </form>
      <section class="acc-card"><h2>Список <small id="usTotal" class="usr-total"></small></h2>
        <div id="usList" aria-live="polite"><div class="sk sk-card"></div></div>
        <p class="err" id="us-err" role="alert"></p>
        <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" id="usMore" hidden>Показать ещё</button></div>
      </section>
    </main>`,

  mount(root) {
    let alive = true, next = 0, filter = {}, seq = 0;
    const list = $('#usList', root), more = $('#usMore', root), err = $('#us-err', root), form = $('#usForm', root), total = $('#usTotal', root);

    async function load(append) {
      const my = ++seq;
      more.disabled = true; err.textContent = '';
      if (!append) { list.innerHTML = '<div class="sk sk-card"></div>'; more.hidden = true; total.textContent = ''; next = 0; }
      try {
        const r = await admin.users({ ...filter, ...(append ? { offset: next } : {}) });
        if (!alive || my !== seq) return;
        next = r.nextOffset;
        if (!append) {
          total.textContent = `найдено: ${r.total}`;
          list.innerHTML = r.users.length ? '<ul class="usr-list"></ul>' : '<div class="acc-empty"><p>Никого не нашли.</p><span>Измените поиск или фильтры.</span></div>';
        }
        const ul = $('.usr-list', list);
        if (ul) ul.insertAdjacentHTML('beforeend', r.users.map(row).join(''));
        more.hidden = next === null; more.disabled = false;
      } catch (e) {
        if (!alive || my !== seq) return;
        more.disabled = false;
        if (append) err.textContent = userError(e, 'Не удалось подгрузить список.');
        else { list.innerHTML = `<div class="acc-empty"><p>${esc(userError(e, 'Не удалось загрузить список.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`; more.hidden = true; }
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
