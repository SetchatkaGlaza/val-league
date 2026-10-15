import { $, $$, gsap, motion } from '../js/ui.js';
import { account, auth, ApiError, serverFallback } from '../js/api.js';
import { getUser, patchUser, clearUser } from '../js/session.js';
import { ICON, esc } from './parts.js';

const TG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M21.5 4.3 2.9 11.4c-1.3.5-1.3 1.3-.2 1.6l4.8 1.5 1.8 5.6c.2.6.1.8.7.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.2-.5-1.8-1.5-1.4ZM9 14l9.3-5.9c.4-.3.8-.1.5.2L11.2 15.2l-.3 3.2L9 14Z"/></svg>';
const empty = (text, hint) => `<div class="acc-empty"><p>${text}</p>${hint ? `<span>${hint}</span>` : ''}</div>`;

const row = (icon, name, status, action) =>
  `<div class="link-row"><div class="link-ic">${icon}</div><div class="link-t"><b>${name}</b>${status}</div>${action}</div>`;
const btn = (act, label) => `<button type="button" class="btn btn-ghost btn-sm" data-act="${act}">${label}</button>`;

function linkedHtml(u, tg) {
  const steam = u.steam
    ? row(ICON.steam, 'Steam', `<span class="ok">${esc(u.steam.name)}</span>`, '<span class="tag">Привязан</span>')
    : row(ICON.steam, 'Steam', '<span>Не привязан</span>', btn('steam', 'Привязать'));
  const tgRow = u.telegram
    ? row(TG, 'Telegram', `<span class="ok">@${esc(u.telegram.username)}</span>`, btn('tg-off', 'Отвязать'))
    : row(TG, 'Telegram', '<span>Не привязан</span>', tg ? '' : btn('tg-on', 'Привязать'));
  const panel = tg ? `
    <div class="tg-panel">
      <p>Откройте <b>${esc(tg.bot)}</b> в Telegram и отправьте боту:</p>
      <code>/start ${esc(tg.code)}</code>
      <div class="tg-actions"><button type="button" class="btn btn-primary btn-sm" data-act="tg-check"><span class="label">Я отправил(а)</span><span class="spinner" aria-hidden="true"></span></button>
      ${btn('tg-cancel', 'Отмена')}</div>
      <p class="err" id="tgErr" role="alert"></p>
    </div>` : '';
  return `<h2>Привязанные аккаунты</h2><p class="acc-sub">Steam подтверждает игрока, Telegram присылает уведомления о матчах.</p>${steam}${tgRow}${panel}`;
}

export default {
  layout: 'doc',
  protected: true,
  title: 'Личный кабинет',
  description: 'Профиль, привязанные аккаунты, команды и турниры игрока VOLOGDA AMATEUR LEAGUE.',

  render: () => {
    const u = getUser();
    return `
    <main class="acc">
      <section class="acc-hero">
        <div class="acc-avatar" aria-hidden="true">${esc(u.nick.slice(0, 1).toUpperCase())}</div>
        <div class="acc-id"><h1>${esc(u.nick)}</h1><p>${esc(u.email || '')}</p></div>
        <a href="/settings" class="btn btn-ghost btn-sm">Настройки</a>
        <button type="button" class="btn btn-ghost btn-sm" id="logoutBtn">Выйти</button>
      </section>
      <div class="banner" id="accNote" ${u.steam ? 'hidden' : ''}>Привяжите Steam, чтобы участвовать в турнирах: так мы подтверждаем игрока.</div>
      <div class="acc-grid">
        <section class="acc-card" id="linked">${linkedHtml(u)}</section>
        <section class="acc-card"><h2>Мои команды</h2>${empty('Вы пока не состоите в командах.', 'Создание и приглашения появятся на следующем этапе.')}</section>
        <section class="acc-card"><h2>Мои турниры</h2>${empty('Вы ещё не участвовали в турнирах.', 'Здесь появятся предстоящие и прошедшие турниры.')}</section>
        <section class="acc-card acc-wide"><h2>История матчей</h2>${empty('Матчей пока нет.', 'Результаты ваших игр будут собираться здесь.')}</section>
      </div>
    </main>`;
  },

  mount(root, { navigate }) {
    let alive = true, tg = null;
    const card = $('#linked', root), note = $('#accNote', root);
    const draw = () => { card.innerHTML = linkedHtml(getUser(), tg); note.hidden = !!getUser().steam; };
    const busy = (btn, v) => { btn.disabled = v; btn.classList.toggle('loading', v); };
    const fail = (e, el) => { const m = serverFallback(e instanceof ApiError ? e : new ApiError(0, 'network', ''), 'Не удалось выполнить. Попробуйте ещё раз.'); if (el) el.textContent = m; };

    if (motion) gsap.from($$('.acc-hero, .acc-card', root), { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act], #logoutBtn'); if (!btn || btn.disabled) return;
      const act = btn.dataset.act || 'logout';
      try {
        if (act === 'logout') { busy(btn, true); await account.logout().catch(() => {}); clearUser(); navigate('/'); return; }
        if (act === 'steam') { busy(btn, true); const r = await account.steamLink(); if (alive && r) { patchUser({ steam: r.steam }); draw(); } }
        if (act === 'tg-on') { busy(btn, true); tg = await account.telegramCode(); if (alive) draw(); }
        if (act === 'tg-cancel') { tg = null; draw(); }
        if (act === 'tg-check') { busy(btn, true); const r = await account.telegramCheck(); if (alive) { patchUser({ telegram: r.telegram }); tg = null; draw(); } }
        if (act === 'tg-off') { busy(btn, true); await account.telegramUnlink(); if (alive) { patchUser({ telegram: null }); draw(); } }
      } catch (err) { if (alive) { busy(btn, false); fail(err, $('#tgErr', root)); } }
    });
    return () => { alive = false; };
  },
};
