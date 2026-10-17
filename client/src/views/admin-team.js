import { $ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { getUser } from '../js/session.js';
import { esc } from './parts.js';
import { adminNav, isAdmin } from './admin-nav.js';
import { actionLabel, FIELD_LABEL, fmtValue } from './audit-labels.js';
import { when, day } from './admin-user-parts.js';
import { teamError, logoThumb } from './admin-team-parts.js';

const STATUS = { draft: 'черновик', upcoming: 'анонс', live: 'идёт', finished: 'завершён', cancelled: 'отменён' };
const REG = { pending_payment: 'ждёт оплаты', paid: 'участвует', waitlist: 'лист ожидания', cancelled: 'снята' };

const field = (id, label, control) => `<div class="field"><label for="${id}">${label}</label><div class="control">${control}</div></div>`;
const reasonField = (id) => field(id, 'Причина (видна только в журнале)', `<textarea id="${id}" name="reason" rows="2" maxlength="300" required></textarea>`);
const panel = (id, title, body) => `<details class="usr-act" id="${id}"><summary>${title}</summary><form class="usr-form" novalidate>${body}<p class="err" role="alert"></p></form></details>`;

function actions(d) {
  const t = d.team, parts = [];
  parts.push(panel('act-rename', 'Переименовать',
    `${field('rn-name', 'Новое название (3–24 символа)', `<input id="rn-name" name="name" type="text" minlength="3" maxlength="24" value="${esc(t.name)}" autocomplete="off" required />`)}${reasonField('rn-reason')}
     <p class="usr-sub">Адрес страницы команды не изменится. Новое название заменится в заявках, сетках и итогах турниров, старое нигде не останется.</p>
     <button class="btn btn-primary btn-sm" type="submit" data-act="rename">Переименовать</button>`));
  if (t.logo) parts.push(panel('act-logo', 'Снять логотип', `${reasonField('lg-reason')}<p class="usr-sub">Команда останется без логотипа и сможет загрузить новый.</p><button class="btn btn-danger btn-sm" type="submit" data-act="logo">Снять логотип</button>`));
  if (t.description) parts.push(panel('act-desc', 'Очистить описание', `${reasonField('ds-reason')}<button class="btn btn-danger btn-sm" type="submit" data-act="desc">Очистить описание</button>`));
  if (isAdmin(getUser()?.role)) {
    parts.push(panel('act-disband', 'Расформировать команду',
      d.canDisband
        ? `${reasonField('db-reason')}<p class="usr-sub">Команда будет удалена вместе со списком игроков и приглашениями. Прошедшие турниры сохранят название и состав команды в истории. Отменить это действие нельзя.</p><button class="btn btn-danger btn-sm" type="submit" data-act="disband">Расформировать</button>`
        : `<p class="usr-sub">Нельзя: у команды есть заявка в турнире (черновик, анонс или идёт). Сначала снимите заявки в разделе турнира.</p>`));
  }
  return `<section class="acc-card"><h2>Действия</h2><div class="usr-acts">${parts.join('')}</div></section>`;
}

const dl = (t) => `<dl class="usr-dl">
  <dt>Адрес</dt><dd><a class="link" href="/teams/${esc(t.slug)}">/teams/${esc(t.slug)}</a></dd>
  <dt>Капитан</dt><dd>${t.captain?.nick ? esc(t.captain.nick) : 'не назначен'}</dd>
  <dt>Создана</dt><dd>${day(t.createdAt)}</dd>
  <dt>Описание</dt><dd>${t.description ? esc(t.description) : '<span class="usr-sub">пусто</span>'}</dd></dl>`;

const changed = (e) => {
  const keys = Object.keys(e.after ?? {}).filter((k) => !['reason'].includes(k));
  return keys.length ? ` · ${keys.map((k) => `${esc(FIELD_LABEL[k] ?? k)}: ${esc(fmtValue(k, e.before?.[k]))} → ${esc(fmtValue(k, e.after?.[k]))}`).join('; ')}` : '';
};

const lists = (d) => `
  <section class="acc-card"><h2>Состав</h2>${d.members.length
    ? `<ul class="usr-sublist">${d.members.map((m) => `<li>${isAdmin(getUser()?.role) ? `<a href="/admin/users/${esc(m.id)}">${esc(m.nick)}</a>` : `<span>${esc(m.nick)}</span>`}<small>${m.captain ? 'капитан' : m.role === 'sub' ? 'запасной' : 'основа'}${m.blocked ? ' · заблокирован' : ''}</small></li>`).join('')}</ul>`
    : '<div class="acc-empty"><p>В команде никого нет.</p></div>'}</section>
  <section class="acc-card"><h2>Заявки на турниры</h2>${d.registrations.length
    ? `<ul class="usr-sublist">${d.registrations.map((r) => `<li><a href="/admin/tournaments/${esc(r.tournament.id)}">${esc(r.tournament.name)}</a><small>${esc(REG[r.status] ?? r.status)}${r.refundDue ? ' · нужен возврат' : ''} · турнир: ${esc(STATUS[r.tournament.status] ?? r.tournament.status)}</small></li>`).join('')}</ul>`
    : '<div class="acc-empty"><p>Заявок не было.</p></div>'}</section>
  <section class="acc-card"><h2>Что делали с командой</h2>${d.history.length
    ? `<ul class="usr-sublist">${d.history.map((e) => `<li><span>${esc(actionLabel(e.action))}</span><small>${esc(e.actor)} · ${when(e.at)}${e.meta?.reason ? ` · причина: ${esc(e.meta.reason)}` : ''}${changed(e)}</small></li>`).join('')}</ul>${isAdmin(getUser()?.role) ? '<a class="link" href="/admin/audit">Весь журнал →</a>' : ''}`
    : '<div class="acc-empty"><p>Записей пока нет.</p></div>'}</section>`;

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  title: 'Команда',
  description: 'Карточка команды.',

  render: () => `
    <main class="acc adm">
      <div class="page-head"><h1 class="set-title" id="tmName">Команда</h1><p class="acc-sub"><a class="link" href="/admin/teams">← Ко всем командам</a></p></div>
      ${adminNav('teams')}
      <p class="ok usr-status" id="tmOk" role="status"></p>
      <div id="tmBody" aria-live="polite"><div class="sk sk-card"></div></div>
    </main>`,

  mount(root, { params }) {
    let alive = true, data = null;
    const body = $('#tmBody', root);

    function paint() {
      const t = data.team;
      $('#tmName', root).textContent = t.name;
      body.innerHTML = `<section class="acc-card tm-head">${logoThumb(t, 'lg')}<div class="tm-head-info">${dl(t)}</div></section>${actions(data)}${lists(data)}`;
    }
    async function load() {
      body.innerHTML = '<div class="sk sk-card"></div>';
      try { data = await admin.team(params.id); if (alive) paint(); }
      catch (e) { if (alive) body.innerHTML = `<div class="acc-card acc-empty"><p>${esc(e.status === 404 ? 'Команда не найдена.' : teamError(e, 'Не удалось загрузить карточку.'))}</p>${e.status === 404 ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button>'}</div>`; }
    }

    async function run(btn, fn, okText, errBox, after) {
      const ok = $('#tmOk', root);
      btn.disabled = true; errBox.textContent = ''; ok.textContent = '';
      try {
        const r = await fn();
        if (!alive) return;
        if (after) { after(); return; }
        data = await admin.team(params.id);
        paint();
        const extra = r?.registrations !== undefined ? ` Обновлено заявок: ${r.registrations}, матчей: ${r.matches ?? 0}.` : '';
        ok.textContent = okText + extra;
      } catch (e) {
        if (!alive) return;
        errBox.textContent = teamError(e, 'Не получилось. Попробуйте ещё раз.');
        btn.disabled = false;
      }
    }

    root.addEventListener('submit', (e) => {
      const form = e.target.closest('.usr-form'); if (!form) return;
      e.preventDefault();
      const btn = $('[data-act]', form), act = btn.dataset.act, f = Object.fromEntries(new FormData(form).entries());
      const err = $('.err', form), t = data.team, id = params.id;
      if (String(f.reason ?? '').trim().length < 3) { err.textContent = 'Укажите причину (не короче 3 символов).'; $('[name="reason"]', form)?.focus(); return; }
      if (act === 'rename') {
        const name = String(f.name ?? '').trim().replace(/\s+/g, ' ');
        if (name === t.name) { err.textContent = 'Название не изменилось.'; return; }
        if ([...name].length < 3 || [...name].length > 24 || /[<>]/.test(name)) { err.textContent = 'Название: 3–24 символа, без < и >.'; $('[name="name"]', form)?.focus(); return; }
        if (!confirm(`Переименовать «${t.name}» в «${name}»? Название заменится и в заявках, и в сетках турниров.`)) return;
        run(btn, () => admin.renameTeam(id, { name, reason: f.reason }), 'Команда переименована.', err);
      } else if (act === 'logo') {
        if (!confirm(`Снять логотип команды «${t.name}»?`)) return;
        run(btn, () => admin.removeTeamLogo(id, { reason: f.reason }), 'Логотип снят.', err);
      } else if (act === 'desc') {
        if (!confirm(`Очистить описание команды «${t.name}»?`)) return;
        run(btn, () => admin.clearTeamDescription(id, { reason: f.reason }), 'Описание очищено.', err);
      } else if (act === 'disband') {
        if (!confirm(`Расформировать команду «${t.name}»? Команда и список игроков будут удалены, отменить это нельзя.`)) return;
        run(btn, () => admin.disbandTeam(id, { reason: f.reason }), '', err, () => { location.assign('/admin/teams'); });
      }
    });

    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(); });
    load();
    return () => { alive = false; };
  },
};
