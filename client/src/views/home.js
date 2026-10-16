import shield from '../assets/logo-shield.png';
import { $, $$, gsap, motion } from '../js/ui.js';
import { getUser } from '../js/session.js';
import { SITE } from '../config.js';
import { tournaments } from '../js/api.js';
import { esc } from './parts.js';
import { rub, dateLong, dateShort, formatLine, feeLine, slotsLine, statusBadge, startCountdown, countdownHtml } from './tournament-parts.js';

const I = {
  online: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  fair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3Z"/><path d="M8.5 12l2.5 2.5L15.5 10"/></svg>',
  prize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 13v4M9 20h6"/></svg>',
};

const CTA = (user, t) => (t && t.status === 'upcoming' && t.registrationOpen ? `/tournaments/${t.slug}` : user ? '/tournaments' : '/register');

/** Блок «Ближайший турнир»: идущий или ближайший по дате. */
function nextHtml(t, user) {
  if (!t) return `
    <div class="next-main"><p class="label">Ближайший турнир</p><h2 id="nextTitle">Скоро анонсируем</h2>
      <p class="next-empty">Новый турнир уже готовится. Создайте аккаунт и соберите команду, чтобы успеть на регистрацию.</p></div>
    <div class="next-prize"><a href="/tournaments" class="btn btn-ghost">Все турниры</a></div>`;
  const s = slotsLine(t), live = t.status === 'live';
  return `
    <div class="next-main">
      <p class="label">${live ? 'Турнир идёт' : 'Ближайший турнир'} ${statusBadge(t)}</p>
      <h2 id="nextTitle"><a class="plain" href="/tournaments/${esc(t.slug)}">${esc(t.name)}</a></h2>
      <ul class="chips">
        <li>${dateLong(t.startsAt)} (по вашему времени)</li><li>${formatLine(t)}</li><li>${feeLine(t)}</li>
      </ul>
      <div class="slots"><div class="slots-bar"><i style="width:${s.pct}%"></i></div><span>${s.text} · ${s.left}</span></div>
    </div>
    ${live ? '' : `<div class="next-timer"><p class="label">До старта</p>${countdownHtml(t.startsAt)}</div>`}
    <div class="next-prize">
      <p class="label">Призовой фонд</p>
      <p class="prize">${t.prizeTotal ? rub(t.prizeTotal) : '—'}</p>
      <a href="${CTA(user, t)}" class="btn btn-primary">${live ? 'Смотреть' : t.registrationOpen ? 'Участвовать' : 'Подробнее'}</a>
    </div>`;
}

const winnersHtml = (list) => list.map((w) => `
  <article class="win">
    <p class="win-t">${esc(w.tournament)} · ${dateShort(w.date)}</p>
    <h3>${esc(w.team)}</h3>
    ${w.roster.length ? `<p class="win-roster">${w.roster.map(esc).join(' · ')}</p>` : ''}
    ${w.prize ? `<p class="win-prize">Приз: ${rub(w.prize)}</p>` : ''}
  </article>`).join('');

