import { $, $$ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { tournamentError } from './tournament-parts.js';
import { adminNav, ROLE_LABEL } from './admin-nav.js';
import { ACTION_LABEL, GROUP_LABEL, OBJECT_LABEL, FIELD_LABEL, actionLabel, fmtValue } from './audit-labels.js';

const when = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

const options = (map, all) => `<option value="">${all}</option>${Object.entries(map).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}`;

function changes(e) {
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])];
  const rows = keys.map((k) => `<tr><th scope="row">${esc(FIELD_LABEL[k] ?? k)}</th><td>${esc(fmtValue(k, e.before?.[k]))}</td><td>${esc(fmtValue(k, e.after?.[k]))}</td></tr>`).join('');
  const meta = e.meta ? Object.entries(e.meta).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${esc(FIELD_LABEL[k] ?? k)}: ${esc(fmtValue(k, v))}`).join(' · ') : '';
  if (!rows && !meta && !e.ip) return '';
  return `<details class="au-det"><summary>Подробности</summary>
    ${rows ? `<div class="tbl-wrap"><table class="au-diff"><thead><tr><th scope="col">Поле</th><th scope="col">Было</th><th scope="col">Стало</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${meta ? `<p class="au-meta">${meta}</p>` : ''}${e.ip ? `<p class="au-meta">IP: ${esc(e.ip)}</p>` : ''}</details>`;
}

const entry = (e) => `<li class="au-item">
  <div class="au-head"><b>${esc(actionLabel(e.action))}</b><time datetime="${esc(e.at)}">${when(e.at)}</time></div>
  <p class="au-obj">${e.label ? esc(e.label) : esc(OBJECT_LABEL[e.objectType] ?? e.objectType)}<small>${esc(OBJECT_LABEL[e.objectType] ?? e.objectType)}</small></p>
  <p class="au-who">${esc(e.actor.nick)} <span class="au-role">${esc(ROLE_LABEL[e.actor.role] ?? e.actor.role)}</span></p>
  ${changes(e)}</li>`;

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  adminOnly: true,
  title: 'Журнал действий',
  description: 'Журнал действий администраторов и модераторов.',

  render: () => `
    <main class="acc adm">
      <div class="page-head"><h1 class="set-title">Журнал</h1><p class="acc-sub">Кто и что менял в админке. Записи нельзя изменить или удалить.</p></div>
      ${adminNav('audit')}
      <form class="acc-card au-filter" id="auForm" novalidate>
        <div class="au-grid">
          <div class="field"><label for="au-actor">Кто (ник)</label><div class="control"><input id="au-actor" name="actor" type="text" maxlength="40" autocomplete="off" /></div></div>
          <div class="field"><label for="au-action">Действие</label><div class="control"><select id="au-action" name="action">${options({ ...GROUP_LABEL, ...ACTION_LABEL }, 'Любое')}</select></div></div>
          <div class="field"><label for="au-type">Объект</label><div class="control"><select id="au-type" name="objectType">${options(OBJECT_LABEL, 'Любой')}</select></div></div>
          <div class="field"><label for="au-from">С даты</label><div class="control"><input id="au-from" name="from" type="date" /></div></div>
          <div class="field"><label for="au-to">По дату</label><div class="control"><input id="au-to" name="to" type="date" /></div></div>
        </div>
        <p class="err" id="au-err" role="alert"></p>
        <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm">Показать</button><button type="reset" class="btn btn-ghost btn-sm">Сбросить</button></div>
      </form>
      <section class="acc-card"><h2>Записи</h2>
        <div id="auList" aria-live="polite"><div class="sk sk-card"></div></div>
        <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" id="auMore" hidden>Показать ещё</button></div>
      </section>
    </main>`,

  mount(root) {
    let alive = true, cursor = null, filter = {}, seq = 0;
    const list = $('#auList', root), more = $('#auMore', root), err = $('#au-err', root), form = $('#auForm', root);
    const fail = (e) => { list.innerHTML = `<div class="acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить журнал.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`; more.hidden = true; };

    async function load(append) {
      const my = ++seq;
      more.disabled = true;
      if (!append) { list.innerHTML = '<div class="sk sk-card"></div>'; more.hidden = true; }
      try {
        const r = await admin.audit({ ...filter, ...(append && cursor ? { before: cursor } : {}) });
        if (!alive || my !== seq) return;
        cursor = r.nextCursor;
        if (!append) list.innerHTML = r.entries.length ? '<ul class="au-list"></ul>' : '<div class="acc-empty"><p>Записей нет.</p><span>Измените фильтры или период.</span></div>';
        const ul = $('.au-list', list);
        if (ul) ul.insertAdjacentHTML('beforeend', r.entries.map(entry).join(''));
        more.hidden = !cursor; more.disabled = false;
      } catch (e) {
        if (!alive || my !== seq) return;
        more.disabled = false;
        if (append) { err.textContent = tournamentError(e, 'Не удалось подгрузить записи.'); } else fail(e);
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      for (const k of Object.keys(f)) if (!String(f[k]).trim()) delete f[k];
      if (f.from && f.to && f.from > f.to) { err.textContent = 'Дата «с» позже даты «по».'; return; }
      err.textContent = ''; filter = f; cursor = null; load(false);
    });
    form.addEventListener('reset', () => { err.textContent = ''; filter = {}; cursor = null; setTimeout(() => load(false)); });
    more.addEventListener('click', () => { err.textContent = ''; load(true); });
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(false); });
    load(false);
    return () => { alive = false; };
  },
};
