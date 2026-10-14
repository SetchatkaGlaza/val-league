import { drawer } from './drawer.js';

/** Приводим адрес к чистому виду: /login.html → /login, лишние слэши убираем. */
export const normPath = (p) => {
  let path = p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
};

const NON_PAGE = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|txt|xml|json|zip)$/i;
const key = (u) => normPath(u.pathname) + u.search;

/**
 * Клиентский роутер на History API: переходы без перезагрузки страницы.
 * onRoute(route, ctx) отвечает за показ страницы (анимации и т. п.).
 */
export function createRouter({ routes, notFound, onRoute }) {
  let renderedKey = null;   // что сейчас на экране
  let latest = 0;           // номер последнего запрошенного перехода
  let queue = Promise.resolve();
  history.scrollRestoration = 'manual';

  const scrollToHash = (hash, smooth) => {
    const el = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return false;
    el.scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto', block: 'start' });
    return true;
  };

  function render(mode, savedY = 0) {
    const url = new URL(location.href);
    const id = ++latest;
    const k = key(url);
    queue = queue.then(async () => {
      if (id !== latest || k === renderedKey) return;   // пока ждали, пришёл более новый переход
      const path = normPath(url.pathname);
      const ctx = {
        path, mode, query: url.searchParams, hash: url.hash,
        stale: () => id !== latest,
        /** Вызывается страницей, когда новый контент уже в DOM: возвращает/сбрасывает скролл. */
        applyScroll() {
          if (mode === 'pop') window.scrollTo(0, savedY);
          else if (!scrollToHash(url.hash, false)) window.scrollTo(0, 0);
        },
      };
      let result;
      try { result = await onRoute(routes[path] || notFound, ctx); }
      catch (e) { console.error('Ошибка перехода', e); }
      // 'aborted': старая страница уже убрана, а новая не показана — следующий переход обязан отрисоваться заново
      if (result === 'aborted') renderedKey = null;
      else if (id === latest) renderedKey = k;
    });
    return queue;
  }

  function navigate(to, { replace = false } = {}) {
    const u = new URL(to, location.href);
    if (u.origin !== location.origin) { location.assign(u.href); return; }
    const same = key(u) === key(new URL(location.href));
    if (same) {                                      // тот же экран: только якорь или скролл наверх
      if (!scrollToHash(u.hash, true)) window.scrollTo({ top: 0, behavior: 'smooth' });
      if (u.hash && u.hash !== location.hash) history.replaceState(history.state, '', normPath(u.pathname) + u.search + u.hash);
      return;
    }
    history.replaceState({ ...history.state, y: scrollY }, '');   // запоминаем скролл уходящей страницы
    const url = normPath(u.pathname) + u.search + u.hash;
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
    render(replace ? 'replace' : 'push');
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || 'external' in a.dataset) return;
    if (a.dataset.doc) { e.preventDefault(); drawer.open(a.dataset.doc, a); return; }
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.pathname.startsWith('/api') || NON_PAGE.test(u.pathname)) return;
    e.preventDefault();
    navigate(u.href);
  });

  addEventListener('popstate', (e) => {
    if (drawer.isOpen()) { drawer.hide(); return; }              // «Назад» закрывает шторку, а не уходит со страницы
    if (e.state && e.state.drawer) { drawer.open(e.state.drawer, null, true); return; }
    const url = new URL(location.href);
    if (key(url) === renderedKey) { scrollToHash(url.hash, true); return; }
    render('pop', (e.state && e.state.y) || 0);
  });

  return {
    navigate,
    start() {
      const url = new URL(location.href);
      const clean = normPath(url.pathname);
      if (clean !== url.pathname) history.replaceState(history.state, '', clean + url.search + url.hash);   // /login.html → /login
      return render('init');
    },
  };
}
