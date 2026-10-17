import { gsap, motion, $, tween, enterFields, morphSlot } from './ui.js';
import { layouts, updateNav, fadeOut } from './layouts.js';
import { resetProgress } from './doc-effects.js';
import { createRouter } from './router.js';
import { getUser } from './session.js';
import { resolve, notFound } from '../routes.js';

const root = document.getElementById('root');
const announcer = document.getElementById('announcer');
const SITE_TITLE = 'VOLOGDA AMATEUR LEAGUE';

let layoutName = null;
let layout = null;        // { el, slot }
let shown = null;         // текущая страница
let cleanup = null;       // отписка текущей страницы

function setMeta(view) {
  document.title = view.title ? `${view.title} — ${SITE_TITLE}` : SITE_TITLE;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && view.description) meta.setAttribute('content', view.description);
  announcer.textContent = document.title;
}

function runCleanup() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
}

/** Фокус на заголовок новой страницы: удобно для клавиатуры и скринридеров. */
function focusHeading() {
  const h = $('h1, h2, h3', layout.slot);
  if (!h) return;
  h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
}

async function onRoute(view, ctx) {   // view можно подменить на 404 (см. проверку админа ниже)
  // Закрытые страницы: без входа отправляем на /login и вернём обратно через ?next=
  // (вместе с ?token=… — иначе приглашение по ссылке потеряется после входа)
  if (view.protected && !getUser()) { router.navigate(`/login?next=${encodeURIComponent(ctx.path + (ctx.query.toString() ? `?${ctx.query}` : ''))}`, { replace: true }); return 'aborted'; }
  // Админка: не администратору показываем «не найдено» (сервер всё равно проверяет права сам)
  const role = getUser()?.role;
  if (view.admin && !['admin', 'moderator'].includes(role)) view = notFound;
  if (view.adminOnly && role !== 'admin') view = notFound;   // разделы только для администратора (журнал)
  const sameLayout = layoutName === view.layout;
  const first = !layout;

  // 1. Уход старой страницы
  if (layout) {
    runCleanup();
    if (sameLayout) {
      if (view.layout === 'auth') {
        const kids = [...layout.slot.children];
        if (motion && kids.length) await tween(kids, { opacity: 0, y: -8, duration: .18, ease: 'power2.in' });
      } else {
        await fadeOut(layout.slot, .2);
      }
    } else {
      resetProgress();
      await fadeOut(layout.el, .25);
    }
  }
  // Пока шла анимация ухода, пользователь кликнул дальше: этот переход отменяем, следующий дорисует экран
  if (ctx.stale()) { if (layout && !sameLayout) gsap.set(layout.el, { opacity: 1 }); return 'aborted'; }

  // 2. Смена каркаса (вход ↔ документы) или новый контент в том же каркасе
  if (!sameLayout) {
    if (layout) layout.el.remove();
    const made = layouts[view.layout].create();
    layout = made; layoutName = view.layout;
    document.body.dataset.layout = view.layout;
    root.appendChild(made.el);
    layout.slot.innerHTML = view.render(ctx);
    ctx.applyScroll();
    updateNav(ctx.path);
    layouts[view.layout].enter(made.el);
    if (view.layout === 'auth') enterFields(layout.slot, first ? .9 : .7);
    else if (motion) gsap.fromTo(layout.slot, { opacity: 0 }, { opacity: 1, duration: .3, clearProps: 'opacity' });
  } else if (view.layout === 'auth') {
    morphSlot(() => { layout.slot.innerHTML = view.render(ctx); });
    ctx.applyScroll();
    enterFields(layout.slot, .08);
  } else {
    // Контейнер страницы остаётся тем же, а обработчики прошлых страниц на нём копились (двойные вопросы «Заблокировать?»).
    // Заменяем его пустой копией: обработчики не копируются, id и классы сохраняются.
    const fresh = layout.slot.cloneNode(false);
    layout.slot.replaceWith(fresh);
    layout.slot = fresh;
    layout.slot.innerHTML = view.render(ctx);
    ctx.applyScroll();
    updateNav(ctx.path);
    if (motion) gsap.fromTo(layout.slot, { opacity: 0 }, { opacity: 1, duration: .3, clearProps: 'opacity' });
  }

  // 3. Подключаем логику страницы
  setMeta(view);
  shown = view;
  cleanup = view.mount ? view.mount(layout.slot, { ...ctx, navigate: router.navigate }) || null : null;
  // Фокус на заголовок — только если страница сама не поставила фокус в поле (автофокус на десктопе)
  if (!first && ctx.mode !== 'pop' && !layout.slot.contains(document.activeElement)) focusHeading();
}

const router = createRouter({ resolve, notFound, onRoute });
export const { navigate } = router;
export const start = () => router.start();
/** Сервер сказал, что сессии нет (истекла/заблокирован): обновляем шапку и уводим со закрытых страниц. */
export const onSessionLost = () => {
  updateNav(location.pathname);
  if (shown && shown.protected) router.navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
};