export default {
  layout: 'doc',
  title: '',
  description: 'VOLOGDA AMATEUR LEAGUE — онлайн-турниры по CS2 для любителей Вологды: призовой фонд, сетки, результаты и история побед.',

  render: () => {
    const user = getUser();
    return `
    <main class="home">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Онлайн-турниры по CS2 · Вологда</p>
          <h1>Играй. Побеждай.<br /><span>Вологда.</span></h1>
          <p class="hero-sub">Собери команду, зарегистрируйся на турнир и поборись за призовой фонд. Сетки, результаты и история побед — в одном месте.</p>
          <div class="hero-cta">
            <a href="${user ? '/account' : '/register'}" class="btn btn-primary">${user ? 'Личный кабинет' : 'Создать аккаунт'}</a>
            <a href="/rules" class="btn btn-ghost">Регламент</a>
          </div>
        </div>
        <img class="hero-shield" src="${shield}" alt="VOLOGDA AMATEUR LEAGUE CS2" width="360" />
      </section>

      <section class="next" id="nextBox" aria-labelledby="nextTitle" aria-live="polite" data-reveal>
        <div class="next-main"><p class="label">Ближайший турнир</p><h2 id="nextTitle">Загружаем…</h2><div class="sk sk-line"></div></div>
      </section>

      <section class="about" aria-labelledby="aboutTitle" data-reveal>
        <h2 id="aboutTitle">О лиге</h2>
        <p class="lead">VAL — турниры по Counter-Strike 2 для любителей Вологды. Играем онлайн, платим призы, ведём архив побед.</p>
        <div class="tiles">
          <article class="tile"><div class="tile-ic">${I.online}</div><h3>Играем онлайн</h3><p>Никуда ехать не нужно: лобби и сервер создаём мы, время и ссылки — на странице матча.</p></article>
          <article class="tile"><div class="tile-ic">${I.fair}</div><h3>Честная игра</h3><p>Античит, демо-записи и понятный регламент: спорные ситуации разбирает судейская коллегия.</p></article>
          <article class="tile"><div class="tile-ic">${I.prize}</div><h3>Призовые</h3><p>Призовой фонд и распределение по местам известны до начала регистрации.</p></article>
        </div>
      </section>

      <section class="winners" id="winBox" aria-labelledby="winTitle" data-reveal hidden>
        <h2 id="winTitle">Последние победители</h2>
        <div class="win-grid" id="winGrid"></div>
        <a class="link" href="/tournaments?tab=past">Все прошедшие турниры →</a>
      </section>

      <section class="partners" aria-labelledby="partTitle" data-reveal>
        <h2 id="partTitle">Партнёры</h2>
        <div class="partner-grid">
          ${[1, 2, 3, 4].map(() => '<div class="partner">Здесь может быть ваш логотип</div>').join('')}
        </div>
        <a class="link" href="mailto:${SITE.email}?subject=${encodeURIComponent('Партнёрство с VAL')}">Стать партнёром →</a>
      </section>

      ${user ? '' : `
      <section class="cta-band" data-reveal>
        <h2>Готов к турниру?</h2>
        <p>Создай аккаунт, собери команду и займи место в сетке.</p>
        <a href="/register" class="btn btn-primary">Создать аккаунт</a>
      </section>`}
    </main>`;
  },

  mount(root) {
    let alive = true, stopCd = () => {};
    const user = getUser();
    const box = $('#nextBox', root), winBox = $('#winBox', root);

    const showNext = (t) => {
      stopCd();
      box.innerHTML = nextHtml(t, user);
      if (t && t.status === 'upcoming') stopCd = startCountdown(box, t.startsAt, () => setTimeout(() => alive && loadNext(), 4000));
    };
    async function loadNext() {
      try { const r = await tournaments.next(); if (alive) showNext(r.tournament); }
      catch (e) {
        if (!alive) return;
        box.innerHTML = `<div class="next-main"><p class="label">Ближайший турнир</p><h2 id="nextTitle">Не удалось загрузить</h2><p class="next-empty">${e.code === 'mock' ? 'В демо-режиме данные турниров недоступны.' : 'Проверьте соединение и попробуйте ещё раз.'}</p></div>
          <div class="next-prize"><button type="button" class="btn btn-ghost" data-retry>Повторить</button></div>`;
      }
    }
    async function loadWinners() {
      try {
        const r = await tournaments.winners(3);
        if (!alive || !r.winners.length) return;
        $('#winGrid', root).innerHTML = winnersHtml(r.winners); winBox.hidden = false;
        if (io) { gsap.set(winBox, { opacity: 0, y: 28 }); io.observe(winBox); }
      } catch { /* блок победителей просто не показываем */ }
    }
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) { box.innerHTML = '<div class="next-main"><div class="sk sk-line"></div></div>'; loadNext(); } });

    // Появление блоков при прокрутке
    let io;
    const blocks = $$('[data-reveal]:not([hidden])', root);
    if (motion) {
      gsap.from($$('.hero-copy > *, .hero-shield', root), { y: 26, opacity: 0, duration: .7, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
      gsap.set(blocks, { opacity: 0, y: 28 });
      io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { gsap.to(en.target, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', clearProps: 'transform' }); io.unobserve(en.target); }
      }), { rootMargin: '0px 0px -8% 0px' });
      blocks.forEach((b) => io.observe(b));
    }
    loadNext(); loadWinners();
    return () => { alive = false; stopCd(); io && io.disconnect(); };
  },
};
