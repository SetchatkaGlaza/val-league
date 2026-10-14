import { $, passwordHelpers, formKit, finePointer } from '../js/ui.js';
import { emailError, loginPasswordError, safeNext } from '../js/validators.js';
import { auth, ApiError, serverFallback } from '../js/api.js';
import { savePending } from '../js/pending.js';
import { ICON, emailField, passwordField, submitBtn, bannerEl } from './parts.js';

const MESSAGES = {
  invalid_credentials: 'Неверная почта или пароль.',
  blocked: 'Аккаунт заблокирован. Если это ошибка, напишите нам в Telegram.',
};

export default {
  layout: 'auth',
  title: 'Вход',
  description: 'Вход в VOLOGDA AMATEUR LEAGUE — онлайн-турниры по CS2 в Вологде.',
  render: () => `
    <h2>Вход в аккаунт</h2>
    <p class="sub">С возвращением! Войдите, чтобы участвовать в турнирах.</p>
    <button type="button" class="btn btn-steam" id="steamBtn">${ICON.steam}Войти через Steam</button>
    <div class="divider"><span>или по почте</span></div>
    <form id="loginForm" novalidate>
      ${emailField('username')}
      ${passwordField({ name: 'password', label: 'Пароль', placeholder: 'Ваш пароль', autocomplete: 'current-password' })}
      <div class="row reveal-field">
        <label class="check"><input type="checkbox" id="remember" name="remember" /><span class="box"></span>Запомнить меня</label>
        <a href="/forgot" class="link">Забыли пароль?</a>
      </div>
      ${bannerEl}
      ${submitBtn('Войти')}
    </form>
    <p class="alt reveal-field">Нет аккаунта? <a href="/register" class="link">Зарегистрироваться</a></p>`,

  mount(root, { navigate, query }) {
    const form = $('#loginForm');
    const kit = formKit(form, { email: emailError, password: loginPasswordError });
    passwordHelpers();
    const next = () => query.get('next');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (kit.isBusy()) return;
      kit.hide();
      if (!kit.validateAll()) return;
      if (!navigator.onLine) { kit.show(serverFallback({ code: 'network' })); kit.shake(); return; }

      kit.setBusy(true, 'Войти', 'Входим…');
      try {
        await auth.login({ email: form.email.value.trim(), password: form.password.value, remember: form.remember.checked });
        kit.show('Вход выполнен. Перенаправляем…', true);
        navigate(safeNext(next()));
      } catch (err) {
        const e2 = err instanceof ApiError ? err : new ApiError(0, 'network', '');
        if (e2.code === 'email_not_verified') {
          savePending(form.email.value.trim(), 0);
          kit.show('Почта не подтверждена. Откройте письмо, которое мы отправили при регистрации, и перейдите по ссылке. <a href="/verify-email">Письмо не пришло?</a>');
        } else {
          kit.show(MESSAGES[e2.code] || serverFallback(e2, 'Не удалось войти. Попробуйте ещё раз.'));
        }
        if (e2.code === 'invalid_credentials') { form.password.value = ''; form.password.focus(); }
        kit.shake(); kit.setBusy(false, 'Войти', 'Входим…');
      }
    });

    $('#steamBtn').addEventListener('click', () => {
      const n = next();
      location.assign(auth.steamUrl() + (n ? `?next=${encodeURIComponent(safeNext(n))}` : ''));   // уход на Steam — единственный «настоящий» переход
    });

    const onOffline = () => kit.show(serverFallback({ code: 'network' }));
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', kit.hide);
    if (finePointer()) form.email.focus({ preventScroll: true });
    return () => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', kit.hide); };
  },
};
