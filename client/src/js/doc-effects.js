import { gsap, motion, $$ } from './ui.js';
import { SITE } from '../config.js';

/** Подставляет реквизиты организатора в элементы с data-site. */
export function fillSite(root) {
  const values = { operator: SITE.operator, rulesUpdated: SITE.rulesUpdated, privacyUpdated: SITE.privacyUpdated };
  $$('[data-site]', root).forEach((el) => {
    const k = el.dataset.site;
    if (k === 'emailLink') { el.href = `mailto:${SITE.email}`; el.textContent = SITE.email; }
    else if (k === 'tgLink') { el.href = SITE.telegram; el.textContent = SITE.telegramLabel; }
    else el.textContent = values[k] ?? '';
  });
}

const bar = () => document.getElementById('progress');
export const resetProgress = () => { const b = bar(); if (b) b.style.transform = 'scaleX(0)'; };

/** Прогресс чтения, подсветка раздела в содержании и появление блоков. Возвращает cleanup. */
export function mountDoc(root) {
  fillSite(root);

  const onScroll = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar().style.transform = `scaleX(${h > 0 ? Math.min(scrollY / h, 1) : 0})`;
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const links = $$('.doc-toc a', root);
  const secs = links.map((a) => root.querySelector(a.getAttribute('href'))).filter(Boolean);
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  secs.forEach((s) => spy.observe(s));

  let io;
  if (motion) {
    gsap.from($$('.doc-body > h1, .doc-meta, .doc-intro', root), { y: 24, opacity: 0, duration: .7, stagger: .1, ease: 'power3.out', clearProps: 'transform' });
    gsap.set(secs, { opacity: 0, y: 24 });
    io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { gsap.to(en.target, { opacity: 1, y: 0, duration: .6, ease: 'power3.out', clearProps: 'transform' }); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    secs.forEach((s) => io.observe(s));
  }

  return () => {
    removeEventListener('scroll', onScroll);
    spy.disconnect(); io && io.disconnect();
    resetProgress();
  };
}
