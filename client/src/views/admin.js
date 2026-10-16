import { $, $$, gsap, motion } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { rub, dateShort, statusBadge, tournamentError } from './tournament-parts.js';

const stat = (n, label) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;

function table(list) {
  if (!list.length) return '<div class="acc-empty big"><p>Турниров пока нет.</p><span>Создайте первый: он появится как черновик, опубликуйте его, когда будет готов.</span></div>';
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Турнир</th><th>Статус</th><th>Дата</th><th>Взнос</th><th>Призовой</th><th>Команды</th><th><span class="sr-only">Действия</span></th></tr></thead>
    <tbody>${list.map((t) => `<tr>
      <td data-l="Турнир"><b>${esc(t.name)}</b></td>
      <td data-l="Статус">${statusBadge(t)}</td>
      <td data-l="Дата">${dateShort(t.startsAt)}</td>
      <td data-l="Взнос">${t.fee ? rub(t.fee) : '—'}</td>
      <td data-l="Призовой">${t.prizeTotal ? rub(t.prizeTotal) : '—'}</td>
      <td data-l="Команды">${t.teamsCount} / ${t.maxTeams}</td>
      <td class="tbl-act"><a class="btn btn-ghost btn-sm" href="/admin/tournaments/${t.id}">Изменить</a>${t.status !== 'draft' ? `<a class="btn btn-ghost btn-sm" href="/tournaments/${esc(t.slug)}">Открыть</a>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  title: 'Админка',
  description: 'Управление турнирами VOLOGDA AMATEUR LEAGUE.',

  render: () => `
    <main class="acc adm">
      <div class="page-head row"><div><h1 class="set-title">Админка</h1><p class="acc-sub">Турниры лиги и общая сводка.</p></div>
        <a href="/admin/tournaments/new" class="btn btn-primary btn-sm">Создать турнир</a></div>
      <section class="stats" id="stats" aria-label="Сводка"><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div></section>
      <section class="acc-card"><h2>Турниры</h2><div id="aList"><div class="sk sk-card"></div></div></section>
      <section class="acc-card"><h2>Скоро</h2><p class="acc-sub">Заявки и оплаты, пользователи, новости и реклама появятся в этом разделе на следующих этапах.</p></section>
    </main>`,

  mount(root) {
    let alive = true;
    const stats = $('#stats', root), list = $('#aList', root);
    const fail = (el, e) => { el.innerHTML = `<div class="acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`; };

    async function load() {
      const [a, b] = await Promise.allSettled([admin.dashboard(), admin.list()]);
      if (!alive) return;
      if (a.status === 'fulfilled') {
        const d = a.value, t = d.tournaments;
        stats.innerHTML = stat(d.users, 'игроков') + stat(d.verified, 'с подтверждённой почтой') + stat(d.teams, 'команд') + stat(t.upcoming + t.live, 'активных турниров') + stat(d.pendingPayments, 'ждут подтверждения оплаты') + (d.refundsDue ? stat(d.refundsDue, 'взносов к возврату') : '');
      } else stats.innerHTML = '';
      if (b.status === 'fulfilled') list.innerHTML = table(b.value.tournaments); else fail(list, b.reason);
      if (a.status === 'rejected' && a.reason.status === 403) list.innerHTML = '<div class="acc-empty"><p>Нет доступа: ваш аккаунт не администратор.</p></div>';
      if (motion) gsap.from($$('.stat, .acc-card', root), { y: 16, opacity: 0, duration: .5, stagger: .06, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) { list.innerHTML = '<div class="sk sk-card"></div>'; load(); } });
    load();
    return () => { alive = false; };
  },
};
