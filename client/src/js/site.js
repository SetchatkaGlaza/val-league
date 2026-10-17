import { siteSettings } from './api.js';

// Публичные настройки сайта (этап 8.4): баннер объявления и контакты в подвале. Грузим один раз за открытие сайта;
// если сервер не ответил, сайт работает как обычно, просто без баннера и контактов.
let cached = null;
export const loadSite = () => (cached ??= siteSettings().catch(() => { cached = null; return null; }));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOCIAL_NAME = { telegram: 'Telegram', vk: 'ВКонтакте', discord: 'Discord', youtube: 'YouTube' };
const KEY = 'val.banner.closed';
const closed = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const remember = (t) => { try { sessionStorage.setItem(KEY, t); } catch { /* без хранилища баннер просто покажется снова */ } };

/** Разметка контактов подвала; только https-ссылки и почта, которые прошли проверку на сервере. */
export function contactsHtml(s) {
  const parts = [];
  if (s?.contactEmail) parts.push(`<a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a>`);
  for (const [k, url] of Object.entries(s?.social ?? {})) if (SOCIAL_NAME[k] && /^https:\/\//.test(url)) parts.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${SOCIAL_NAME[k]}</a>`);
  return parts.length ? `Связь: ${parts.join(' · ')}` : '';
}

/** Показывает баннер и контакты в раскладке сайта (layout-doc). Баннер можно закрыть до конца сессии. */
export function applySite(el, s) {
  if (!el) return;
  const box = el.querySelector('#siteBanner'), foot = el.querySelector('#footContacts');
  if (foot) { foot.innerHTML = s ? contactsHtml(s) : ''; foot.hidden = !foot.innerHTML; }
  if (!box) return;
  if (!s?.banner || closed() === s.banner.text) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = `<p>${esc(s.banner.text)}</p><button type="button" class="site-banner-x" aria-label="Закрыть объявление">×</button>`;
  box.hidden = false;
  box.querySelector('button').addEventListener('click', () => { remember(s.banner.text); box.hidden = true; });
}

/** Перечитать настройки (после сохранения в админке) и обновить уже открытую раскладку. */
export async function refreshSite() {
  cached = null;
  applySite(document.querySelector('.layout-doc'), await loadSite());
}
