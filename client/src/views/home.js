import shield from '../assets/logo-shield.webp';
import { $, $$, gsap, motion } from '../js/ui.js';
import { getUser } from '../js/session.js';
import { SITE } from '../config.js';
import { tournaments, players, bracket } from '../js/api.js';
import { pickMatches, activityHtml, emptyActivity } from './home-activity.js';
import { esc } from './parts.js';
import { winnersHtml, ratingHtml } from './home-champions.js';
import { rub, dateLong, formatLine, feeLine, slotsLine, statusBadge, startCountdown, countdownHtml } from './tournament-parts.js';

const I = {
  online: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  fair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3Z"/><path d="M8.5 12l2.5 2.5L15.5 10"/></svg>',
  prize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 13v4M9 20h6"/></svg>',
};

const HOUR = 3600e3;

const MAPS = [['de_mirage', 'mirage', 'Mirage', 'map-a'], ['de_inferno', 'inferno', 'Inferno', 'map-b'], ['de_dust2', 'dust2', 'Dust II', 'map-c'], ['de_ancient', 'ancient', 'Ancient', 'map-d']];
const mapsHtml = () => MAPS.map(([id, f, name, cls], i) => { const n = String(i + 1).padStart(2, '0'); return `
  <li class="map ${cls}" data-map="${id}">
    <img src="/media/map-${f}.webp" srcset="/media/map-${f}-sm.webp 600w, /media/map-${f}.webp 1100w" sizes="(max-width: 767px) 80vw, 58vw" width="1100" height="${f === 'dust2' ? 687 : 619}" alt="Карта ${name}: игровая локация CS2" loading="lazy" decoding="async" />
    <span class="map-no" aria-hidden="true">${n}</span>
    <div class="map-cap"><span class="map-pool" hidden>В пуле турнира</span><h3>${name}</h3><p>Карта из пула лиги</p></div>
  </li>`; }).join('');

/** Отмечаем карты, которые входят в пул показанного турнира (данные из API, если они есть). */
function markPool(root, t) {
  const pool = t && Array.isArray(t.mapPool) ? t.mapPool : [];
  $$('.map', root).forEach((el) => { const chip = $('.map-pool', el); if (chip) chip.hidden = !pool.includes(el.dataset.map); });
}
const tUrl = (t) => `/tournaments/${t.slug}`;

/** Состояние блока: какую подпись, обратный отсчёт и кнопки показываем (данные только из API). */
function stateOf(t) {
  const start = new Date(t.startsAt).getTime(), left = start - Date.now();
  if (t.status === 'live') return { key: 'live', label: 'Турнир идёт' };
  if (t.status === 'finished') return { key: 'done', label: 'Турнир завершён' };
  if (t.status === 'cancelled') return { key: 'cancel', label: 'Турнир отменён' };
  if (t.status === 'upcoming') {
    const soon = left > 0 && left <= 24 * HOUR;
    return { key: soon ? 'soon' : 'upcoming', label: 'Ближайший турнир', timer: left > 0, soon, open: !!t.registrationOpen };
  }
  return { key: 'other', label: 'Ближайший турнир' };
}

const emptyHtml = (title, text, retry) => `
  <div class="nx-main">
    <p class="label">Ближайший турнир</p><h2 id="nextTitle">${title}</h2>
    <p class="next-empty">${text}</p>
    <div class="nx-actions">${retry ? '<button type="button" class="btn btn-ghost" data-retry>Повторить</button>' : '<a href="/tournaments" class="btn btn-ghost">Все турниры</a>'}</div>
  </div>`;

