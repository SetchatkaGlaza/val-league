import { $, $$, gsap, motion } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { rub, dateShort, statusBadge, tournamentError } from './tournament-parts.js';
import { adminNav, isAdmin, myRole } from './admin-nav.js';
import { actionLabel } from './audit-labels.js';

const stat = (n, label, warn = false) => `<div class="stat${warn ? ' warn' : ''}"><b>${n}</b><span>${label}</span></div>`;
const when = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const LEVEL = { danger: 'Срочно', warn: 'Внимание', info: 'К сведению' };

function table(list) {
  if (!list.length) return '<div class="acc-empty big"><p>Турниров пока нет.</p><span>Создайте первый: он появится как черновик, опубликуйте его, когда будет готов.</span></div>';
  return `<div class="tbl-wrap"><table class="tbl" aria-label="Турниры">
    <thead><tr><th scope="col">Турнир</th><th scope="col">Статус</th><th scope="col">Дата</th><th scope="col">Взнос</th><th scope="col">Призовой</th><th scope="col">Команды</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
    <tbody>${list.map((t) => `<tr>
      <td data-l="Турнир"><b>${esc(t.name)}</b></td>
      <td data-l="Статус">${statusBadge(t)}</td>
      <td data-l="Дата">${dateShort(t.startsAt)}</td>
      <td data-l="Взнос">${t.fee ? rub(t.fee) : '—'}</td>
      <td data-l="Призовой">${t.prizeTotal ? rub(t.prizeTotal) : '—'}</td>
      <td data-l="Команды">${t.teamsCount} / ${t.maxTeams}</td>
      <td class="tbl-act"><a class="btn btn-ghost btn-sm" href="/admin/tournaments/${t.id}">${isAdmin(myRole()) ? 'Изменить' : 'Открыть'}</a>${t.status !== 'draft' ? `<a class="btn btn-ghost btn-sm" href="/tournaments/${esc(t.slug)}">На сайте</a>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

const attention = (items) => (items.length
  ? `<ul class="att-list">${items.map((i) => `<li class="att att-${i.level}"><span class="att-lvl">${LEVEL[i.level]}</span><span class="att-t">${esc(i.text)}</span><a class="btn btn-ghost btn-sm" href="${esc(i.href)}">Открыть</a></li>`).join('')}</ul>`
  : '<div class="acc-empty"><p>Всё спокойно.</p><span>Просроченных оплат, матчей без времени и турниров без сетки нет.</span></div>');

const upcoming = (items) => (items.length
  ? `<ul class="up-list">${items.map((t) => `<li><a href="/admin/tournaments/${t.id}"><b>${esc(t.name)}</b><span>${statusBadge(t)} · ${when(t.startsAt)} · оплачено ${t.paid} из ${t.maxTeams}</span></a></li>`).join('')}</ul>`
  : '<div class="acc-empty"><p>Ближайших турниров нет.</p><span>Опубликуйте турнир, и он появится здесь.</span></div>');

const recent = (items) => (items.length
  ? `<ul class="rc-list">${items.map((e) => `<li><span class="rc-t">${esc(actionLabel(e.action))}${e.label ? `: ${esc(e.label)}` : ''}</span><small>${esc(e.actor.nick)} · ${when(e.at)}</small></li>`).join('')}</ul><a class="link" href="/admin/audit">Весь журнал →</a>`
  : '<div class="acc-empty"><p>Действий пока нет.</p><span>Всё, что вы и модераторы меняете в админке, появится здесь.</span></div>');

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  title: 'Админка',
  description: 'Управление турнирами VOLOGDA AMATEUR LEAGUE.',

  render: () => `
    <main class="acc adm">
      <div class="page-head row"><div><h1 class="set-title">Админка</h1><p class="acc-sub">Сводка, что требует внимания, и турниры лиги.</p></div>
        ${isAdmin(myRole()) ? '<a href="/admin/tournaments/new" class="btn btn-primary btn-sm">Создать турнир</a>' : ''}</div>
      ${adminNav('dashboard')}
      <section class="stats" id="stats" aria-label="Сводка" aria-busy="true"><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div></section>
      <div class="adm-cols">
        <section class="acc-card"><h2>Требует внимания</h2><div id="aAtt"><div class="sk sk-card"></div></div></section>
        <section class="acc-card"><h2>Ближайшие турниры</h2><div id="aUp"><div class="sk sk-card"></div></div></section>
      </div>
      ${isAdmin(myRole()) ? '<section class="acc-card"><h2>Последние действия</h2><div id="aRecent"><div class="sk sk-card"></div></div></section>' : ''}
      <section class="acc-card"><h2>Турниры</h2><div id="aList"><div class="sk sk-card"></div></div></section>
    </main>`,

  mount(root) {
    let alive = true;
    const stats = $('#stats', root), list = $('#aList', root), att = $('#aAtt', root), up = $('#aUp', root), rec = $('#aRecent', root);
    const fail = (el, e) => { el.innerHTML = `<div class="acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`; };

    async function load() {
      const [a, b] = await Promise.allSettled([admin.dashboard(), admin.list()]);
      if (!alive) return;
      stats.removeAttribute('aria-busy');
      if (a.status === 'fulfilled') {
        const d = a.value, t = d.tournaments;
        stats.innerHTML = stat(d.users, 'игроков') + stat(d.teams, 'команд') + stat(t.upcoming + t.live, 'активных турниров')
          + stat(t.draft, 'черновиков') + stat(t.finished, 'прошедших') + stat(d.paidRegistrations, 'оплаченных заявок')
          + stat(rub(d.feesTotal), 'сумма взносов') + stat(d.pendingPayments, 'ждут подтверждения оплаты', d.pendingPayments > 0)
          + (d.refundsDue ? stat(d.refundsDue, 'взносов к возврату', true) : '') + (d.blocked ? stat(d.blocked, 'заблокировано') : '');
        att.innerHTML = attention(d.attention);
        up.innerHTML = upcoming(d.upcoming);
        if (rec) rec.innerHTML = recent(d.recent);
      } else {
        stats.innerHTML = '';
        const msg = a.reason.status === 403 ? '<div class="acc-empty"><p>Нет доступа: нужна роль модератора или администратора.</p></div>' : null;
        for (const el of [att, up, rec].filter(Boolean)) { if (msg) el.innerHTML = msg; else fail(el, a.reason); }
      }
      if (b.status === 'fulfilled') list.innerHTML = table(b.value.tournaments);
      else if (b.reason.status === 403) list.innerHTML = '<div class="acc-empty"><p>Нет доступа: нужна роль модератора или администратора.</p></div>';
      else fail(list, b.reason);
      if (motion) gsap.from($$('.stat, .acc-card', root), { y: 16, opacity: 0, duration: .5, stagger: .05, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
    root.addEventListener('click', (e) => {
      if (!e.target.closest('[data-retry]')) return;
      for (const el of [list, att, up, rec].filter(Boolean)) el.innerHTML = '<div class="sk sk-card"></div>';
      load();
    });
    load();
    return () => { alive = false; };
  },
};
