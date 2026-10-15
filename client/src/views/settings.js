import { $, $$, gsap, motion } from '../js/ui.js';
import { settings, account, ApiError, serverFallback } from '../js/api.js';
import { getUser, patchUser, clearUser } from '../js/session.js';
import { nickError, newPasswordError, passwordScore } from '../js/validators.js';
import { ICON, esc, passwordField, STRENGTH_LABELS } from './parts.js';

const EVENTS = [
  ['registered', 'Регистрация подтверждена'],
  ['tomorrow', 'Турнир завтра'],
  ['match30', 'Матч через 30 минут'],
];
const DEFAULT_N = { registered: { email: true, tg: true }, tomorrow: { email: true, tg: true }, match30: { email: false, tg: true } };

const notifRows = (n, hasTg) => EVENTS.map(([k, label]) => `
  <tr><td>${label}</td>
  <td><label class="check"><input type="checkbox" data-n="${k}.email" ${n[k].email ? 'checked' : ''} aria-label="${label}: почта" /><span class="box"></span></label></td>
  <td><label class="check"><input type="checkbox" data-n="${k}.tg" ${n[k].tg && hasTg ? 'checked' : ''} ${hasTg ? '' : 'disabled'} aria-label="${label}: Telegram" /><span class="box"></span></label></td></tr>`).join('');

