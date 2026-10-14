import { $, setSlot, passwordHelpers, formKit, finePointer } from '../js/ui.js';
import { newPasswordError, passwordScore } from '../js/validators.js';
import { auth, ApiError, serverFallback } from '../js/api.js';
import { ICON, passwordField, submitBtn, bannerEl, STRENGTH_LABELS } from './parts.js';

const tplForm = () => `
  <h2 class="reveal-field">Новый пароль</h2>
  <p class="sub reveal-field">Придумайте пароль для входа в аккаунт.</p>
  <form id="resetForm" novalidate>
    ${passwordField({ name: 'password', label: 'Новый пароль', placeholder: 'Минимум 8 символов', autocomplete: 'new-password', strength: true })}
    ${passwordField({ name: 'confirm', label: 'Повторите пароль', placeholder: 'Ещё раз пароль', autocomplete: 'new-password' })}
    ${bannerEl}
    ${submitBtn('Сохранить пароль')}
  </form>
  <p class="alt reveal-field"><a href="/login" class="link">Вернуться ко входу</a></p>`;

const tplDone = () => `
  <div class="done">
    <div class="ok-icon reveal-field">${ICON.check}</div>
    <h2 class="reveal-field">Пароль изменён</h2>
    <p class="reveal-field">Теперь можно войти в аккаунт с новым паролем.</p>
    <a href="/login" class="btn btn-primary reveal-field">Войти</a>
  </div>`;

const tplInvalid = () => `
  <div class="done">
    <div class="ok-icon warn reveal-field">${ICON.warn}</div>
    <h2 class="reveal-field">Ссылка недействительна</h2>
    <p class="reveal-field">Ссылка для сброса пароля устарела или уже использована. Запросите новую — она действует 1 час.</p>
    <a href="/forgot" class="btn btn-primary reveal-field">Запросить новую ссылку</a>
    <p class="alt reveal-field"><a href="/login" class="link">Вернуться ко входу</a></p>
  </div>`;

export default {
  layout: 'auth',
  title: 'Новый пароль',
  description: 'Создайте новый пароль для аккаунта VOLOGDA AMATEUR LEAGUE.',
  render: ({ query }) => (query.get('token') ? tplForm() : tplInvalid()),

  mount(root, { query }) {
    const token = query.get('token');
    if (!token) return null;
    let alive = true;
    const isAlive = () => alive;

    const form = $('#resetForm');
    const kit = formKit(form, {
      password: newPasswordError,
      confirm: (v, f) => (!v ? 'Повторите пароль' : v !== f.password.value ? 'Пароли не совпадают' : ''),
    });
    passwordHelpers();

    const bar = $('#strength'), label = $('#strengthLabel');
    form.password.addEventListener('input', () => {
      const s = passwordScore(form.password.value);
      bar.dataset.level = s; label.textContent = STRENGTH_LABELS[s];
      if (kit.touched.has('confirm') && form.confirm.value) kit.check('confirm');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (kit.isBusy()) return;
      kit.hide();
      if (!kit.validateAll()) return;
      if (!navigator.onLine) { kit.show(serverFallback({ code: 'network' })); kit.shake(); return; }

      kit.setBusy(true, 'Сохранить пароль', 'Сохраняем…');
      try {
        await auth.resetPassword({ token, password: form.password.value });
        if (alive) setSlot(tplDone(), isAlive);
      } catch (err) {
        if (!alive) return;
        const e2 = err instanceof ApiError ? err : new ApiError(0, 'network', '');
        if (e2.code === 'token_invalid') { setSlot(tplInvalid(), isAlive); return; }
        kit.show(serverFallback(e2, 'Не удалось сменить пароль. Попробуйте ещё раз.'));
        kit.shake(); kit.setBusy(false, 'Сохранить пароль', 'Сохраняем…');
      }
    });
    if (finePointer()) form.password.focus({ preventScroll: true });

    return () => { alive = false; };
  },
};
