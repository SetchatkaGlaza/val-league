import { $, $$, gsap, motion } from '../js/ui.js';
import { admin } from '../js/api.js';
import { ICON, esc } from './parts.js';
import { flash } from './team-parts.js';
import { statusBadge, tournamentError, rub, mapName, dateShort } from './tournament-parts.js';
import { regBadge, regStatusText, CANCEL_REASON } from './registration-parts.js';
import { mountAdminBracket } from './admin-bracket.js';

// Карты CS2 — тот же список, что в server/src/config.js (maps).
const MAPS = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo'];
const EDITABLE = ['draft', 'upcoming'];
const BRACKET_STATUSES = ['upcoming', 'live', 'finished'];   // в этих статусах у турнира есть раздел «Сетка и матчи»
const FLOW = {
  draft: [['upcoming', 'Опубликовать', 'primary']],
  upcoming: [['live', 'Начать турнир', 'primary'], ['draft', 'Вернуть в черновик', 'ghost'], ['cancelled', 'Отменить турнир', 'danger']],
  live: [['finished', 'Завершить турнир', 'primary'], ['cancelled', 'Отменить турнир', 'danger']],
  finished: [],
  cancelled: [['upcoming', 'Восстановить в анонс', 'primary'], ['draft', 'В черновик', 'ghost']],
};
const CONFIRM = {
  upcoming: 'Опубликовать турнир? Он станет виден всем на странице «Турниры».',
  live: 'Начать турнир? Регистрация закроется, часть полей перестанет редактироваться.',
  draft: 'Вернуть турнир в черновик? Он исчезнет с публичных страниц.',
  cancelled: 'Отменить турнир? Участники увидят, что он отменён.',
};

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** По умолчанию: ближайшая суббота 19:00, не раньше чем через неделю. */
function defaultStart() {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(19, 0, 0, 0);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return toLocal(d);
}

const field = (name, label, control, hint = '') => `
  <div class="field" data-field="${name}"><label for="f-${name}">${label}</label>${control}${hint ? `<p class="hint-mut">${hint}</p>` : ''}<p class="err" id="${name}-err" role="alert"></p></div>`;

const DEFAULTS = { name: '', description: '', startsAt: null, teamSize: 5, matchFormat: 'bo1', fee: 0, maxTeams: 16, mapPool: [], prizePlaces: [{ place: 1, amount: 0 }], registrationOpen: true, status: 'draft' };

const prizeRow = (p, i, off) => `
  <div class="prize-row" data-row><span class="pl">${i + 1} место</span>
    <div class="control"><input type="number" inputmode="numeric" min="0" max="10000000" step="100" value="${p.amount}" aria-label="Приз за ${i + 1} место, ₽" data-amount ${off ? 'disabled' : ''} /></div>
    <button type="button" class="btn btn-ghost btn-sm" data-act="prize-del" aria-label="Убрать ${i + 1} место" ${off ? 'disabled' : ''}>Убрать</button></div>`;

