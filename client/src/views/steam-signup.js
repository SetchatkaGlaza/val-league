import { $, formKit, finePointer } from '../js/ui.js';
import { nickError, safeNext } from '../js/validators.js';
import { auth, ApiError, serverFallback } from '../js/api.js';
import { setUser } from '../js/session.js';
import { ICON, esc, submitBtn, bannerEl } from './parts.js';

const FIELD_ERRORS = { nick_taken: ['nick', 'Этот ник уже занят. Выберите другой.'] };

/** Ник из имени профиля Steam: оставляем допустимые символы; если не подходит, поле остаётся пустым. */
const suggestNick = (name) => {
  const v = String(name || '').replace(/[^A-Za-zА-Яа-яЁё0-9_.\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return v && !nickError(v) ? v : '';
};

const formHtml = (name) => `
  <h2>Почти готово</h2>
  <p class="sub">Steam подтверждён. Выберите ник, под которым вас увидят в командах и сетках.</p>
  <p class="steam-chip">${ICON.steam}<span>${esc(name)}</span></p>
  <form id="signupForm" novalidate>
    <div class="field" data-field="nick">
      <label for="nick">Игровой ник</label>
      <div class="control">
        ${ICON.user}
        <input id="nick" name="nick" type="text" autocomplete="nickname" placeholder="Например, Shadow" maxlength="20" required autocapitalize="off" spellcheck="false" value="${esc(suggestNick(name))}" aria-describedby="nick-err" />
      </div>
      <p class="err" id="nick-err" role="alert"></p>
    </div>
    <div class="field" data-field="terms">
      <label class="check block"><input type="checkbox" id="terms" name="terms" aria-describedby="terms-err" /><span class="box"></span><span>Мне есть 14 лет, я принимаю <a href="/rules" data-doc="rules" class="link">регламент</a> и даю согласие на обработку данных по <a href="/privacy" data-doc="privacy" class="link">политике конфиденциальности</a></span></label>
      <p class="err" id="terms-err" role="alert"></p>
    </div>
    ${bannerEl}
    ${submitBtn('Создать аккаунт').replace(' reveal-field', '')}
  </form>
  <p class="alt">Уже есть аккаунт с почтой? <a href="/login" class="link">Войдите</a> и привяжите Steam в кабинете.</p>`;

/** Сюда сервер ведёт игрока, когда Steam подтверждён, а аккаунта с этим Steam ещё нет. Аккаунт создаётся только после выбора ника. */
export default {
  layout: 'auth',
  title: 'Выбор ника',
  description: 'Завершите регистрацию через Steam: выберите игровой ник.',
  render: () => `<div id="signup" aria-busy="true"><div class="done"><div class="ok-icon pending"><span class="spinner spinner-lg"></span></div><h3>Проверяем Steam…</h3></div></div>`,

  mount(root, { navigate }) {
    let alive = true;
    const box = $('#signup', root);
    const expired = () => navigate('/login?error=steam_expired', { replace: true });

    auth.steamPending().then(({ steam, next }) => {
      if (!alive) return;
      box.removeAttribute('aria-busy');
      box.innerHTML = formHtml(steam?.name || 'Steam');
      const form = $('#signupForm', box);
      const kit = formKit(form, { nick: nickError, terms: (c) => (c ? '' : 'Нужно принять регламент и политику') });
      if (finePointer()) form.nick.focus({ preventScroll: true });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (kit.isBusy()) return;
        kit.hide();
        if (!kit.validateAll()) return;
        if (!navigator.onLine) { kit.show(serverFallback({ code: 'network' })); kit.shake(); return; }
        kit.setBusy(true, 'Создать аккаунт', 'Создаём…');
        try {
          const res = await auth.steamRegister({ nick: form.nick.value.trim(), terms: true });
          if (!alive) return;
          setUser(res.user, false);
          navigate(safeNext(res.next || next, '/account'), { replace: true });
        } catch (err) {
          if (!alive) return;
          const e2 = err instanceof ApiError ? err : new ApiError(0, 'network', '');
          if (e2.code === 'steam_session_expired') return expired();
          if (e2.code === 'steam_exists') return navigate('/login?error=steam_exists', { replace: true });
          const fe = FIELD_ERRORS[e2.code];
          if (fe) { kit.setError(fe[0], fe[1]); form[fe[0]].focus(); }
          else kit.show(serverFallback(e2, 'Не удалось создать аккаунт. Проверьте данные и попробуйте ещё раз.'));
          kit.shake(); kit.setBusy(false, 'Создать аккаунт', 'Создаём…');
        }
      });
    }).catch((err) => {
      if (!alive) return;
      if (err instanceof ApiError && err.code === 'steam_session_expired') return expired();
      box.innerHTML = `<h2>Не получилось</h2><p class="sub">${esc(serverFallback(err instanceof ApiError ? err : new ApiError(0, 'network', ''), 'Не удалось проверить Steam.'))}</p><a class="btn btn-primary" href="/login">Назад ко входу</a>`;
    });
    return () => { alive = false; };
  },
};