/** Блок «Ближайший турнир»: идущий или ближайший по дате. */
function nextHtml(t, user) {
  if (!t) return emptyHtml('Скоро анонсируем', 'Новый турнир уже готовится. Создайте аккаунт и соберите команду, чтобы успеть на регистрацию.');
  const st = stateOf(t), s = t.maxTeams ? slotsLine(t) : null;
  const showSlots = s && (st.key === 'upcoming' || st.key === 'soon');
  const regNote = st.key === 'upcoming' || st.key === 'soon' ? (st.open ? '' : '<p class="nx-note">Регистрация сейчас закрыта</p>') : '';
  const primary = st.open ? `<a href="${tUrl(t)}" class="btn btn-primary">Участвовать</a>`
    : `<a href="${tUrl(t)}" class="btn btn-primary">${st.key === 'live' ? 'Смотреть' : st.key === 'done' ? 'Итоги турнира' : 'Подробнее'}</a>`;
  const winner = st.key === 'done' && (t.winner?.name || t.podium?.first?.name);
  return `
    <div class="nx-main">
      <p class="label">${st.label} ${statusBadge(t)}${st.soon ? '<span class="nx-hot">Скоро старт</span>' : ''}</p>
      <h2 id="nextTitle"><a class="plain" href="${tUrl(t)}">${esc(t.name)}</a></h2>
      <dl class="nx-facts">
        <div><dt>Старт</dt><dd>${dateLong(t.startsAt)}<small>по вашему времени</small></dd></div>
        <div><dt>Формат</dt><dd>${formatLine(t)}</dd></div>
        <div><dt>Участие</dt><dd>${t.fee ? `${rub(t.fee)} с команды` : 'Бесплатно'}</dd></div>
      </dl>
      ${showSlots ? `<div class="slots"><div class="slots-bar"><i style="width:${s.pct}%"></i></div><span>${s.text} · ${s.left}</span></div>` : ''}
      ${winner ? `<p class="nx-winner">Победитель: <b>${esc(t.winner?.name || t.podium.first.name)}</b></p>` : ''}
    </div>
    <div class="nx-side">
      ${st.timer ? `<div class="next-timer"><p class="label">До старта</p>${countdownHtml(t.startsAt)}</div>`
        : st.key === 'upcoming' || st.key === 'soon' ? '<p class="nx-note">Старт вот-вот — обновляем данные…</p>' : ''}
      <div class="next-prize">
        <p class="label">Призовой фонд</p>
        <p class="prize">${t.prizeTotal ? rub(t.prizeTotal) : '—'}</p>
        ${regNote}
        <div class="nx-actions">${primary}<a href="/tournaments" class="btn btn-ghost">Все турниры</a></div>
      </div>
    </div>`;
}

/**
 * Hero: фоновое видео (только там, где уместно), прозрачная шапка поверх hero и мягкий параллакс.
 * Всё, что включено здесь, снимается функцией очистки.
 */
