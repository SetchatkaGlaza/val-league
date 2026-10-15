import { $, $$, gsap, motion } from '../js/ui.js';
import { teams } from '../js/api.js';
import { squareLogo, LOGO_ERRORS } from '../js/image.js';
import { teamNameError, teamDescError } from '../js/validators.js';
import { ICON } from './parts.js';
import { teamError, flash } from './team-parts.js';

const TEAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c2.2.6 3.5 2.3 3.5 5.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

export default {
  layout: 'doc',
  protected: true,
  title: 'Создать команду',
  description: 'Создайте команду в VOLOGDA AMATEUR LEAGUE: название, логотип и описание. Затем пригласите игроков.',

  render: () => `
    <main class="acc">
      <a href="/account" class="back">${ICON.back}Личный кабинет</a>
      <h1 class="set-title">Создать команду</h1>
      <section class="acc-card tm-form-card">
        <p class="acc-sub">Вы станете капитаном и первым игроком основы. Игроков можно пригласить сразу после создания.</p>
        <form class="set-form tm-form" id="teamForm" novalidate>
          <div class="field" data-field="name"><label for="name">Название команды</label>
            <div class="control">${TEAM_ICON}<input id="name" name="name" type="text" maxlength="24" autocomplete="off" spellcheck="false" placeholder="Например, Северный Ветер" aria-describedby="name-err" /></div>
            <p class="err" id="name-err" role="alert"></p></div>
          <div class="field" data-field="description"><label for="description">Описание <span class="opt">необязательно</span></label>
            <div class="control area"><textarea id="description" name="description" rows="3" maxlength="300" placeholder="Кто вы, в каком составе играете, чего хотите добиться" aria-describedby="description-err"></textarea></div>
            <p class="hint-mut"><span id="descCount">0</span> / 300</p>
            <p class="err" id="description-err" role="alert"></p></div>
          <div class="field"><label>Логотип <span class="opt">необязательно</span></label>
            <div class="logo-pick">
              <div class="tm-logo ph lg" id="logoPreview" aria-hidden="true">?</div>
              <div class="logo-pick-t">
                <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
                <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" id="logoPickBtn">Выбрать картинку</button><button type="button" class="btn btn-ghost btn-sm" id="logoClear" hidden>Убрать</button></div>
                <p class="hint-mut">Квадратная картинка лучше всего: мы обрежем по центру. PNG, JPG, WebP.</p>
                <p class="err" id="logo-err" role="alert"></p>
              </div>
            </div></div>
          <div class="banner" id="banner" role="alert" hidden></div>
          <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm" id="submitBtn"><span class="label">Создать команду</span><span class="spinner" aria-hidden="true"></span></button>
          <a href="/account" class="btn btn-ghost btn-sm">Отмена</a></div>
        </form>
      </section>
    </main>`,

  mount(root, { navigate }) {
    let alive = true, logo = null, previewUrl = null;
    const form = $('#teamForm', root), btn = $('#submitBtn', root), banner = $('#banner', root);
    const preview = $('#logoPreview', root), fileIn = $('#logoFile', root), clear = $('#logoClear', root), logoErr = $('#logo-err', root);
    if (motion) gsap.from($$('.set-title, .acc-card', root), { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });

    const setErr = (name, msg) => { $(`[data-field="${name}"]`, root).classList.toggle('invalid', !!msg); $(`#${name}-err`, root).textContent = msg; return !msg; };
    const say = (text) => { banner.textContent = text; banner.hidden = !text; };
    const rules = { name: teamNameError, description: teamDescError };
    Object.keys(rules).forEach((n) => form[n].addEventListener('input', () => { say(''); setErr(n, ''); }));
    form.description.addEventListener('input', () => { $('#descCount', root).textContent = form.description.value.length; });
    form.name.focus({ preventScroll: true });

    const showPreview = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = logo ? URL.createObjectURL(logo) : null;
      preview.style.backgroundImage = previewUrl ? `url(${previewUrl})` : '';
      preview.classList.toggle('has', !!logo);
      preview.textContent = logo ? '' : '?';
      clear.hidden = !logo;
    };
    $('#logoPickBtn', root).addEventListener('click', () => fileIn.click());
    clear.addEventListener('click', () => { logo = null; fileIn.value = ''; logoErr.textContent = ''; showPreview(); });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      logoErr.textContent = '';
      try { logo = await squareLogo(f); } catch (e) { logo = null; logoErr.textContent = LOGO_ERRORS[e.message] || LOGO_ERRORS.decode; }
      if (alive) showPreview();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      const bad = Object.keys(rules).filter((n) => !setErr(n, rules[n](form[n].value)));
      if (bad.length) { form[bad[0]].focus(); return; }
      btn.disabled = true; btn.classList.add('loading'); say('');
      try {
        const { slug } = await teams.create({ name: form.name.value.trim().replace(/\s+/g, ' '), description: form.description.value.trim() });
        if (logo) {
          // Команда уже создана: если логотип не загрузился, не теряем её, а подсказываем, что делать.
          try { await teams.setLogo(slug, logo); }
          catch { flash.set('Команда создана, но логотип не загрузился. Загрузите его ниже, в настройках команды.'); }
        }
        navigate(`/teams/${slug}`);
      } catch (err) {
        if (!alive) return;
        btn.disabled = false; btn.classList.remove('loading');
        if (err.code === 'name_taken') setErr('name', 'Команда с таким названием уже есть.');
        else if (err.code === 'validation' && rules[err.field]) setErr(err.field, rules[err.field](form[err.field].value) || 'Проверьте это поле.');
        else say(teamError(err));
      }
    });
    return () => { alive = false; if (previewUrl) URL.revokeObjectURL(previewUrl); };
  },
};
