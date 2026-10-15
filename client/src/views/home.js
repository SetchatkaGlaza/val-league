import shield from '../assets/logo-shield.png';
import { $, $$, gsap, motion } from '../js/ui.js';
import { getUser } from '../js/session.js';
import { SITE } from '../config.js';
import { nextTournament as T, winners } from '../data/demo.js';
import { esc } from './parts.js';

const rub = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
const dateFmt = (d) => new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d);
const pad = (n) => String(n).padStart(2, '0');

const I = {
  online: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  fair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3Z"/><path d="M8.5 12l2.5 2.5L15.5 10"/></svg>',
  prize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 13v4M9 20h6"/></svg>',
};

const cd = (k, label) => `<div class="cd-box"><b data-cd="${k}">00</b><span>${label}</span></div>`;

export default {
  layout: 'doc',
  title: '',
  description: 'VOLOGDA AMATEUR LEAGUE — онлайн-турниры по CS2 для любителей Вологды: призовой фонд, сетки, результаты и история побед.',

  render: () => {
    const user = getUser();
    const pct = Math.round((T.slots.taken / T.slots.total) * 100);
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

      <section class="next" aria-labelledby="nextTitle" data-reveal>
        <div class="next-main">
          <p class="label">Ближайший турнир</p>
          <h2 id="nextTitle">${esc(T.name)}</h2>
          <ul class="chips">
            <li>${dateFmt(T.startsAt)} (по вашему времени)</li>
            <li>${esc(T.format)}</li>
            <li>Взнос: ${T.fee ? rub(T.fee) + ' с команды' : 'бесплатно'}</li>
          </ul>
          <div class="slots"><div class="slots-bar"><i style="width:${pct}%"></i></div><span>Занято мест: <b>${T.slots.taken}</b> из ${T.slots.total}</span></div>
        </div>
        <div class="next-timer">
          <p class="label">До старта</p>
          <time class="cd" id="cd" datetime="${T.startsAt.toISOString()}">${cd('d', 'дн')}${cd('h', 'ч')}${cd('m', 'мин')}${cd('s', 'сек')}</time>
        </div>
        <div class="next-prize">
          <p class="label">Призовой фонд</p>
          <p class="prize">${rub(T.prize)}</p>
          <a href="${user ? '/account' : '/register'}" class="btn btn-primary">Участвовать</a>
        </div>
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

      <section class="winners" aria-labelledby="winTitle" data-reveal>
        <h2 id="winTitle">Последние победители</h2>
        <div class="win-grid">
          ${winners.map((w) => `
          <article class="win">
            <p class="win-t">${esc(w.tournament)} · ${esc(w.date)}</p>
            <h3>${esc(w.place)}</h3>
            <p class="win-roster">${w.roster.map(esc).join(' · ')}</p>
            <p class="win-prize">Приз: ${rub(w.prize)}</p>
          </article>`).join('')}
        </div>
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
    // Таймер до старта
    const els = { d: $('[data-cd="d"]', root), h: $('[data-cd="h"]', root), m: $('[data-cd="m"]', root), s: $('[data-cd="s"]', root) };
    const tick = () => {
      let left = Math.max(0, Math.floor((T.startsAt - Date.now()) / 1000));
      const d = Math.floor(left / 86400); left -= d * 86400;
      const h = Math.floor(left / 3600); left -= h * 3600;
      const m = Math.floor(left / 60);
      els.d.textContent = pad(d); els.h.textContent = pad(h); els.m.textContent = pad(m); els.s.textContent = pad(left % 60);
    };
    tick();
    const timer = setInterval(tick, 1000);

    // Появление блоков при прокрутке
    let io;
    const blocks = $$('[data-reveal]', root);
    if (motion) {
      gsap.from($$('.hero-copy > *, .hero-shield', root), { y: 26, opacity: 0, duration: .7, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
      gsap.set(blocks, { opacity: 0, y: 28 });
      io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { gsap.to(en.target, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', clearProps: 'transform' }); io.unobserve(en.target); }
      }), { rootMargin: '0px 0px -8% 0px' });
      blocks.forEach((b) => io.observe(b));
    }
    return () => { clearInterval(timer); io && io.disconnect(); };
  },
};