function formHtml(t, isNew) {
  const locked = !isNew && !EDITABLE.includes(t.status), off = locked ? 'disabled' : '';
  return `
  <form class="adm-form" id="tForm" novalidate>
    ${locked ? '<div class="banner" role="status">Турнир уже начался или закрыт: можно менять только описание и открытие регистрации.</div>' : ''}
    <div class="acc-grid">
      <section class="acc-card">
        <h2>Основное</h2>
        ${field('name', 'Название', `<div class="control"><input id="f-name" name="name" type="text" maxlength="60" value="${esc(t.name)}" placeholder="VAL Open #5" autocomplete="off" ${off} /></div>`)}
        ${field('startsAt', 'Дата и время начала', `<div class="control"><input id="f-startsAt" name="startsAt" type="datetime-local" value="${t.startsAt ? toLocal(t.startsAt) : defaultStart()}" ${off} /></div>`, 'По вашему времени; игроки увидят время в своём часовом поясе.')}
        <div class="two">
          ${field('teamSize', 'Формат состава', `<div class="control"><select id="f-teamSize" name="teamSize" ${off}><option value="5" ${t.teamSize === 5 ? 'selected' : ''}>5 на 5</option><option value="2" ${t.teamSize === 2 ? 'selected' : ''}>2 на 2</option></select></div>`)}
          ${field('matchFormat', 'Матч', `<div class="control"><select id="f-matchFormat" name="matchFormat" ${off}><option value="bo1" ${t.matchFormat === 'bo1' ? 'selected' : ''}>BO1</option><option value="bo3" ${t.matchFormat === 'bo3' ? 'selected' : ''}>BO3</option></select></div>`)}
        </div>
        <div class="two">
          ${field('maxTeams', 'Лимит команд', `<div class="control"><input id="f-maxTeams" name="maxTeams" type="number" inputmode="numeric" min="2" max="128" value="${t.maxTeams}" ${off} /></div>`, 'Для сетки удобны 8, 16, 32.')}
          ${field('fee', 'Взнос с команды, ₽', `<div class="control"><input id="f-fee" name="fee" type="number" inputmode="numeric" min="0" max="100000" step="50" value="${t.fee}" ${off} /></div>`, '0 — бесплатно.')}
        </div>
        <label class="check block"><input type="checkbox" name="registrationOpen" ${t.registrationOpen ? 'checked' : ''} /><span class="box"></span><span>Регистрация команд открыта</span></label>
      </section>
      <section class="acc-card">
        <h2>Призовые</h2><p class="acc-sub">Места идут по порядку. Сумма считается сама.</p>
        <div id="prizes">${t.prizePlaces.map((p, i) => prizeRow(p, i, locked)).join('')}</div>
        <p class="err" id="prizePlaces-err" role="alert"></p>
        <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="prize-add" ${off}>Добавить место</button><span class="prize-sum" id="prizeSum"></span></div>
        <h2 class="mt">Пул карт</h2>
        <fieldset class="maps-pick" ${off}><legend class="sr-only">Пул карт</legend>${MAPS.map((m) => `<label class="check chip-check"><input type="checkbox" name="map" value="${m}" ${t.mapPool.includes(m) ? 'checked' : ''} /><span class="box"></span>${esc(mapName(m))}</label>`).join('')}</fieldset>
        <p class="err" id="mapPool-err" role="alert"></p>
      </section>
      <section class="acc-card tm-wide">
        ${field('description', 'Описание', `<div class="control area"><textarea id="f-description" name="description" rows="6" maxlength="3000" placeholder="Расписание, правила допуска, особенности этого турнира">${esc(t.description)}</textarea></div>`, '<span id="descCount">0</span> / 3000')}
      </section>
    </div>
    <div class="banner" id="formBanner" role="alert" hidden></div>
    <div class="tg-actions sticky-actions">
      <button type="submit" class="btn btn-primary btn-sm" id="saveBtn"><span class="label">${isNew ? 'Создать черновик' : 'Сохранить'}</span><span class="spinner" aria-hidden="true"></span></button>
      <a href="/admin" class="btn btn-ghost btn-sm">${isNew ? 'Отмена' : 'К списку'}</a>
    </div>
  </form>`;
}

function statusPanel(t) {
  const acts = FLOW[t.status];
  return `
  <section class="acc-card adm-status">
    <div class="adm-status-top"><h2>Статус</h2>${statusBadge(t)}${t.status !== 'draft' ? `<a class="link" href="/tournaments/${esc(t.slug)}">Открыть страницу →</a>` : ''}</div>
    <p class="acc-sub">${{ draft: 'Черновик виден только администраторам.', upcoming: 'Турнир опубликован: виден на странице «Турниры».', live: 'Турнир идёт.', finished: 'Турнир завершён. Изменить его нельзя.', cancelled: 'Турнир отменён.' }[t.status]}</p>
    ${t.winner ? `<p class="acc-sub">Победитель: <b>${esc(t.winner.name)}</b>${t.winner.roster.length ? ` (${t.winner.roster.map(esc).join(', ')})` : ''}</p>` : ''}
    <div class="tg-actions">${acts.map(([to, label, kind]) => `<button type="button" class="btn ${kind === 'primary' ? 'btn-primary' : kind === 'danger' ? 'btn-danger' : 'btn-ghost'} btn-sm" data-act="status" data-to="${to}">${label}</button>`).join('')}
      ${['draft', 'cancelled'].includes(t.status) ? '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Удалить навсегда</button>' : ''}</div>
    <form class="finish-panel" id="finishForm" hidden novalidate>
      <p class="acc-sub">Укажите победителя — он появится на главной и в архиве. Можно оставить пустым и заполнить позже.</p>
      <div class="field"><label for="wName">Команда-победитель</label><div class="control"><input id="wName" type="text" maxlength="40" autocomplete="off" /></div></div>
      <div class="field"><label for="wRoster">Состав (через запятую, до 7 ников)</label><div class="control"><input id="wRoster" type="text" maxlength="160" autocomplete="off" /></div><p class="err" id="wRoster-err" role="alert"></p></div>
      <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm"><span class="label">Завершить турнир</span><span class="spinner" aria-hidden="true"></span></button><button type="button" class="btn btn-ghost btn-sm" data-act="finish-cancel">Отмена</button></div>
    </form>
  </section>`;
}

