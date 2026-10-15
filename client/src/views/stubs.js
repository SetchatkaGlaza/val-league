import shield from '../assets/logo-shield.png';
import { $, motion, gsap } from '../js/ui.js';

const reveal = (root) => {
  if (!motion) return;
  gsap.from($('.stub', root).children, { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform' });
};

export const notFound = {
  layout: 'doc',
  title: 'Страница не найдена',
  description: 'Такой страницы нет на сайте VOLOGDA AMATEUR LEAGUE.',
  render: () => `
    <main class="stub">
      <p class="stub-code">404</p>
      <h1>Страница не найдена</h1>
      <p>Возможно, ссылка устарела или в адресе опечатка.</p>
      <div class="stub-actions"><a href="/" class="btn btn-primary">На главную</a></div>
    </main>`,
  mount: reveal,
};
