import { $, gsap, motion } from '../js/ui.js';
import { invites } from '../js/api.js';
import { ICON, esc } from './parts.js';
import { teamLogo, teamError, plural } from './team-parts.js';

const skeleton = '<div class="tm-skel" aria-busy="true"><div class="sk sk-card"></div></div>';
const state = (title, text, actions) => `<section class="stub tm-state"><h1>${title}</h1><p>${text}</p><div class="stub-actions">${actions}</div></section>`;
const home = '<a href="/account" class="btn btn-primary">В личный кабинет</a>';

export default {
  layout: 'doc',
  protected: true,   // без входа отправим на /login и вернём обратно вместе с ?token=…
  title: 'Приглашение в команду',
  description: 'Приглашение в команду на сайте VOLOGDA AMATEUR LEAGUE.',

  render: () => `
    <main class="acc tm tm-invite">
      <a href="/account" class="back">${ICON.back}Личный кабинет</a>
      <div id="invBody">${skeleton}</div>
    </main>`,

  mount(root, { navigate, query }) {
    let alive = true;
    const body = $('#invBody', root);
    const pick = query.get('token') ? { token: query.get('token') } : query.get('id') ? { id: query.get('id') } : null;
    const show = (html) => {
      body.innerHTML = html;
      if (motion) gsap.from(body.children, { y: 20, opacity: 0, duration: .5, ease: 'power3.out', clearProps: 'transform,opacity' });
    };

    const card = (d) => {
      const left = d.limit - d.members;
      const lead = d.invitedBy ? `<b>${esc(d.invitedBy)}</b> приглашает вас в команду` : 'Вас приглашают в команду';
      const actions = d.state === 'ok'
        ? `<button type="button" class="btn btn-primary" data-act="accept"><span class="label">Принять</span><span class="spinner" aria-hidden="true"></span></button>
           <button type="button" class="btn btn-ghost" data-act="decline">Отклонить</button>`
        : d.state === 'already_member'
          ? `<a href="/teams/${esc(d.team.slug)}" class="btn btn-primary">Перейти в команду</a>`
          : '<a href="/account" class="btn btn-ghost">В личный кабинет</a>';
      const info = d.state === 'already_member' ? 'Вы уже в этой команде.' : d.state === 'full' ? 'В команде нет свободных мест. Попросите капитана освободить место.'
        : `Сейчас в команде ${d.members} ${plural(d.members, 'игрок', 'игрока', 'игроков')}, свободно ${left} ${plural(left, 'место', 'места', 'мест')}.`;
      return `
      <section class="inv-card">
        ${teamLogo(d.team, 'xl')}
        <p class="label">Приглашение</p>
        <p class="inv-lead">${lead}</p>
        <h1>${esc(d.team.name)}</h1>
        ${d.team.description ? `<p class="tm-desc">${esc(d.team.description)}</p>` : ''}
        <p class="inv-info">${info}</p>
        <div class="inv-actions">${actions}</div>
        <p class="err" id="invErr" role="alert"></p>
      </section>`;
    };

    let data = null;
    const fail = (e) => { const el = $('#invErr', root); if (el) el.textContent = teamError(e); };

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn || btn.disabled) return;
      if (btn.dataset.act === 'retry') { body.innerHTML = skeleton; load(); return; }
      btn.disabled = true; btn.classList.add('loading');
      try {
        if (btn.dataset.act === 'accept') { const r = await invites.accept(pick); navigate(`/teams/${r.slug}`); }
        else {
          if (pick.id) await invites.decline(pick.id);   // ссылку «отклонить» нечем: просто уходим
          navigate('/account');
        }
      } catch (err) {
        if (!alive) return;
        btn.disabled = false; btn.classList.remove('loading');
        if (['team_full', 'already_member', 'invite_invalid'].includes(err.code)) load();   // состояние изменилось — показываем актуальное
        else fail(err);
      }
    });

    async function load() {
      if (!pick) { show(state('Приглашение недействительно', 'В ссылке нет данных приглашения. Попросите капитана прислать её ещё раз.', home)); return; }
      try { data = await invites.preview(pick); if (alive) show(card(data)); }
      catch (e) {
        if (!alive) return;
        show(e.code === 'invite_invalid' || e.code === 'validation'
          ? state('Приглашение недействительно', 'Ссылка устарела, её сбросил капитан, либо приглашение уже принято или отозвано.', home)
          : state('Не удалось загрузить', teamError(e, 'Попробуйте обновить страницу.'), '<button type="button" class="btn btn-primary" data-act="retry">Повторить</button>'));
      }
    }
    load();
    return () => { alive = false; };
  },
};