const when = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function regsSection(list, t) {
  const n = (st) => list.filter((r) => r.status === st).length;
  const refunds = list.filter((r) => r.refundDue).length;
  const summary = `Ждут оплаты: <b>${n('pending_payment')}</b> · Оплатили: <b>${n('paid')}</b> · Лист ожидания: <b>${n('waitlist')}</b>${refunds ? ` · <span class="warn">К возврату: <b>${refunds}</b></span>` : ''} · Мест: ${t.maxTeams}`;
  if (!list.length) return `<section class="acc-card" id="regsCard"><h2>Заявки команд</h2><div class="acc-empty"><p>Заявок пока нет.</p><span>Они появятся, когда капитаны начнут регистрироваться на странице турнира.</span></div></section>`;
  const actions = (r) => [
    r.status === 'pending_payment' ? `<button type="button" class="btn btn-primary btn-xs" data-ract="confirm" data-id="${r.id}">Подтвердить оплату</button>` : '',
    r.status === 'cancelled' && r.cancelReason === 'expired' && t.status === 'upcoming' ? `<button type="button" class="btn btn-ghost btn-xs" data-ract="confirm" data-id="${r.id}" title="Срок оплаты вышел, но перевод пришёл">Оплата пришла</button>` : '',
    ['pending_payment', 'waitlist', 'paid'].includes(r.status) ? `<button type="button" class="btn btn-danger btn-xs" data-ract="cancel" data-id="${r.id}" data-paid="${r.status === 'paid'}">Снять</button>` : '',
    r.refundDue ? `<button type="button" class="btn btn-ghost btn-xs" data-ract="refunded" data-id="${r.id}">Взнос возвращён</button>` : '',
  ].join('');
  return `
  <section class="acc-card" id="regsCard"><h2>Заявки команд</h2><p class="acc-sub">${summary}</p>
    <div class="tbl-wrap"><table class="tbl regs"><thead><tr><th>Команда</th><th>Состав</th><th>Статус</th><th>Оплата</th><th>Подана</th><th><span class="sr-only">Действия</span></th></tr></thead><tbody>
    ${list.map((r) => `<tr class="${r.status === 'cancelled' ? 'dim' : ''}">
      <td data-l="Команда"><b>${r.team.slug ? `<a class="link" href="/teams/${esc(r.team.slug)}">${esc(r.team.name)}</a>` : esc(r.team.name)}</b></td>
      <td data-l="Состав">${r.roster.map((p) => esc(p.nick)).join(', ')}</td>
      <td data-l="Статус">${regBadge(r)}${r.status === 'waitlist' ? ` <small>№ ${r.waitlistPosition}</small>` : ''}${r.status === 'cancelled' && r.cancelReason ? `<small class="sub">${CANCEL_REASON[r.cancelReason] || ''}</small>` : ''}${r.refundDue ? '<small class="sub warn">нужен возврат</small>' : ''}</td>
      <td data-l="Оплата">${r.fee ? `${rub(r.fee)}<small class="sub">код <code class="pay-code">${esc(r.paymentCode)}</code>${r.status === 'pending_payment' && r.payUntil ? ` · до ${when(r.payUntil)}` : ''}</small>` : 'бесплатно'}</td>
      <td data-l="Подана">${when(r.createdAt)}</td>
      <td class="tbl-act">${actions(r)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint-mut">Подтверждайте оплату после того, как перевод с кодом платежа пришёл. Статус игроки видят на странице турнира и в кабинете.</p>
  </section>`;
}

export default {
  layout: 'doc',
  protected: true,
  admin: true,
  title: 'Турнир — админка',
  description: 'Создание и редактирование турнира.',

  render: ({ params }) => `
    <main class="acc adm">
      <a href="/admin" class="back">${ICON.back}Админка</a>
      <h1 class="set-title" id="aTitle">${params.id ? 'Турнир' : 'Новый турнир'}</h1>
      <div id="aBody"><div class="tm-skel" aria-busy="true"><div class="sk sk-hero"></div><div class="sk sk-card"></div></div></div>
      <p class="tm-toast" id="toast" role="status" hidden></p>
    </main>`,

  mount(root, { params, navigate }) {
    const isNew = !params.id;
    let alive = true, t = null, dirty = false, toastTimer = 0, note = flash.take(), regs = [], bk = null;
    const body = $('#aBody', root), toast = $('#toast', root);

    const say = (text, ok = false) => {
      clearTimeout(toastTimer);
      toast.textContent = text; toast.className = 'tm-toast' + (ok ? ' ok' : ' bad'); toast.hidden = !text;
      if (text) toastTimer = setTimeout(() => { toast.hidden = true; }, ok ? 3000 : 7000);
    };
    const busy = (b, v) => { if (b) { b.disabled = v; b.classList.toggle('loading', v); } };
    const setErr = (name, msg) => { const f = $(`[data-field="${name}"]`, root); if (f) f.classList.toggle('invalid', !!msg); const e = $(`#${name}-err`, root); if (e) e.textContent = msg; return !msg; };

    async function loadRegs() {
      try {
        const r = await admin.registrations(t.id);
        if (!alive) return; regs = r.registrations;
        const slot = $('#regsSlot', root); if (slot) slot.innerHTML = regsSection(regs, t);
      } catch (e) {
        const slot = $('#regsSlot', root);
        if (alive && slot) slot.innerHTML = `<section class="acc-card"><h2>Заявки команд</h2><div class="acc-empty"><p>${esc(tournamentError(e, 'Не удалось загрузить заявки.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-ract="reload">Повторить</button></div></section>`;
      }
    }

    function paint() {
      if (bk) { bk.stop(); bk = null; }
      body.innerHTML = `${note ? `<div class="banner ok" role="status">${esc(note)}</div>` : ''}${isNew ? '' : `<div id="statusSlot">${statusPanel(t)}</div>`}${isNew ? '' : '<div id="regsSlot"><div class="sk sk-card"></div></div>'}${isNew || !BRACKET_STATUSES.includes(t.status) ? '' : '<div id="bracketSlot"></div>'}${formHtml(t, isNew)}`;
      if (!isNew) loadRegs();
      if ($('#bracketSlot', root)) bk = mountAdminBracket($('#bracketSlot', root), t, { say, onTournament: refreshTournament });
      note = null; dirty = false;
      $('#aTitle', root).textContent = isNew ? 'Новый турнир' : t.name;
      if (!isNew) document.title = `${t.name} — админка`;
      $('#descCount', root).textContent = $('#f-description', root).value.length;
      sum();
      if (motion) gsap.from($$('.acc-card', body), { y: 18, opacity: 0, duration: .5, stagger: .06, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
    const sum = () => {
      const total = $$('[data-amount]', root).reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
      const el = $('#prizeSum', root); if (el) el.textContent = `Итого: ${rub(total)}`;
    };

    /** Собирает значения формы. Возвращает { data, ok } — ok=false, если есть ошибки (они уже показаны у полей). */
    function collect() {
      const f = $('#tForm', root), locked = !isNew && !EDITABLE.includes(t.status);
      const data = { description: f.description.value.trim(), registrationOpen: f.registrationOpen.checked };
      let first = null, ok = true;
      const bad = (name, msg, el) => { ok = false; setErr(name, msg); first = first || el || f[name]; };
      if (f.description.value.trim().length > 3000) bad('description', 'Описание — не длиннее 3000 символов');
      else setErr('description', '');
      if (locked) return { data, ok, first };

      const name = f.name.value.trim().replace(/\s+/g, ' ');
      name.length < 3 || name.length > 60 ? bad('name', 'Название — от 3 до 60 символов') : setErr('name', '');
      const when = new Date(f.startsAt.value);
      // Дату проверяем на «будущее» только если её меняют: у опубликованного турнира время старта могло пройти, а описание поправить нужно.
      const unchanged = !isNew && f.startsAt.value === toLocal(t.startsAt);
      !f.startsAt.value || isNaN(when) ? bad('startsAt', 'Укажите дату и время') : !unchanged && when <= new Date() ? bad('startsAt', 'Дата должна быть в будущем') : setErr('startsAt', '');
      const maxTeams = Number(f.maxTeams.value), fee = Number(f.fee.value);
      !Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 128 ? bad('maxTeams', 'От 2 до 128 команд') : setErr('maxTeams', '');
      !Number.isInteger(fee) || fee < 0 || fee > 100000 ? bad('fee', 'От 0 до 100 000 ₽') : setErr('fee', '');
      const amounts = $$('[data-amount]', root).map((i) => i.value.trim() === '' ? NaN : Number(i.value));
      if (amounts.some((a) => !Number.isInteger(a) || a < 0 || a > 10_000_000)) bad('prizePlaces', 'Укажите сумму для каждого места (0 — без приза)', $('[data-amount]', root));
      else setErr('prizePlaces', '');
      Object.assign(data, {
        name, startsAt: isNaN(when) ? undefined : (unchanged ? t.startsAt : when.toISOString()), teamSize: Number(f.teamSize.value), matchFormat: f.matchFormat.value, maxTeams, fee,
        mapPool: $$('[name="map"]:checked', root).map((i) => i.value), prizePlaces: amounts.map((amount, i) => ({ place: i + 1, amount })),
      });
      return { data, ok, first };
    }

    async function save(btn) {
      const { data, ok, first } = collect();
      if (!ok) { first && first.focus(); return; }
      busy(btn, true);
      try {
        if (isNew) {
          const r = await admin.create(data);
          flash.set('Турнир создан как черновик. Проверьте данные и опубликуйте его, когда будет готов.');
          if (alive) { dirty = false; navigate(`/admin/tournaments/${r.tournament.id}`); }
          return;
        }
        const r = await admin.update(t.id, data);
        if (!alive) return;
        t = r.tournament; dirty = false; paint(); say('Изменения сохранены.', true);
      } catch (e) {
        if (!alive) return;
        busy(btn, false);
        if (e.code === 'validation' && e.field && $(`#${e.field}-err`, root)) setErr(e.field, e.field === 'startsAt' ? 'Дата должна быть в будущем' : 'Проверьте это поле');
        else say(tournamentError(e));
      }
    }

    /** Турнир мог измениться сам (результат финала завершает его): обновляем панель статуса, не трогая форму. */
    async function refreshTournament() {
      try {
        const r = await admin.get(t.id);
        if (!alive) return;
        t = r.tournament;
        const slot = $('#statusSlot', root); if (slot) slot.innerHTML = statusPanel(t);
        if (bk) bk.setTournament(t);
      } catch { /* панель обновится при следующем действии */ }
    }

    async function changeStatus(btn, to, extra = {}) {
      if (dirty && !confirm('Есть несохранённые изменения формы — они не сохранятся при смене статуса. Продолжить?')) return;
      busy(btn, true);
      try { const r = await admin.setStatus(t.id, { status: to, ...extra }); if (!alive) return; t = r.tournament; paint(); say('Статус изменён.', true); }
      catch (e) { if (alive) { busy(btn, false); say(tournamentError(e)); } }
    }

    root.addEventListener('click', async (e) => {
      const rb = e.target.closest('[data-ract]');
      if (rb && !rb.disabled) {
        const id = rb.dataset.id, act = rb.dataset.ract;
        if (act === 'reload') return loadRegs();
        let note;
        if (act === 'cancel') {
          note = prompt(rb.dataset.paid === 'true' ? 'Заявка оплачена: взнос придётся вернуть вручную. Причина (необязательно):' : 'Снять заявку. Причина (необязательно):');
          if (note === null) return;
        }
        if (act === 'confirm' && !confirm('Подтвердить оплату? Команда получит статус «Участие подтверждено».')) return;
        busy(rb, true);
        try {
          if (act === 'confirm') await admin.confirm(id);
          else if (act === 'cancel') await admin.cancelReg(id, note.trim() || undefined);
          else await admin.refunded(id);
          if (!alive) return;
          await loadRegs(); say('Готово.', true);
          // Сервер мог сбросить сетку (состав оплаченных команд изменился): перечитываем её, счётчики мест обновляем, не трогая форму
          if (bk) bk.reload();
          admin.get(t.id).then((r) => { if (alive) { t = r.tournament; if (bk) bk.setTournament(t); } }).catch(() => {});
        } catch (err) { if (alive) { busy(rb, false); say(tournamentError(err)); } }
        return;
      }
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      switch (b.dataset.act) {
        case 'prize-add': {
          const rows = $$('[data-row]', root); if (rows.length >= 8) { say('Не больше 8 призовых мест.'); return; }
          $('#prizes', root).insertAdjacentHTML('beforeend', prizeRow({ amount: 0 }, rows.length, false));
          $$('[data-amount]', root).pop().focus(); dirty = true; sum(); break;
        }
        case 'prize-del': {
          const rows = $$('[data-row]', root); if (rows.length <= 1) { say('Нужно хотя бы одно призовое место (можно указать 0).'); return; }
          b.closest('[data-row]').remove();
          // Перенумеровываем, чтобы места шли по порядку
          $$('[data-row]', root).forEach((r, i) => { $('.pl', r).textContent = `${i + 1} место`; $('[data-amount]', r).setAttribute('aria-label', `Приз за ${i + 1} место, ₽`); $('[data-act]', r).setAttribute('aria-label', `Убрать ${i + 1} место`); });
          dirty = true; sum(); break;
        }
        case 'status': {
          const to = b.dataset.to;
          if (to === 'finished') { $('#finishForm', root).hidden = false; b.hidden = true; $('#wName', root).focus(); break; }
          if (confirm(CONFIRM[to])) changeStatus(b, to);
          break;
        }
        case 'finish-cancel': $('#finishForm', root).hidden = true; $$('[data-act="status"][data-to="finished"]', root).forEach((x) => { x.hidden = false; }); break;
        case 'delete':
          if (confirm(`Удалить турнир «${t.name}» навсегда? Это нельзя отменить.`)) {
            busy(b, true);
            try { await admin.remove(t.id); flash.set('Турнир удалён.'); if (alive) navigate('/admin'); } catch (err) { if (alive) { busy(b, false); say(tournamentError(err)); } }
          }
          break;
        default:
      }
    });

    root.addEventListener('input', (e) => {
      if (e.target.closest('#tForm')) dirty = true;
      if (e.target.matches('[data-amount]')) sum();
      if (e.target.id === 'f-description') $('#descCount', root).textContent = e.target.value.length;
      const field = e.target.closest('.field'); if (field) { field.classList.remove('invalid'); const er = $('.err', field); if (er) er.textContent = ''; }
    });

    root.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'tForm') return save($('#saveBtn', root));
      if (e.target.id === 'finishForm') {
        const roster = $('#wRoster', root).value.split(',').map((s) => s.trim()).filter(Boolean);
        if (roster.length > 7 || roster.some((n) => n.length > 20)) { $('#wRoster-err', root).textContent = 'До 7 ников, каждый — до 20 символов'; return; }
        $('#wRoster-err', root).textContent = '';
        changeStatus($('button[type=submit]', e.target), 'finished', { winnerName: $('#wName', root).value.trim() || undefined, winnerRoster: roster });
      }
    });

    // Уход со страницы с несохранёнными правками: браузер переспросит при закрытии вкладки
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', beforeUnload);
    // Переходы по ссылкам внутри сайта (шапка, «Назад к списку») тоже не должны молча терять правки.
    const guardLinks = (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (dirty && a && !a.target && !confirm('Есть несохранённые изменения. Уйти без сохранения?')) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', guardLinks, true);

    (async () => {
      if (isNew) { t = { ...DEFAULTS }; paint(); $('#f-name', root).focus({ preventScroll: true }); return; }
      try { t = (await admin.get(params.id)).tournament; if (alive) paint(); }
      catch (e) {
        if (!alive) return;
        body.innerHTML = `<section class="stub tm-state"><h1>${e.code === 'not_found' ? 'Турнир не найден' : 'Не удалось загрузить'}</h1><p>${esc(e.code === 'not_found' ? 'Возможно, его уже удалили.' : tournamentError(e))}</p><div class="stub-actions"><a href="/admin" class="btn btn-primary">В админку</a></div></section>`;
      }
    })();
    return () => { alive = false; if (bk) bk.stop(); clearTimeout(toastTimer); removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', guardLinks, true); };
  },
};
