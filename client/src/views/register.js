import { $, passwordHelpers, formKit, finePointer } from '../js/ui.js';
import { nickError, emailError, newPasswordError, passwordScore } from '../js/validators.js';
import { auth, ApiError, serverFallback } from '../js/api.js';
import { savePending } from '../js/pending.js';
import { ICON, emailField, passwordField, submitBtn, bannerEl, STRENGTH_LABELS } from './parts.js';

const FIELD_ERRORS = {
  email_taken: ['email', 'Аккаунт с такой почтой уже есть. Попробуйте войти или восстановить пароль.'],
  nick_taken: ['nick', 'Этот ник уже занят. Выберите другой.'],
};

export default {
  layout: 'auth',
  title: 'Регистрация',
  description: 'Создайте аккаунт VAL, чтобы собрать команду и участвовать в турнирах по CS2.',
  render: () => `
    <h2>Создать аккаунт</h2>
    <p class="sub">Один аккаунт для всех турниров лиги.</p>
    <button type="button" class="btn btn-steam" id="steamBtn">${ICON.steam}Продолжить через Steam</button>
    <div class="divider"><span>или по почте</span></div>
    <form id="registerForm" novalidate>
      <div class="field reveal-field" data-field="nick">
        <label for="nick">Игровой ник</label>
        <div class="control">
          ${ICON.user}
          <input id="nick" name="nick" type="text" autocomplete="nickname" placeholder="Например, Shadow" maxlength="20" required autocapitalize="off" spellcheck="false" aria-describedby="nick-err" />
        </div>
        <p class="err" id="nick-err" role="alert"></p>
      </div>
      ${emailField('email')}
      ${passwordField({ name: 'password', label: 'Пароль', placeholder: 'Минимум 8 символов', autocomplete: 'new-password', strength: true })}
      ${passwordField({ name: 'confirm', label: 'Повторите пароль', placeholder: 'Ещё раз пароль', autocomplete: 'new-password' })}
      <div class="field reveal-field" data-field="terms">
        <label class="check block"><input type="checkbox" id="terms" name="terms" aria-describedby="terms-err" /><span class="box"></span><span>Мне есть 14 лет, я принимаю <a href="/rules" data-doc="rules" class="link">регламент</a> и даю согласие на обработку данных по <a href="/privacy" data-doc="privacy" class="link">политике конфиденциальности</a></span></label>
        <p class="err" id="terms-err" role="alert"></p>
      </div>
      ${bannerEl}
      ${submitBtn('Создать аккаунт')}
    </form>
    <p class="alt reveal-field">Уже есть аккаунт? <a href="/login" class="link">Войти</a></p>`,

  mount(root, { navigate }) {
    const form = $('#registerForm');
    const kit = formKit(form, {
      nick: nickError,
      email: emailError,
      password: newPasswordError,
      confirm: (v, f) => (!v ? 'Повторите пароль' : v !== f.password.value ? 'Пароли не совпадают' : ''),
      terms: (checked) => (checked ? '' : 'Нужно принять регламент и политику'),
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

      kit.setBusy(true, 'Создать аккаунт', 'Создаём…');
      try {
        const email = form.email.value.trim();
        await auth.register({ nick: form.nick.value.trim(), email, password: form.password.value, terms: true });
        savePending(email);
        navigate('/verify-email');   // дальше — страница «Проверьте почту»
      } catch (err) {
        const e2 = err instanceof ApiError ? err : new ApiError(0, 'network', '');
        const fe = FIELD_ERRORS[e2.code];
        if (fe) { kit.setError(fe[0], fe[1]); form[fe[0]].focus(); }
        else kit.show(serverFallback(e2, 'Не удалось создать аккаунт. Проверьте данные и попробуйте ещё раз.'));
        kit.shake(); kit.setBusy(false, 'Создать аккаунт', 'Создаём…');
      }
    });

    $('#steamBtn').addEventListener('click', () => location.assign(auth.steamUrl()));
    if (finePointer()) form.nick.focus({ preventScroll: true });
  },
};