function initHero(root) {
  const hero = $('#hero', root), lay = document.querySelector('.layout-doc'), top = lay && $('.doc-top', lay);
  if (!hero || !lay || !top) return () => {};
  const off = [];
  lay.classList.add('on-home');
  off.push(() => lay.classList.remove('on-home', 'is-scrolled'));

  // Высота шапки нужна, чтобы hero начинался под ней без «прыжков»
  const setHdr = () => lay.style.setProperty('--hdr', `${top.offsetHeight}px`);
  setHdr();
  const ro = 'ResizeObserver' in window ? new ResizeObserver(setHdr) : null;
  ro && ro.observe(top);
  off.push(() => { ro && ro.disconnect(); lay.style.removeProperty('--hdr'); });

  // Плотный фон шапки после прокрутки и лёгкий параллакс фона: один пассивный обработчик на rAF
  const media = $('.hero-media', hero);
  let ticking = false;
  const frame = () => {
    ticking = false;
    const y = window.scrollY, h = hero.offsetHeight || 1, p = Math.min(1, Math.max(0, y / h));
    lay.classList.toggle('is-scrolled', y > 24);
    if (motion && media) hero.style.setProperty('--hp', p.toFixed(3));
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  off.push(() => window.removeEventListener('scroll', onScroll));
  frame();

  // Видео: только на широких экранах, без экономии трафика и без «меньше движения»; иначе остаётся постер
  const video = $('.hero-video', hero);
  const conn = navigator.connection || {};
  const canPlay = motion && video && matchMedia('(min-width: 768px)').matches && !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '');
  if (canPlay) {
    const src = (url, type) => { const s = document.createElement('source'); s.src = url; s.type = type; return s; };
    video.append(src('/media/val-arena-loop.webm', 'video/webm; codecs=vp9'), src('/media/val-arena-loop.mp4', 'video/mp4'));
    video.disableRemotePlayback = true;
    video.load();
    let inView = true, last = -1, stuck = 0;
    const want = () => inView && !document.hidden;
    const tryPlay = () => { const r = video.play(); r && r.catch(() => {}); };
    const sync = () => { if (want()) tryPlay(); else video.pause(); };
    const onPlaying = () => { hero.classList.add('video-on'); stuck = 0; };
    const onFail = () => hero.classList.remove('video-on');
    // Браузер мог сам поставить на паузу (экономия энергии, смена вкладки): возвращаем воспроизведение
    const onPause = () => { if (want() && !video.ended) setTimeout(() => want() && video.paused && tryPlay(), 250); };
    const onEnded = () => { video.currentTime = 0; tryPlay(); };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onFail);
    const vio = new IntersectionObserver(([en]) => { inView = en.isIntersecting; sync(); }, { threshold: 0.05 });
    vio.observe(hero);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pageshow', sync);
    // Страж: если кадр не движется, пока видео должно играть, подталкиваем его
    const dog = setInterval(() => {
      if (!want()) { stuck = 0; return; }
      if (video.paused) { tryPlay(); return; }
      if (video.currentTime === last) { if (++stuck >= 2) { stuck = 0; if (video.readyState < 3) video.load(); tryPlay(); } } else { stuck = 0; last = video.currentTime; }
    }, 2500);
    off.push(() => { clearInterval(dog); vio.disconnect(); document.removeEventListener('visibilitychange', sync); window.removeEventListener('pageshow', sync); ['playing', 'pause', 'ended', 'error'].forEach((n, k) => video.removeEventListener(n, [onPlaying, onPause, onEnded, onFail][k])); video.pause(); video.querySelectorAll('source').forEach((s) => s.remove()); video.load(); });
  }

  // Индикатор прокрутки
  const onClick = (e) => {
    const b = e.target.closest('[data-scroll]'); if (!b) return;
    const t = $(b.dataset.scroll, root); if (t) t.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'start' });
  };
  hero.addEventListener('click', onClick);
  off.push(() => hero.removeEventListener('click', onClick));
  return () => off.forEach((f) => f());
}

