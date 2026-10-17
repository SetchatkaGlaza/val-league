import { gsap, motion, $, $$, tween } from './ui.js';
import { getUser } from './session.js';
import { loadSite, applySite } from './site.js';
import shield from '../assets/logo-shield.png';
import logoHeader from '../assets/logo-header.png';

export const assets = { shield, logoHeader };

const AUTH = `
<div class="layout layout-auth">
  <main class="auth">
    <section class="brand" aria-label="О лиге">
      <img class="brand-shield reveal" src="${shield}" alt="VOLOGDA AMATEUR LEAGUE CS2" width="310" />
      <h1 class="brand-title reveal">Играй. Побеждай.<br /><span>Вологда.</span></h1>
      <ul class="brand-list">
        <li class="reveal">Онлайн-турниры по CS2 с призовым фондом</li>
        <li class="reveal">Регистрация команды в пару кликов</li>
        <li class="reveal">Сетки, результаты и история побед</li>
      </ul>
    </section>
    <section class="panel">
      <div class="card" id="card">
        <a href="/" class="card-logo" aria-label="На главную"><img src="${logoHeader}" alt="VAL" width="150" /></a>
        <div id="slot" class="slot"></div>
      </div>
      <p class="legal">Продолжая, вы соглашаетесь с <a href="/rules" data-doc="rules">регламентом</a> и <a href="/privacy" data-doc="privacy">политикой конфиденциальности</a>.</p>
    </section>
  </main>
</div>`;

const BURGER = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path class="b1" d="M4 7h16"/><path class="b2" d="M4 12h16"/><path class="b3" d="M4 17h16"/></svg>';

const DOC = `
<div class="layout layout-doc">
  <div class="site-banner" id="siteBanner" role="status" hidden></div>
  <header class="doc-top">
    <a href="/" class="doc-logo" aria-label="На главную"><img src="${logoHeader}" alt="VAL" width="120" /></a>
    <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="docNav" aria-label="Открыть меню">${BURGER}</button>
    <nav class="doc-nav" id="docNav" aria-label="Разделы">
      <a href="/tournaments" data-nav="/tournaments">Турниры</a>
      <a href="/teams" data-nav="/teams">Команды</a>
      <a href="/winners" data-nav="/winners">Победители</a>
      <a href="/rating" data-nav="/rating">Рейтинг</a>
      <a href="/rules" data-nav="/rules">Регламент</a>
      <a href="/admin" data-nav="/admin" class="doc-admin" hidden>Админка</a>
      <a href="/login" class="doc-login">Войти</a>
    </nav>
  </header>
  <div id="slot" class="doc-slot"></div>
  <footer class="doc-foot">© <span id="year"></span> VOLOGDA AMATEUR LEAGUE · <a href="/tournaments">Турниры</a> · <a href="/teams">Команды</a> · <a href="/winners">Победители</a> · <a href="/rating">Рейтинг</a> · <a href="/rules">Регламент</a> · <a href="/privacy">Конфиденциальность</a><p class="foot-contacts" id="footContacts" hidden></p></footer>
</div>`;

function make(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

export const layouts = {
  auth: {
    create() {
      const el = make(AUTH);
      return { el, slot: $('#slot', el) };
    },
    /** Появление бренд-блока и карточки (первая загрузка или возврат из документов). */
    enter(el) {
      if (!motion) return;
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .fromTo($('.brand-shield', el), { y: 30, scale: .92, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .9 })
        .fromTo($('.brand-title', el), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, '-=.6')
        .fromTo($$('.brand-list li', el), { x: -20, opacity: 0 }, { x: 0, opacity: 1, duration: .5, stagger: .1 }, '-=.4')
        .fromTo($('#card', el), { y: 40, scale: .97, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .8, clearProps: 'transform' }, .1);
    },
  },
  doc: {
    create() {
      const el = make(DOC);
      $('#year', el).textContent = new Date().getFullYear();
      loadSite().then((s) => applySite(el, s));
      $('#navToggle', el).addEventListener('click', () => setMenu(el, !$('#docNav', el).classList.contains('open')));
      return { el, slot: $('#slot', el) };
    },
    enter(el) {
      if (!motion) return;
      gsap.from($('.doc-top', el), { y: -14, opacity: 0, duration: .5, ease: 'power3.out', clearProps: 'transform' });
    },
  },
};

/** Мобильное меню: открывается кнопкой, закрывается кликом по пункту, вне меню и клавишей Esc. */
function setMenu(el, open) {
  const nav = $('#docNav', el), btn = $('#navToggle', el);
  if (!nav || !btn) return;
  nav.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}
const closeMenu = () => { const el = document.querySelector('.layout-doc'); if (el) setMenu(el, false); };
document.addEventListener('click', (e) => { if (!e.target.closest('.doc-top')) closeMenu(); else if (e.target.closest('.doc-nav a')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const t = document.getElementById('navToggle'); if (t && t.getAttribute('aria-expanded') === 'true') { closeMenu(); t.focus(); } } });

/** Подсветка текущего раздела в шапке; «Админка» видна только администраторам. */
export function updateNav(path) {
  $$('.doc-nav a[data-nav]').forEach((a) => {
    const n = a.dataset.nav;
    if (path === n || path.startsWith(`${n}/`)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const me = $('.doc-login'), user = getUser(), adm = $('.doc-admin');
  if (me) { me.textContent = user ? user.nick : 'Войти'; me.setAttribute('href', user ? '/account' : '/login'); }
  if (adm) adm.hidden = !['admin', 'moderator'].includes(user?.role);
  closeMenu();
}

export const fadeOut = (el, d = .22) => (motion ? tween(el, { opacity: 0, duration: d, ease: 'power2.in' }) : Promise.resolve());
