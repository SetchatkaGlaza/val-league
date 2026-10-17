import { $, $$ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { getUser } from '../js/session.js';
import { esc } from './parts.js';
import { adminNav, ROLE_LABEL } from './admin-nav.js';
import { actionLabel, FIELD_LABEL, fmtValue } from './audit-labels.js';
import { userError, when, day, untilText, roleBadge, blockBadge, flags } from './admin-user-parts.js';

const STATUS = { draft: 'черновик', upcoming: 'анонс', live: 'идёт', finished: 'завершён', cancelled: 'отменён' };
const REG = { pending_payment: 'ждёт оплаты', paid: 'участвует', waitlist: 'лист ожидания', cancelled: 'снята' };

const field = (id, label, control) => `<div class="field"><label for="${id}">${label}</label><div class="control">${control}</div></div>`;
const reasonField = (id, label = 'Причина (видна только в журнале)') => field(id, label, `<textarea id="${id}" name="reason" rows="2" maxlength="300" required></textarea>`);
const panel = (id, title, body) => `<details class="usr-act" id="${id}"><summary>${title}</summary><form class="usr-form" novalidate>${body}<p class="err" role="alert"></p></form></details>`;

const dl = (u) => `<dl class="usr-dl">
  <dt>Почта</dt><dd>${u.email ? `${esc(u.email)} · ${u.emailVerified ? 'подтверждена' : 'не подтверждена'}` : 'нет (вход через Steam)'}</dd>
  <dt>Steam</dt><dd>${u.steam ? `${esc(u.steam.name || 'без имени')} <small>${esc(u.steam.id)}</small>` : 'не привязан'}</dd>
  <dt>Telegram</dt><dd>${u.telegram ? esc(u.telegram.username ? `@${u.telegram.username}` : 'привязан') : 'не привязан'}</dd>
  <dt>Регистрация</dt><dd>${day(u.createdAt)}</dd></dl>`;

function blockInfo(b) {
  if (!b) return '';
  return `<section class="acc-card usr-warn"><h2>Заблокирован</h2>
    <p>${esc(b.reason || 'причина не указана')}</p>
    <p class="usr-sub">${esc(untilText(b.until))}${b.at ? ` · с ${when(b.at)}` : ''}${b.by ? ` · заблокировал ${esc(b.by)}` : ''}${b.expired ? ' · срок истёк, блокировка снимется автоматически' : ''}</p></section>`;
}

function actions(u, me) {
  const self = u.id === me;
  const parts = [];
  if (!self) {
    parts.push(u.blocked
      ? panel('act-unblock', 'Разблокировать', `${field('un-note', 'Примечание (необязательно)', '<input id="un-note" name="note" type="text" maxlength="300" />')}<button class="btn btn-primary btn-sm" type="submit" data-act="unblock">Разблокировать</button>`)
      : panel('act-block', 'Заблокировать', `${reasonField('bl-reason', 'Причина (видна только в журнале)')}${field('bl-until', 'Блокировать до (включительно, необязательно)', '<input id="bl-until" name="until" type="date" />')}<p class="usr-sub">Заблокированный не может входить и подавать заявки. Пустая дата — без срока.</p><button class="btn btn-danger btn-sm" type="submit" data-act="block">Заблокировать</button>`));
  }
  parts.push(panel('act-role', 'Сменить роль', `${field('rl-role', 'Роль', `<select id="rl-role" name="role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`)}${self ? '<p class="usr-sub">Свою роль понизить нельзя.</p>' : ''}<button class="btn btn-primary btn-sm" type="submit" data-act="role">Сохранить роль</button>`));
  parts.push(panel('act-nick', 'Сменить ник', `${field('nk-nick', 'Новый ник (3–20 символов: буквы, цифры, _ - .)', `<input id="nk-nick" name="nick" type="text" minlength="3" maxlength="20" value="${esc(u.nick)}" autocomplete="off" required />`)}${reasonField('nk-reason')}<p class="usr-sub">Ник заменится и в составах заявок на турниры, поэтому история в профиле и рейтинге сохранится. Старая ссылка на профиль перестанет открываться.</p><button class="btn btn-primary btn-sm" type="submit" data-act="nick">Сменить ник</button>`));
  const quick = [];
  if (u.email && !u.emailVerified) quick.push('<button class="btn btn-ghost btn-sm" type="button" data-quick="verify">Подтвердить почту</button>');
  if (u.steam) quick.push('<button class="btn btn-ghost btn-sm" type="button" data-quick="steam">Сбросить Steam</button>');
  if (u.telegram) quick.push('<button class="btn btn-ghost btn-sm" type="button" data-quick="telegram">Сбросить Telegram</button>');
  return `<section class="acc-card"><h2>Действия</h2><div class="usr-acts">${parts.join('')}</div>${quick.length ? `<div class="tg-actions usr-quick">${quick.join('')}</div><p class="err" id="usQuickErr" role="alert"></p>` : ''}</section>`;
}

const lists = (d) => `
  <section class="acc-card"><h2>Команды</h2>${d.teams.length
    ? `<ul class="usr-sublist">${d.teams.map((t) => `<li><a href="/teams/${esc(t.slug)}">${esc(t.name)}</a><small>${t.captain ? 'капитан' : t.role === 'sub' ? 'запасной' : 'основа'}</small></li>`).join('')}</ul>`
    : '<div class="acc-empty"><p>Не состоит в командах.</p></div>'}</section>
  <section class="acc-card"><h2>Участие в турнирах</h2>${d.tournaments.length
    ? `<ul class="usr-sublist">${d.tournaments.map((r) => `<li><a href="/admin/tournaments/${esc(r.tournament.id)}">${esc(r.tournament.name)}</a><small>${esc(r.teamName)} · ${esc(REG[r.status] ?? r.status)} · турнир: ${esc(STATUS[r.tournament.status] ?? r.tournament.status)}</small></li>`).join('')}</ul>`
    : '<div class="acc-empty"><p>В турнирах не участвовал.</p></div>'}</section>
  <section class="acc-card"><h2>Что делали с аккаунтом</h2>${d.history.length
    ? `<ul class="usr-sublist">${d.history.map((e) => `<li><span>${esc(actionLabel(e.action))}</span><small>${esc(e.actor)} · ${when(e.at)}${e.meta?.reason ? ` · причина: ${esc(e.meta.reason)}` : ''}${changed(e)}</small></li>`).join('')}</ul><a class="link" href="/admin/audit">Весь журнал →</a>`
    : '<div class="acc-empty"><p>Записей пока нет.</p></div>'}</section>`;

const changed = (e) => {
  const keys = Object.keys(e.after ?? {}).filter((k) => !['reason'].includes(k));
  return keys.length ? ` · ${keys.map((k) => `${esc(FIELD_LABEL[k] ?? k)}: ${esc(fmtValue(k, e.before?.[k]))} → ${esc(fmtValue(k, e.after?.[k]))}`).join('; ')}` : '';
};

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  adminOnly: true,
  title: 'Пользователь',
  description: 'Карточка пользователя.',

  render: () => `
    <main class="acc adm">
      <div class="page-head"><h1 class="set-title" id="usName">Пользователь</h1><p class="acc-sub"><a class="link" href="/admin/users">← Ко всем пользователям</a></p></div>
      ${adminNav('users')}
      <p class="ok usr-status" id="usOk" role="status"></p>
      <div id="usBody" aria-live="polite"><div class="sk sk-card"></div></div>
    </main>`,

  mount(root, { params }) {
    let alive = true, data = null;
    const body = $('#usBody', root);
    const me = getUser()?.id;

    function paint() {
      const u = data.user;
      $('#usName', root).textContent = u.nick;
      body.innerHTML = `
        <section class="acc-card"><div class="usr-main">${roleBadge(u.role)}${blockBadge(u.blocked)}${flags(u)}</div>${dl(u)}</section>
        ${blockInfo(u.blocked)}${actions(u, me)}${lists(data)}`;
    }
    async function load() {
      body.innerHTML = '<div class="sk sk-card"></div>';
      try { data = await admin.user(params.id); if (alive) paint(); }
      catch (e) { if (alive) body.innerHTML = `<div class="acc-card acc-empty"><p>${esc(e.status === 404 ? 'Пользователь не найден.' : userError(e, 'Не удалось загрузить карточку.'))}</p>${e.status === 404 ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button>'}</div>`; }
    }

    /** Выполняет действие и обновляет карточку целиком; сообщение об успехе остаётся на странице. */
    async function run(btn, fn, okText, errBox) {
      const ok = $('#usOk', root);
      btn.disabled = true; errBox.textContent = ''; ok.textContent = '';
      try {
        const r = await fn();
        if (!alive) return;
        data = await admin.user(params.id);
        paint();
        const extra = r?.registrations !== undefined ? ` Обновлено заявок: ${r.registrations}.` : '';
        ok.textContent = okText + extra;
      } catch (e) {
        if (!alive) return;
        errBox.textContent = userError(e, 'Не получилось. Попробуйте ещё раз.');
        btn.disabled = false;
      }
    }

    root.addEventListener('submit', (e) => {
      const form = e.target.closest('.usr-form'); if (!form) return;
      e.preventDefault();
      const btn = $('[data-act]', form), act = btn.dataset.act, f = Object.fromEntries(new FormData(form).entries());
      const err = $('.err', form);
      const need = (name, min = 3) => { if (String(f[name] ?? '').trim().length < min) { err.textContent = name === 'reason' ? 'Укажите причину (не короче 3 символов).' : 'Заполните поле.'; $(`[name="${name}"]`, form)?.focus(); return false; } return true; };
      const id = params.id, u = data.user;
      if (act === 'block') {
        if (!need('reason')) return;
        if (!confirm(`Заблокировать «${u.nick}»? Он сразу потеряет доступ к сайту.`)) return;
        run(btn, () => admin.blockUser(id, { reason: f.reason, ...(f.until ? { until: f.until } : {}) }), 'Пользователь заблокирован.', err);
      } else if (act === 'unblock') {
        run(btn, () => admin.unblockUser(id, f.note ? { note: f.note } : {}), 'Блокировка снята.', err);
      } else if (act === 'role') {
        if (f.role === u.role) { err.textContent = 'Роль не изменилась.'; return; }
        if (!confirm(`Сменить роль «${u.nick}»: ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[f.role]}?`)) return;
        run(btn, () => admin.setUserRole(id, { role: f.role }), 'Роль изменена. Пользователь увидит её после обновления страницы.', err);
      } else if (act === 'nick') {
        const nick = String(f.nick ?? '').trim();
        if (nick === u.nick) { err.textContent = 'Ник не изменился.'; return; }
        if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(nick)) { err.textContent = 'Ник: 3–20 символов, буквы, цифры, _ - .'; return; }
        if (!need('reason')) return;
        if (!confirm(`Сменить ник «${u.nick}» на «${nick}»? Ник заменится и в составах заявок.`)) return;
        run(btn, () => admin.renameUser(id, { nick, reason: f.reason }), 'Ник изменён.', err);
      }
    });

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) { load(); return; }
      const q = e.target.closest('[data-quick]'); if (!q) return;
      const id = params.id, u = data.user, err = $('#usQuickErr', root);
      const k = q.dataset.quick;
      if (k === 'verify') { if (confirm(`Подтвердить почту «${u.nick}» без письма?`)) run(q, () => admin.verifyUserEmail(id), 'Почта подтверждена.', err); }
      if (k === 'steam') { if (confirm(`Сбросить привязку Steam у «${u.nick}»? Войти через Steam он больше не сможет, пока не привяжет заново.`)) run(q, () => admin.resetUserSteam(id), 'Steam отвязан.', err); }
      if (k === 'telegram') { if (confirm(`Сбросить привязку Telegram у «${u.nick}»? Уведомления в Telegram перестанут приходить.`)) run(q, () => admin.resetUserTelegram(id), 'Telegram отвязан.', err); }
    });
    load();
    return () => { alive = false; };
  },
};
