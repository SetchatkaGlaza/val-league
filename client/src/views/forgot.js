import { $, formKit, finePointer, cooldown } from '../js/ui.js';
import { emailError } from '../js/validators.js';
import { auth, ApiError, serverFallback } from '../js/api.js';
import { ICON, emailField, submitBtn, bannerEl } from './parts.js';

export default {
  layout: 'auth',
  title: 'Восстановление пароля',
  description: 'Восстановление доступа к аккаунту VOLOGDA AMATEUR LEAGUE.',
  render: () => `
    <div id="formView">
      <a href="/login" class="back">${ICON.back}Назад ко входу</a>
      <h2>Забыли пароль?</h2>
      <p class="sub">Укажите почту аккаунта, и мы отправим ссылку для создания нового пароля.</p>
      <form id="forgotForm" novalidate>
        ${emailField('email')}
        ${bannerEl}
        ${submitBtn('Отправить ссылку')}
      </form>
      <p class="alt reveal-field">Вспомнили пароль? <a href="/login" class="link">Войти</a></p>
    </div>
    <div class="done" id="doneView" hidden>
      <div class="ok-icon">${ICON.mailBig}</div>
      <h3>Письмо отправлено</h3>
      <p>Если аккаунт с адресом <b id="doneEmail"></b> существует, мы отправили на него ссылку для сброса пароля. Она действует 1 час.</p>
      <button type="button" class="btn btn-ghost" id="resendBtn" disabled>Отправить ещё раз</button>
      <p class="alt"><a href="/login" class="link">Вернуться ко входу</a></p>
    </div>`,

  mount() {
    const form = $('#forgotForm');
    const kit = formKit(form, { email: emailError });
    const resend = $('#resendBtn');
    let stop = () => {}, alive = true;

    const send = async (email) => { await auth.forgot({ email }); $('#doneEmail').textContent = email; };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (kit.isBusy()) return;
      kit.hide();
      if (!kit.validateAll()) return;
      if (!navigator.onLine) { kit.show(serverFallback({ code: 'network' })); kit.shake(); return; }

      kit.setBusy(true, 'Отправить ссылку', 'Отправляем…');
      try {
        await send(form.email.value.trim());
        if (!alive) return;
        kit.swap($('#formView'), $('#doneView'));
        stop = cooldown(resend);
      } catch (err) {
        if (!alive) return;
        kit.show(serverFallback(err instanceof ApiError ? err : new ApiError(0, 'network', ''), 'Не удалось отправить письмо. Попробуйте ещё раз.'));
        kit.shake();
      } finally { if (alive) kit.setBusy(false, 'Отправить ссылку', 'Отправляем…'); }
    });

    resend.addEventListener('click', async () => {
      resend.disabled = true; resend.textContent = 'Отправляем…';
      try { await send(form.email.value.trim()); } catch { /* ответ одинаков, чтобы не раскрывать наличие аккаунта */ }
      if (alive) { stop(); stop = cooldown(resend); }
    });
    if (finePointer()) form.email.focus({ preventScroll: true });
    return () => { alive = false; stop(); };
  },
};
