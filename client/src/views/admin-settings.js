import { $, $$ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { tournamentError } from './tournament-parts.js';
import { adminNav } from './admin-nav.js';
import { refreshSite } from '../js/site.js';

// Названия полей и тексты ошибок формы. Сервер проверяет всё заново, здесь только понятные сообщения.
const LABEL = {
  contactEmail: 'Контактная почта', socialTelegram: 'Telegram', socialVk: 'ВКонтакте', socialDiscord: 'Discord', socialYoutube: 'YouTube',
  bannerText: 'Текст объявления', bannerUntil: 'Показывать до', bannerEnabled: 'Баннер',
  ratingParticipation: 'За участие', ratingPlace1: 'За 1 место', ratingPlace2: 'За 2 место', ratingPlace3: 'За 3 место', ratingMatchWin: 'За победу в матче',
};
const fieldText = (name, reason) => {
  if (name.startsWith('rating')) return reason === 'order' ? 'Очки за места не должны расти: 1 место ≥ 2 место ≥ 3 место.' : 'Нужно целое число от 0 до 1000.';
  if (name === 'contactEmail') return 'Введите почту вида name@site.ru или оставьте поле пустым.';
  if (name.startsWith('social')) return 'Нужна ссылка вида https://… без пробелов (до 200 символов).';
  if (name === 'bannerText') return reason === 'required' ? 'Чтобы включить баннер, введите текст объявления.' : 'Текст не длиннее 200 символов.';
  if (name === 'bannerUntil') return 'Укажите существующую дату или очистите поле.';
  return 'Проверьте значение.';
};
const saveError = (e) => {
  if (e?.code === 'validation' && e.field && LABEL[e.field]) return { field: e.field, text: `${LABEL[e.field]}: ${fieldText(e.field, e.details?.[0])}` };
  return { field: null, text: tournamentError(e, 'Не удалось сохранить. Попробуйте ещё раз.') };
};

const text = (id, name, label, v, { type = 'text', max = 200, hint = '', ph = '' } = {}) => `
  <div class="field"><label for="${id}">${label}</label><div class="control"><input id="${id}" name="${name}" type="${type}" maxlength="${max}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" autocomplete="off" ${hint ? `aria-describedby="${id}-h"` : ''} /></div>${hint ? `<p class="hint-mut" id="${id}-h">${hint}</p>` : ''}</div>`;
const num = (id, name, label, v) => `
  <div class="field"><label for="${id}">${label}</label><div class="control"><input id="${id}" name="${name}" type="number" inputmode="numeric" min="0" max="1000" step="1" value="${esc(v)}" /></div></div>`;
const foot = (id, extra = '') => `<p class="err" id="${id}-err" role="alert"></p><p class="ok" id="${id}-ok" role="status"></p>
  <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm">Сохранить</button>${extra}</div>`;

const paint = (d) => {
  const s = d.settings;
  return `
  <form class="acc-card st-card" id="stContacts" novalidate aria-labelledby="stC">
    <h2 id="stC">Контакты и соцсети</h2>
    <p class="acc-sub">Показываются внизу каждой страницы сайта. Пустое поле — ссылка не показывается.</p>
    <div class="st-grid">
      ${text('st-email', 'contactEmail', 'Контактная почта', s.contactEmail, { type: 'email', max: 120, ph: 'info@example.ru' })}
      ${text('st-tg', 'socialTelegram', 'Telegram', s.socialTelegram, { type: 'url', ph: 'https://t.me/…' })}
      ${text('st-vk', 'socialVk', 'ВКонтакте', s.socialVk, { type: 'url', ph: 'https://vk.com/…' })}
      ${text('st-ds', 'socialDiscord', 'Discord', s.socialDiscord, { type: 'url', ph: 'https://discord.gg/…' })}
      ${text('st-yt', 'socialYoutube', 'YouTube', s.socialYoutube, { type: 'url', ph: 'https://youtube.com/…' })}
    </div>
    ${foot('stC')}
  </form>

  <form class="acc-card st-card" id="stBanner" novalidate aria-labelledby="stB">
    <h2 id="stB">Баннер объявления</h2>
    <p class="acc-sub">Полоса над шапкой сайта: например, «Открыта регистрация на турнир». Посетитель может её закрыть до конца сессии.</p>
    <p class="st-status" id="stBannerState" role="status">${d.bannerVisible ? 'Сейчас баннер виден на сайте.' : 'Сейчас баннер на сайте не показывается.'}</p>
    <label class="check block"><input type="checkbox" name="bannerEnabled" ${s.bannerEnabled ? 'checked' : ''} /><span class="box"></span><span>Показывать баннер</span></label>
    <div class="st-grid st-gap">
      ${text('st-bt', 'bannerText', 'Текст объявления', s.bannerText, { max: 200, hint: 'До 200 символов.' })}
      <div class="field"><label for="st-bu">Показывать до (включительно)</label><div class="control"><input id="st-bu" name="bannerUntil" type="date" value="${esc(s.bannerUntil)}" aria-describedby="st-bu-h" /></div><p class="hint-mut" id="st-bu-h">Действует весь этот день по Москве. Пусто — без срока.</p></div>
    </div>
    ${foot('stB')}
  </form>

  <form class="acc-card st-card" id="stRating" novalidate aria-labelledby="stR">
    <h2 id="stR">Формула рейтинга</h2>
    <p class="acc-sub">Очки игрока = очки его команды за каждый завершённый турнир: участие + место + победы в матчах. Новая формула сразу применяется ко всем турнирам, в том числе прошлым.</p>
    <div class="st-grid st-grid5">
      ${num('st-rp', 'ratingParticipation', 'За участие', s.ratingParticipation)}
      ${num('st-r1', 'ratingPlace1', 'За 1 место', s.ratingPlace1)}
      ${num('st-r2', 'ratingPlace2', 'За 2 место', s.ratingPlace2)}
      ${num('st-r3', 'ratingPlace3', 'За 3 место', s.ratingPlace3)}
      ${num('st-rw', 'ratingMatchWin', 'За победу в матче', s.ratingMatchWin)}
    </div>
    ${foot('stR', `<button type="button" class="btn btn-ghost btn-sm" data-act="defaults">Значения по умолчанию</button><button type="button" class="btn btn-ghost btn-sm" data-act="recalc">Пересчитать рейтинг</button>`)}
    <p class="hint-mut">«Пересчитать» заново считает рейтинг по результатам турниров и сбрасывает сохранённый на минуту результат.</p>
  </form>`;
};

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  adminOnly: true,
  title: 'Настройки сайта',
  description: 'Настройки сайта: контакты, баннер, формула рейтинга.',

  render: () => `
    <main class="acc adm">
      <div class="page-head"><h1 class="set-title">Настройки</h1><p class="acc-sub">Контакты, объявление на сайте и формула рейтинга. Все изменения пишутся в журнал.</p></div>
      ${adminNav('settings')}
      <div id="stBox" class="st-box" aria-live="polite"><div class="sk sk-card"></div></div>
    </main>`,

  mount(root) {
    let alive = true, data = null;
    const box = $('#stBox', root);

    async function load() {
      box.innerHTML = '<div class="sk sk-card"></div>';
      try { data = await admin.settings(); if (!alive) return; box.innerHTML = paint(data); }
      catch (e) {
        if (!alive) return;
        box.innerHTML = `<div class="acc-card acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить настройки.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-retry>Повторить</button></div>`;
      }
    }

    const read = (form) => {
      const out = {};
      for (const el of $$('input', form)) {
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else if (el.type === 'number') out[el.name] = el.value.trim() === '' ? '' : Number(el.value);
        else out[el.name] = el.value.trim();
      }
      return out;
    };

    async function save(form) {
      const key = form.id === 'stContacts' ? 'stC' : form.id === 'stBanner' ? 'stB' : 'stR';
      const err = $(`#${key}-err`, form), ok = $(`#${key}-ok`, form), btn = $('button[type=submit]', form);
      err.textContent = ''; ok.textContent = '';
      $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
      const values = read(form);
      if (form.id === 'stRating' && !confirm('Изменить формулу рейтинга? Очки всех игроков на сайте пересчитаются сразу.')) return;
      btn.disabled = true;
      try {
        const r = await admin.saveSettings(values);
        if (!alive) return;
        data = { ...data, settings: r.settings, bannerVisible: r.bannerVisible };
        const st = $('#stBannerState', root);
        if (st) st.textContent = r.bannerVisible ? 'Сейчас баннер виден на сайте.' : 'Сейчас баннер на сайте не показывается.';
        ok.textContent = r.changed ? 'Сохранено.' : 'Ничего не изменилось.';
        if (r.changed) refreshSite();
      } catch (e) {
        if (!alive) return;
        const m = saveError(e);
        err.textContent = m.text;
        const el = m.field && form.elements[m.field];
        if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
      }
      btn.disabled = false;
    }

    async function recalc(btn, form) {
      const err = $('#stR-err', form), ok = $('#stR-ok', form);
      err.textContent = ''; ok.textContent = '';
      if (!confirm('Пересчитать рейтинг игроков по текущей формуле?')) return;
      btn.disabled = true;
      try {
        const r = await admin.recalcRating();
        if (!alive) return;
        ok.textContent = `Рейтинг пересчитан. Игроков в рейтинге: ${r.players}.`;
      } catch (e) { if (alive) err.textContent = saveError(e).text; }
      btn.disabled = false;
    }

    root.addEventListener('submit', (e) => { const f = e.target.closest('form.st-card'); if (f) { e.preventDefault(); save(f); } });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return load();
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const form = b.closest('form');
      if (b.dataset.act === 'recalc') return recalc(b, form);
      if (b.dataset.act === 'defaults') {
        const d = data.defaults;
        for (const el of $$('input[type=number]', form)) el.value = d[el.name];
        $('#stR-ok', form).textContent = 'Подставлены значения по умолчанию. Нажмите «Сохранить», чтобы применить.';
        $('#stR-err', form).textContent = '';
      }
    });
    load();
    return () => { alive = false; };
  },
};
