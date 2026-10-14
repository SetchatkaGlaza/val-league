// Включает анимации, если пользователь не просил «меньше движения». Вынесено из index.html ради строгой CSP.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('motion');