export default {
  layout: 'doc',
  title: '',
  description: 'VOLOGDA AMATEUR LEAGUE — онлайн-турниры по CS2 для любителей Вологды: призовой фонд, сетки, результаты и история побед.',

  render: () => {
    const user = getUser();
    return `
    <main class="home">
      <section class="hero" id="hero" aria-labelledby="heroTitle">
        <div class="hero-media" aria-hidden="true">
          <img class="hero-poster" src="/media/hero-poster.webp" srcset="/media/hero-poster-sm.webp 800w, /media/hero-poster.webp 1600w" sizes="100vw" width="1600" height="900" alt="" fetchpriority="high" decoding="async" />
          <video class="hero-video" muted loop playsinline preload="none" tabindex="-1"></video>
        </div>
        <div class="hero-shade" aria-hidden="true"></div>
        <div class="hero-inner">
          <div class="hero-copy">
            <p class="eyebrow">Онлайн-турниры по CS2 · Вологда</p>
            <h1 id="heroTitle"><span>Играй.</span> <span>Побеждай.</span> <span class="accent">Вологда.</span></h1>
            <p class="hero-sub">Собери команду, зарегистрируйся на турнир и поборись за призовой фонд. Сетки, результаты и история побед — в одном месте.</p>
            <div class="hero-cta">
              <a href="${user ? '/account' : '/register'}" class="btn btn-primary">${user ? 'Личный кабинет' : 'Создать аккаунт'}</a>
              <a href="/tournaments" class="btn btn-ghost">Смотреть турниры</a>
            </div>
          </div>
        </div>
        <button type="button" class="hero-scroll" data-scroll="#nextBox" aria-label="Прокрутить к ближайшему турниру"><span>Прокрутите</span><i aria-hidden="true"></i></button>
      </section>

      <section class="next" aria-labelledby="nextTitle" data-reveal>
        <img class="nx-cover" src="/media/tournament-cover.webp" srcset="/media/tournament-cover-sm.webp 800w, /media/tournament-cover.webp 1600w" sizes="(max-width: 1120px) 100vw, 1120px" width="1600" height="900" alt="" aria-hidden="true" decoding="async" fetchpriority="low" />
        <div class="nx-body" id="nextBox" aria-live="polite" aria-busy="true">
          <div class="nx-main"><p class="label">Ближайший турнир</p><h2 id="nextTitle">Загружаем…</h2><div class="sk sk-line"></div></div>
        </div>
      </section>

      <section class="act" aria-labelledby="actTitle" data-reveal>
        <p class="label">Матчи</p><h2 id="actTitle">Активность лиги</h2>
        <div id="actBody" aria-busy="true"><div class="sk sk-card"></div></div>
      </section>

      <section class="about" aria-labelledby="aboutTitle" data-reveal>
        <div class="about-cover">
          <img class="about-bg" src="/media/community-atmosphere.webp" srcset="/media/community-atmosphere-sm.webp 800w, /media/community-atmosphere.webp 1600w" sizes="(max-width: 1120px) 100vw, 1120px" width="1600" height="900" alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <div class="about-copy">
            <p class="label">Сообщество</p>
            <h2 id="aboutTitle">О лиге</h2>
            <p class="lead">VAL — турниры по Counter-Strike 2 для любителей Вологды. Играем онлайн, платим призы, ведём архив побед.</p>
            <a class="link" href="/rules" data-doc="rules">Читать регламент →</a>
          </div>
        </div>
        <div class="tiles">
          <article class="tile"><div class="tile-ic">${I.online}</div><h3>Играем онлайн</h3><p>Никуда ехать не нужно: лобби и сервер создаём мы, время и ссылки — на странице матча.</p></article>
          <article class="tile"><div class="tile-ic">${I.fair}</div><h3>Честная игра</h3><p>Античит, демо-записи и понятный регламент: спорные ситуации разбирает судейская коллегия.</p></article>
          <article class="tile"><div class="tile-ic">${I.prize}</div><h3>Призовые</h3><p>Призовой фонд и распределение по местам известны до начала регистрации.</p></article>
        </div>
      </section>

      <section class="maps" aria-labelledby="mapsTitle" data-reveal>
        <p class="label">Игровые локации</p><h2 id="mapsTitle">Карты CS2</h2>
        <ul class="maps-grid" role="list">${mapsHtml()}</ul>
      </section>

      <section class="champs" id="winBox" aria-labelledby="winTitle" data-reveal hidden>
        <p class="label">Чемпионы</p><h2 id="winTitle">Последние победители</h2>
        <div id="winGrid"></div>
        <a class="link" href="/winners">Весь архив победителей →</a>
      </section>

      <section class="rtop" id="ratBox" aria-labelledby="ratTitle" data-reveal hidden>
        <p class="label">Рейтинг</p><h2 id="ratTitle">Топ игроков</h2>
        <div id="ratList"></div>
        <a class="link" href="/rating">Вся таблица рейтинга →</a>
      </section>

      <section class="partners" aria-labelledby="partTitle" data-reveal>
        <div class="partner-invite">
          <div>
            <p class="label">Сотрудничество</p>
            <h2 id="partTitle">Партнёрам</h2>
            <p>Хотите показать свой бренд игрокам и зрителям лиги? Напишите нам, обсудим формат партнёрства.</p>
          </div>
          <a class="btn btn-ghost" href="mailto:${SITE.email}?subject=${encodeURIComponent('Партнёрство с VAL')}">Стать партнёром</a>
        </div>
      </section>

      <section class="cta-band" aria-labelledby="ctaTitle" data-reveal>
        <img class="cta-shield" src="${shield}" alt="" aria-hidden="true" width="620" height="806" loading="lazy" decoding="async" />
        <h2 id="ctaTitle">Твоя игра. <span class="accent">Твоя лига.</span></h2>
        <p>Присоединяйся к сообществу, создай команду и выходи на турниры VAL.</p>
        <div class="cta-actions">
          <a href="${user ? '/account' : '/register'}" class="btn btn-primary">${user ? 'Личный кабинет' : 'Создать аккаунт'}</a>
          <a href="/tournaments" class="btn btn-ghost">Смотреть турниры</a>
        </div>
      </section>
    </main>`;
  },

  mount(root) {
    let alive = true, stopCd = () => {};
    const user = getUser();
    const box = $('#nextBox', root), winBox = $('#winBox', root), ratBox = $('#ratBox', root);

    let lastNext = null, lastWinners = [];
    const showNext = (t) => {
      lastNext = t; markPool(root, t);
      stopCd();
      box.innerHTML = nextHtml(t, user); box.setAttribute('aria-busy', 'false');
      if (t && t.status === 'upcoming') stopCd = startCountdown(box, t.startsAt, () => setTimeout(() => alive && loadNext(), 4000));
    };
    async function loadNext() {
      try { const r = await tournaments.next(); if (alive) showNext(r.tournament); }
      catch (e) {
        if (!alive) return;
        box.innerHTML = emptyHtml('Не удалось загрузить', e.code === 'mock' ? 'В демо-режиме данные турниров недоступны.' : 'Проверьте соединение и попробуйте ещё раз.', true); box.setAttribute('aria-busy', 'false');
      }
    }
    async function loadWinners() {
      try {
        const r = await tournaments.winners(4);
        if (!alive || !r.winners.length) return;
        lastWinners = r.winners;
        $('#winGrid', root).innerHTML = winnersHtml(r.winners); winBox.hidden = false;
        if (io) { gsap.set(winBox, { opacity: 0, y: 28 }); io.observe(winBox); }
      } catch { /* блок победителей просто не показываем */ }
    }
    async function loadRating() {
      try {
        const r = await players.rating(8, 0);
        if (!alive || !r.players.length) return;
        $('#ratList', root).innerHTML = ratingHtml(r.players); ratBox.hidden = false;
        if (io) { gsap.set(ratBox, { opacity: 0, y: 28 }); io.observe(ratBox); }
      } catch { /* блок рейтинга просто не показываем */ }
    }
    root.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) { box.innerHTML = '<div class="nx-main"><div class="sk sk-line"></div></div>'; box.setAttribute('aria-busy', 'true'); loadNext(); } });

    // Появление блоков при прокрутке
    let io;
    const blocks = $$('[data-reveal]:not([hidden])', root);
    if (motion) {
      gsap.from($$('.hero-copy > *', root), { y: 26, opacity: 0, duration: .7, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
      gsap.set(blocks, { opacity: 0, y: 28 });
      io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { gsap.to(en.target, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', clearProps: 'transform' }); io.unobserve(en.target); }
      }), { rootMargin: '0px 0px -8% 0px' });
      blocks.forEach((b) => io.observe(b));
    }
    /** Матчи: сетка идущего турнира и, если есть, последнего завершённого. Только публичные данные. */
    async function loadActivity() {
      const out = $('#actBody', root);
      try {
        const jobs = [];
        if (lastNext && ['live', 'upcoming'].includes(lastNext.status)) jobs.push(bracket.get(lastNext.slug).then((d) => (d.preliminary ? null : pickMatches(d))));
        const last = lastWinners.find((w) => w.hasBracket && !(jobs.length && w.slug === lastNext?.slug));
        if (last) jobs.push(bracket.get(last.slug).then((d) => pickMatches(d, { upcoming: false })));
        const sets = (await Promise.all(jobs.map((j) => j.catch(() => null)))).filter(Boolean);
        if (!alive) return;
        out.innerHTML = sets.length ? activityHtml(sets) : emptyActivity();
      } catch { if (alive) out.innerHTML = emptyActivity(); }
      if (alive) out.setAttribute('aria-busy', 'false');
    }
    loadRating();
    Promise.allSettled([loadNext(), loadWinners()]).then(() => alive && loadActivity());
    const stopHero = initHero(root);
    return () => { alive = false; stopCd(); io && io.disconnect(); stopHero(); };
  },
};
