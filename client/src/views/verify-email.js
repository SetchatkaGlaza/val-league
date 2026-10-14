import { $, setSlot, formKit, finePointer, cooldown, motion, gsap } from '../js/ui.js';
import { emailError } from '../js/validators.js';
import { auth, ApiError, serverFallback } from '../js/api.js';
import { readPending, savePending } from '../js/pending.js';
import { ICON, emailField, submitBtn, bannerEl } from './parts.js';

const COOLDOWN = 60;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const tplVerifying = () => `
  <div class="done" aria-busy="true">
    <div class="ok-icon pending reveal-field"><span class="spinner spinner-lg"></span></div>
    <h2 class="reveal-field">Подтверждаем почту…</h2>
    <p class="reveal-field">Это займёт пару секунд.</p>
  </div>`;

const tplSuccess = () => `
  <div class="done">
    <div class="ok-icon reveal-field">${ICON.check}</div>
    <h2 class="reveal-field">Почта подтверждена</h2>
    <p class="reveal-field">Аккаунт активирован. Теперь можно войти и собрать команду.</p>
    <a href="/login" class="btn btn-primary reveal-field">Войти в аккаунт</a>
  </div>`;

const tplRetry = (msg) => `
  <div class="done">
    <div class="ok-icon warn reveal-field">${ICON.warn}</div>
    <h2 class="reveal-field">Не удалось подтвердить</h2>
    <p class="reveal-field">${msg}</p>
    <button type="button" class="btn btn-primary reveal-field" id="retryBtn">Повторить</button>
  </div>`;

const tplSent = (email) => `
  <div class="done">
    <div class="ok-icon reveal-field">${ICON.mailBig}</div>
    <h2 class="reveal-field">Проверьте почту</h2>
    <p class="reveal-field">Мы отправили письмо со ссылкой для подтверждения на <b>${esc(email)}</b>. Если его нет, загляните в «Спам».</p>
    <div class="banner" id="banner" role="alert" hidden></div>
    <button type="button" class="btn btn-ghost reveal-field" id="resendBtn" disabled>Отправить ещё раз</button>
    <p class="alt reveal-field"><a href="/register" class="link">Указали не ту почту?</a> · <a href="/login" class="link">Ко входу</a></p>
  </div>`;

const tplAsk = (invalid) => `
  ${invalid ? `<div class="done"><div class="ok-icon warn reveal-field">${ICON.warn}</div></div>` : ''}
  <h2 class="reveal-field">${invalid ? 'Ссылка недействительна' : 'Подтвердите почту'}</h2>
  <p class="sub reveal-field">${invalid ? 'Ссылка устарела или уже использована.' : 'Мы отправляем письмо со ссылкой для подтверждения.'} Укажите почту аккаунта — пришлём новое письмо.</p>
  <form id="askForm" novalidate>
    ${emailField('email')}
    ${bannerEl}
    ${submitBtn('Отправить письмо')}
  </form>
  <p class="alt reveal-field"><a href="/login" class="link">Вернуться ко входу</a></p>`;

export default {
  layout: 'auth',
  title: 'Подтверждение почты',
  description: 'Подтвердите почту, чтобы активировать аккаунт VOLOGDA AMATEUR LEAGUE.',

  // Что видно сразу: проверка ссылки, письмо отправлено или запрос почты.
  render: ({ query }) => {
    if (query.get('token')) return tplVerifying();
    const p = readPending();
    return p && p.email ? tplSent(p.email) : tplAsk(false);
  },

  mount(root, { query }) {
    let alive = true, stop = () => {};
    const isAlive = () => alive;
    const show = async (html, wire) => {
      stop(); stop = () => {};
      if (await setSlot(html, isAlive) && wire) wire();
    };

    function wireSent(email) {
      const btn = $('#resendBtn'), banner = $('#banner');
      const p = readPending();
      const passed = p && p.sentAt ? Math.floor((Date.now() - p.sentAt) / 1000) : COOLDOWN;
      const left = Math.max(0, COOLDOWN - passed);
      if (left > 0) stop = cooldown(btn, 'Отправить ещё раз', left);
      else { btn.disabled = false; btn.textContent = 'Отправить ещё раз'; }

      const say = (text, ok) => {
        banner.className = 'banner' + (ok ? ' ok' : ''); banner.textContent = text; banner.hidden = false;
        if (motion) gsap.fromTo(banner, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: .35, ease: 'power2.out' });
      };
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Отправляем…'; banner.hidden = true;
        try {
          await auth.resendVerification({ email });
          if (!alive) return;
          savePending(email);
          say('Письмо отправлено повторно.', true);
        } catch (err) {
          if (!alive) return;
          say(serverFallback(err instanceof ApiError ? err : new ApiError(0, 'network', ''), 'Не удалось отправить письмо. Попробуйте ещё раз.'));
        }
        if (alive) { stop(); stop = cooldown(btn, 'Отправить ещё раз', COOLDOWN); }
      });
    }

    function wireAsk() {
      const form = $('#askForm');
      const kit = formKit(form, { email: emailError });
      const p = readPending();
      if (p && p.email) form.email.value = p.email;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (kit.isBusy()) return;
        kit.hide();
        if (!kit.validateAll()) return;
        if (!navigator.onLine) { kit.show(serverFallback({ code: 'network' })); kit.shake(); return; }
        const email = form.email.value.trim();
        kit.setBusy(true, 'Отправить письмо', 'Отправляем…');
        try {
          await auth.resendVerification({ email });
          if (!alive) return;
          savePending(email);
          show(tplSent(email), () => wireSent(email));
        } catch (err) {
          if (!alive) return;
          kit.show(serverFallback(err instanceof ApiError ? err : new ApiError(0, 'network', ''), 'Не удалось отправить письмо. Попробуйте ещё раз.'));
          kit.shake(); kit.setBusy(false, 'Отправить письмо', 'Отправляем…');
        }
      });
      if (finePointer()) form.email.focus({ preventScroll: true });
    }

    async function verify(token) {
      try {
        await auth.verifyEmail({ token });
        if (alive) show(tplSuccess());
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.code === 'token_invalid') show(tplAsk(true), wireAsk);
        else {
          const e2 = err instanceof ApiError ? err : new ApiError(0, 'network', '');
          show(tplRetry(serverFallback(e2, 'Что-то пошло не так. Попробуйте ещё раз.')), () => {
            $('#retryBtn').addEventListener('click', async () => { await show(tplVerifying()); verify(token); });
          });
        }
      }
    }

    const token = query.get('token');
    const p = readPending();
    if (token) verify(token);
    else if (p && p.email) wireSent(p.email);
    else wireAsk();

    return () => { alive = false; stop(); };
  },
};