export default {
  layout: 'doc',
  protected: true,
  title: 'Настройки аккаунта',
  description: 'Профиль, пароль, уведомления и удаление аккаунта VOLOGDA AMATEUR LEAGUE.',

  render: () => {
    const u = getUser();
    const n = u.notifications || DEFAULT_N;
    return `
    <main class="acc">
      <a href="/account" class="back">${ICON.back}Личный кабинет</a>
      <h1 class="set-title">Настройки</h1>
      <div class="acc-grid">
        <section class="acc-card">
          <h2>Профиль</h2><p class="acc-sub">Ник виден в сетках и списках команд.</p>
          <form class="set-form" id="profileForm" novalidate>
            <div class="field" data-field="nick"><label for="nick">Игровой ник</label>
              <div class="control">${ICON.user}<input id="nick" name="nick" type="text" value="${esc(u.nick)}" maxlength="20" autocomplete="nickname" autocapitalize="off" spellcheck="false" aria-describedby="nick-err" /></div>
              <p class="err" id="nick-err" role="alert"></p></div>
            <div class="field"><label>Почта</label><div class="control ro">${ICON.mail}<input type="text" value="${esc(u.email || 'не указана')}" readonly tabindex="-1" /></div>
              <p class="hint-mut">Для смены почты напишите в поддержку.</p></div>
            <button type="submit" class="btn btn-primary btn-sm"><span class="label">Сохранить</span><span class="spinner" aria-hidden="true"></span></button>
            <p class="set-status" role="status"></p>
          </form>
        </section>
        <section class="acc-card">
          <h2>Пароль</h2><p class="acc-sub">Минимум 8 символов, буквы и цифры.</p>
          <form class="set-form" id="passForm" novalidate>
            ${passwordField({ name: 'current', label: 'Текущий пароль', placeholder: 'Текущий пароль', autocomplete: 'current-password' }).replace(' reveal-field', '')}
            ${passwordField({ name: 'next', label: 'Новый пароль', placeholder: 'Минимум 8 символов', autocomplete: 'new-password', strength: true }).replace(' reveal-field', '')}
            ${passwordField({ name: 'confirm', label: 'Повторите пароль', placeholder: 'Ещё раз пароль', autocomplete: 'new-password' }).replace(' reveal-field', '')}
            <button type="submit" class="btn btn-primary btn-sm"><span class="label">Сменить пароль</span><span class="spinner" aria-hidden="true"></span></button>
            <p class="set-status" role="status"></p>
          </form>
        </section>
        <section class="acc-card acc-wide">
          <h2>Уведомления</h2><p class="acc-sub">Сохраняются сразу при переключении.${u.telegram ? '' : ' Чтобы получать сообщения в Telegram, <a href="/account" class="link">привяжите его в кабинете</a>.'}</p>
          <div class="notif-wrap"><table class="notif" id="notif"><thead><tr><th></th><th>Почта</th><th>Telegram</th></tr></thead><tbody>${notifRows(n, !!u.telegram)}</tbody></table></div>
          <p class="set-status" id="notifStatus" role="status"></p>
        </section>
        <section class="acc-card acc-wide danger">
          <h2>Удаление аккаунта</h2><p class="acc-sub">Профиль, привязки и история будут удалены без возможности восстановления. Команда, где вы капитан, останется без капитана.</p>
          <button type="button" class="btn btn-danger btn-sm" id="delOpen">Удалить аккаунт</button>
          <form class="del-panel" id="delForm" hidden novalidate>
            <label for="delNick">Для подтверждения введите свой ник: <b>${esc(u.nick)}</b></label>
            <div class="control"><input id="delNick" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>
            <div class="tg-actions"><button type="submit" class="btn btn-danger btn-sm" id="delGo" disabled><span class="label">Удалить навсегда</span><span class="spinner" aria-hidden="true"></span></button>
            <button type="button" class="btn btn-ghost btn-sm" id="delCancel">Отмена</button></div>
            <p class="set-status" role="status"></p>
          </form>
        </section>
      </div>
    </main>`;
  },

  mount(root, { navigate }) {
    let alive = true;
    const toError = (e) => serverFallback(e instanceof ApiError ? e : new ApiError(0, 'network', ''), 'Не удалось сохранить. Попробуйте ещё раз.');
    if (motion) gsap.from($$('.set-title, .acc-card', root), { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });

    /** Подготовка формы: ошибки полей, статус, состояние загрузки. */
    const kit = (form, rules) => {
      const btn = $('button[type=submit]', form), status = $('.set-status', form);
      const setErr = (name, msg) => {
        const f = $(`[data-field="${name}"]`, form); f.classList.toggle('invalid', !!msg);
        $(`#${name}-err`, form).textContent = msg; return !msg;
      };
      const say = (text, ok) => { status.textContent = text; status.className = 'set-status' + (text ? (ok ? ' ok' : ' bad') : ''); };
      Object.keys(rules).forEach((n) => form[n].addEventListener('input', () => { say(''); setErr(n, ''); }));
      return {
        setErr, say,
        valid() { const bad = Object.keys(rules).filter((n) => !setErr(n, rules[n](form[n].value, form))); if (bad.length) form[bad[0]].focus(); return !bad.length; },
        busy(v) { btn.disabled = v; btn.classList.toggle('loading', v); form.querySelectorAll('input').forEach((i) => { if (!i.readOnly) i.disabled = v; }); },
      };
    };

    /* Профиль */
    const pf = $('#profileForm', root), pk = kit(pf, { nick: nickError });
    pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pk.valid()) return;
      const nick = pf.nick.value.trim();
      if (nick === getUser().nick) { pk.say('Изменений нет.'); return; }
      pk.busy(true);
      try { await settings.updateProfile({ nick }); patchUser({ nick }); if (alive) pk.say('Ник сохранён.', true); }
      catch (err) { if (alive) { if (err.code === 'nick_taken') pk.setErr('nick', 'Этот ник уже занят. Выберите другой.'); else pk.say(toError(err)); } }
      if (alive) pk.busy(false);
    });

    /* Пароль */
    const wf = $('#passForm', root);
    const wk = kit(wf, {
      current: (v) => (v ? '' : 'Введите текущий пароль'),
      next: (v, f) => newPasswordError(v) || (v === f.current.value ? 'Новый пароль должен отличаться от текущего' : ''),
      confirm: (v, f) => (!v ? 'Повторите пароль' : v !== f.next.value ? 'Пароли не совпадают' : ''),
    });
    $$('.eye', wf).forEach((b) => b.addEventListener('click', () => {
      const i = $(`#${b.dataset.target}`, wf), show = i.type === 'password';
      i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    }));
    wf.next.addEventListener('input', () => { const s = passwordScore(wf.next.value); $('#strength', wf).dataset.level = s; $('#strengthLabel', wf).textContent = STRENGTH_LABELS[s]; });
    wf.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!wk.valid()) return;
      wk.busy(true);
      try { await settings.changePassword({ current: wf.current.value, password: wf.next.value }); if (alive) { wf.reset(); $('#strength', wf).dataset.level = 0; $('#strengthLabel', wf).textContent = ''; wk.say('Пароль изменён.', true); } }
      catch (err) { if (alive) { if (err.code === 'invalid_credentials') { wk.setErr('current', 'Неверный текущий пароль.'); wf.current.focus(); } else wk.say(toError(err)); } }
      if (alive) wk.busy(false);
    });

    /* Уведомления: автосохранение с небольшой задержкой */
    const ns = $('#notifStatus', root); let t = 0;
    $('#notif', root).addEventListener('change', () => {
      const n = {};
      EVENTS.forEach(([k]) => { n[k] = { email: $(`[data-n="${k}.email"]`, root).checked, tg: $(`[data-n="${k}.tg"]`, root).checked }; });
      clearTimeout(t); ns.textContent = 'Сохраняем…'; ns.className = 'set-status';
      t = setTimeout(async () => {
        try { await settings.saveNotifications(n); patchUser({ notifications: n }); if (alive) { ns.textContent = 'Сохранено.'; ns.className = 'set-status ok'; } }
        catch (err) { if (alive) { ns.textContent = toError(err); ns.className = 'set-status bad'; } }
      }, 400);
    });

    /* Удаление аккаунта */
    const df = $('#delForm', root), open = $('#delOpen', root), go = $('#delGo', root), dn = $('#delNick', root), ds = $('.set-status', df);
    open.addEventListener('click', () => { open.hidden = true; df.hidden = false; dn.focus(); });
    $('#delCancel', root).addEventListener('click', () => { df.hidden = true; open.hidden = false; dn.value = ''; go.disabled = true; ds.textContent = ''; });
    dn.addEventListener('input', () => { go.disabled = dn.value.trim().toLowerCase() !== getUser().nick.toLowerCase(); });
    df.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      go.disabled = true; go.classList.add('loading');
      try { await settings.deleteAccount({ nick: dn.value.trim() }); await account.logout().catch(() => {}); clearUser(); navigate('/'); }
      catch (err) { if (alive) { go.classList.remove('loading'); go.disabled = false; ds.textContent = toError(err); ds.className = 'set-status bad'; } }
    });

    return () => { alive = false; clearTimeout(t); };
  },
};
