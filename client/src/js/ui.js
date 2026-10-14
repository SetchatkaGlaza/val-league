import gsap from 'gsap';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const motion = document.documentElement.classList.contains('motion');
export { gsap };

export const finePointer = () => matchMedia('(pointer: fine)').matches;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Твин как промис: await tween(el, { opacity: 0 }). */
export const tween = (targets, vars) =>
  new Promise((resolve) => gsap.to(targets, { ...vars, onComplete: resolve }));

/** Поэтапное появление полей и блоков с классом .reveal-field. */
export function enterFields(root, delay = 0) {
  const items = $$('.reveal-field', root);
  if (!items.length) return;
  if (!motion) return;
  gsap.fromTo(items, { y: 16, opacity: 0 },
    { y: 0, opacity: 1, duration: .5, stagger: .06, delay, ease: 'power3.out', clearProps: 'transform' });
}

/**
 * Плавно меняет содержимое слота карточки: высота анимируется, а не прыгает.
 * mutate() синхронно подменяет DOM внутри слота.
 */
export function morphSlot(mutate) {
  const slot = $('#slot');
  if (!motion) { mutate(); return; }
  gsap.killTweensOf(slot);
  const from = slot.offsetHeight;
  slot.style.height = from + 'px'; slot.style.overflow = 'hidden';
  mutate();
  slot.style.height = 'auto';
  const to = slot.offsetHeight;
  slot.style.height = from + 'px';
  gsap.to(slot, { height: to, duration: .45, ease: 'power3.inOut', onComplete: () => { slot.style.height = ''; slot.style.overflow = ''; } });
}

/**
 * Заменяет содержимое слота: старое уходит, высота плавно подстраивается, новое появляется.
 * alive() — защита: если страницу уже покинули, пока шла анимация, DOM не трогаем (вернёт false).
 */
export async function setSlot(html, alive = () => true) {
  const slot = $('#slot');
  if (motion && slot.children.length) await tween([...slot.children], { opacity: 0, y: -8, duration: .18, ease: 'power2.in' });
  if (!alive()) return false;
  morphSlot(() => { slot.innerHTML = html; });
  enterFields(slot, .08);
  return true;
}

/** Показ пароля и Caps Lock для всех парольных полей в текущем DOM. */
export function passwordHelpers() {
  document.querySelectorAll('.eye').forEach((btn) => {
    const input = document.getElementById(btn.dataset.target);
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      input.focus();
    });
  });
  document.querySelectorAll('[data-caps]').forEach((hint) => {
    const input = document.getElementById(hint.dataset.caps);
    const upd = (e) => { hint.hidden = !(e.getModifierState && e.getModifierState('CapsLock')); };
    input.addEventListener('keydown', upd); input.addEventListener('keyup', upd);
    input.addEventListener('blur', () => (hint.hidden = true));
  });
}

// Пока кнопка мыши/палец прижаты, не показываем ошибки: иначе при уходе фокуса из поля текст ошибки
// сдвигает ссылку под курсором, и клик по ней теряется («Забыли пароль?», «Зарегистрироваться»).
let pointerDown = false;
addEventListener('pointerdown', () => { pointerDown = true; }, true);
addEventListener('pointerup', () => { pointerDown = false; }, true);
addEventListener('pointercancel', () => { pointerDown = false; }, true);
const afterPointerUp = (fn) => addEventListener('pointerup', () => setTimeout(fn, 0), { once: true, capture: true });

/** Валидация, баннер, состояние загрузки и анимации формы. */
export function formKit(form, rules) {
  const card = $('#card'), banner = $('#banner'), btn = $('#submitBtn');
  const touched = new Set();
  let busy = false;

  const setError = (name, msg) => {
    const field = $(`[data-field="${name}"]`), el = form[name];
    field.classList.toggle('invalid', !!msg);
    field.classList.toggle('valid', !msg && !!el.value && el.type !== 'checkbox');
    $(`#${name}-err`).textContent = msg;
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  };
  const check = (name) => setError(name, rules[name](form[name].type === 'checkbox' ? form[name].checked : form[name].value, form));
  const hide = () => { banner.hidden = true; };
  const show = (html, ok = false) => {
    banner.className = 'banner' + (ok ? ' ok' : '');
    banner.innerHTML = html; banner.hidden = false;
    if (motion) gsap.fromTo(banner, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: .35, ease: 'power2.out' });
  };
  const shake = () => motion && gsap.fromTo(card, { x: -10 }, { x: 0, duration: .6, ease: 'elastic.out(1, .25)', clearProps: 'x' });

  Object.keys(rules).forEach((name) => {
    const el = form[name];
    if (el.type === 'checkbox') el.addEventListener('change', () => { touched.add(name); check(name); });
    else el.addEventListener('blur', () => {
      if (!el.value && !touched.has(name)) return;        // пустое поле ругается только при отправке формы
      const run = () => { if (document.body.contains(el)) { touched.add(name); check(name); } };
      if (pointerDown) afterPointerUp(run); else run();
    });
    el.addEventListener('input', () => { hide(); if (touched.has(name)) check(name); });
  });

  return {
    setError, check, show, hide, shake, touched,
    /** true, если все поля корректны; иначе фокус на первом ошибочном. */
    validateAll() {
      const names = Object.keys(rules);
      const bad = names.filter((n) => { touched.add(n); return !check(n); });
      if (bad.length) { shake(); form[bad[0]].focus(); }
      return !bad.length;
    },
    isBusy: () => busy,
    setBusy(v, idle, working) {
      busy = v; btn.disabled = v; btn.classList.toggle('loading', v);
      btn.querySelector('.label').textContent = v ? working : idle;
      form.querySelectorAll('input').forEach((i) => (i.readOnly = v));
    },
    /** Плавная смена блока внутри карточки (форма → результат). */
    swap(from, to) {
      if (!motion) { from.hidden = true; to.hidden = false; return; }
      gsap.to(from, {
        opacity: 0, y: -10, duration: .22, ease: 'power2.in',
        onComplete: () => {
          morphSlot(() => { from.hidden = true; gsap.set(from, { clearProps: 'all' }); to.hidden = false; });
          gsap.fromTo(to, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .45, ease: 'power3.out', clearProps: 'transform' });
        },
      });
    },
  };
}

/** Кулдаун для кнопки «Отправить ещё раз». Возвращает функцию остановки. */
export function cooldown(btn, label = 'Отправить ещё раз', sec = 60) {
  let left = sec;
  btn.disabled = true;
  const tick = () => {
    btn.textContent = left > 0 ? `${label} (${left} с)` : label;
    if (left-- <= 0) { clearInterval(timer); btn.disabled = false; }
  };
  const timer = setInterval(tick, 1000);
  tick();
  return () => clearInterval(timer);
}
