import shield from '../assets/logo-shield.png';
import { $, motion, gsap } from '../js/ui.js';

const reveal = (root) => {
  if (!motion) return;
  gsap.from($('.stub', root).children, { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform' });
};

export const home = {
  layout: 'doc',
  title: '',
  description: 'VOLOGDA AMATEUR LEAGUE — онлайн-турниры по CS2 для любителей Вологды.',
  render: () => `
    <main class="stub">
      <img src="${shield}" alt="VOLOGDA AMATEUR LEAGUE CS2" width="180" />
      <h1>VAL — главная скоро</h1>
      <p>Мы собираем сайт лиги. А пока можно создать аккаунт и изучить регламент.</p>
      <div class="stub-actions">
        <a href="/login" class="btn btn-primary">Войти</a>
        <a href="/register" class="btn btn-ghost">Зарегистрироваться</a>
      </div>
    </main>`,
  mount: reveal,
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
