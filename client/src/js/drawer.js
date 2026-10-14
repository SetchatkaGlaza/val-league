import { gsap, motion, tween } from './ui.js';
import { fillSite } from './doc-effects.js';
import rulesHtml from '../views/partials/rules.html?raw';
import privacyHtml from '../views/partials/privacy.html?raw';

/**
 * Шторка с документом поверх страницы: регламент и политику можно прочитать,
 * не покидая формы (ничего не вводится заново и не открывается новая вкладка).
 */
const DOCS = {
  rules: { title: 'Регламент турниров', html: rulesHtml },
  privacy: { title: 'Политика конфиденциальности', html: privacyHtml },
};

let el, opener, opened = false, name = null, busy = false;

function build() {
  el = document.createElement('div');
  el.className = 'drawer';
  el.hidden = true;
  el.innerHTML = `
    <div class="drawer-backdrop" data-close></div>
    <section class="drawer-sheet" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" tabindex="-1">
      <header class="drawer-head">
        <h2 id="drawerTitle"></h2>
        <button type="button" class="drawer-close" data-close aria-label="Закрыть">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </header>
      <div class="drawer-body"></div>
    </section>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', (e) => {
    if (!opened) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') trapFocus(e);
  });
}

function trapFocus(e) {
  const f = [...el.querySelectorAll('a[href], button:not([disabled])')].filter((n) => n.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function content(doc) {
  const tpl = document.createElement('template');
  tpl.innerHTML = doc.html;
  const article = tpl.content.querySelector('.doc-body');
  article.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));   // чтобы не дублировать якоря страницы
  return article.outerHTML;
}

async function open(docName, from, fromHistory = false) {
  const doc = DOCS[docName];
  if (!doc || opened || busy) return;
  busy = true;
  if (!el) build();
  opener = from || document.activeElement;
  name = docName;
  el.querySelector('#drawerTitle').textContent = doc.title;
  const body = el.querySelector('.drawer-body');
  body.innerHTML = content(doc);
  body.scrollTop = 0;
  fillSite(body);

  if (!fromHistory) history.pushState({ ...history.state, drawer: docName }, '');   // «Назад» закроет шторку
  document.getElementById('root').inert = true;
  document.documentElement.style.overflow = 'hidden';
  el.hidden = false; opened = true;

  const sheet = el.querySelector('.drawer-sheet'), back = el.querySelector('.drawer-backdrop');
  if (motion) {
    const mobile = matchMedia('(max-width: 720px)').matches;
    gsap.fromTo(back, { opacity: 0 }, { opacity: 1, duration: .3 });
    await new Promise((resolve) => gsap.fromTo(sheet,
      mobile ? { yPercent: 100 } : { xPercent: 100 },
      { ...(mobile ? { yPercent: 0 } : { xPercent: 0 }), duration: .45, ease: 'power3.out', onComplete: resolve }));
  }
  sheet.focus({ preventScroll: true });
  busy = false;
}

/** Закрытие кнопкой/Esc идёт через history.back(), поэтому запись в истории не копится. */
function close() {
  if (!opened) return;
  if (history.state && history.state.drawer) history.back();   // popstate вызовет hide()
  else hide();
}

async function hide() {
  if (!opened) return;
  opened = false;
  const sheet = el.querySelector('.drawer-sheet'), back = el.querySelector('.drawer-backdrop');
  if (motion) {
    const mobile = matchMedia('(max-width: 720px)').matches;
    gsap.to(back, { opacity: 0, duration: .25 });
    await tween(sheet, { ...(mobile ? { yPercent: 100 } : { xPercent: 100 }), duration: .3, ease: 'power2.in' });
  }
  el.hidden = true;
  document.getElementById('root').inert = false;
  document.documentElement.style.overflow = '';
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null; name = null;
}

export const drawer = { open, hide, close, isOpen: () => opened };
