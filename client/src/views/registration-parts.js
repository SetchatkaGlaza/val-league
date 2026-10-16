import { $, $$ } from '../js/ui.js';
import { registrations } from '../js/api.js';
import { getUser } from '../js/session.js';
import { esc } from './parts.js';
import { teamLogo } from './team-parts.js';
import { rub, dateLong, tournamentError } from './tournament-parts.js';

// ---------- Общее: статусы заявок (используется и в кабинете, и в админке) ----------
export const REG_STATUS = {
  pending_payment: ['Ждёт оплаты', 'soon'],
  paid: ['Участие подтверждено', 'open'],
  waitlist: ['Лист ожидания', 'draft'],
  cancelled: ['Снята', 'cancel'],
};
export const CANCEL_REASON = {
  captain: 'Отменена капитаном',
  admin: 'Снята организаторами',
  expired: 'Не оплачена вовремя',
  tournament_started: 'Турнир начался, оплаты не было',
  tournament_cancelled: 'Турнир отменён',
};
export const regBadge = (r) => `<span class="st st-${REG_STATUS[r.status][1]}">${REG_STATUS[r.status][0]}</span>`;
export const regStatusText = (r) => (r.status === 'waitlist' && r.waitlistPosition ? `Лист ожидания, № ${r.waitlistPosition}` : REG_STATUS[r.status][0]);

const rosterChips = (roster) => `<ul class="chips">${roster.map((p) => `<li>${esc(p.nick)}</li>`).join('')}</ul>`;

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const i = document.createElement('input'); i.value = text; document.body.appendChild(i); i.select();
    try { document.execCommand('copy'); } catch { /* без буфера обмена код можно выделить вручную */ }
    i.remove();
  }
  const old = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => { btn.textContent = old; }, 1800);
}

// ---------- Разметка ----------
function paymentBlock(r) {
  const p = r.payment;
  return `
  <div class="pay-box">
    <p class="label">Как оплатить</p>
    <dl class="facts">
      <div><dt>Сумма</dt><dd>${rub(p.amount)}</dd></div>
      <div><dt>Код платежа</dt><dd><code class="pay-code">${esc(p.code)}</code> <button type="button" class="btn btn-ghost btn-xs" data-act="copy" data-copy="${esc(p.code)}">Копировать</button></dd></div>
      <div><dt>Оплатить до</dt><dd>${dateLong(p.until)}</dd></div>
    </dl>
    <p class="pay-details">${esc(p.details)}</p>
    <p class="hint-mut">Укажите код в комментарии к переводу. Организатор проверит оплату вручную и подтвердит её, статус изменится здесь. Если срок выйдет, место перейдёт следующей команде.</p>
  </div>`;
}

function rosterForm(team, t, data, reg) {
  const size = t.teamSize, picked = new Set(reg ? reg.roster.map((p) => p.id) : []);
  const ok = (m) => m.verified && !m.busy && (!data.requireSteam || m.steam);
  // По умолчанию выбираем основу, пока хватает места
  if (!reg) team.members.filter(ok).slice(0, size).forEach((m) => picked.add(m.id));
  const why = (m) => (!m.verified ? 'почта не подтверждена' : m.busy ? 'уже в другой заявке' : data.requireSteam && !m.steam ? 'нет Steam' : '');
  return `
  <form class="reg-form" data-slug="${esc(team.slug)}" data-size="${size}" ${reg ? `data-reg="${reg.id}"` : ''} novalidate>
    <p class="acc-sub">${reg ? 'Измените состав заявки.' : `Выберите игроков, которые выйдут на сервер.`} Нужно ровно <b>${size}</b>. Выбрано: <b data-count>0</b> из ${size}.</p>
    <ul class="roster-pick">${team.members.map((m) => `
      <li><label class="check chip-check ${ok(m) ? '' : 'off'}"><input type="checkbox" name="p" value="${m.id}" ${picked.has(m.id) && ok(m) ? 'checked' : ''} ${ok(m) ? '' : 'disabled'} /><span class="box"></span>
        <span class="rp-t">${esc(m.nick)}<small>${m.role === 'main' ? 'основа' : 'запас'}${why(m) ? ` · ${why(m)}` : ''}</small></span></label></li>`).join('')}</ul>
    ${team.members.length < size ? `<p class="hint-mut">В команде пока ${team.members.length} из ${size} нужных игроков. Пригласите ещё на странице команды.</p>` : ''}
    ${reg ? '' : `<label class="check block"><input type="checkbox" name="rules" /><span class="box"></span><span>Я прочитал(а) <a href="/rules" target="_blank" rel="noopener" class="link">регламент</a> и принимаю его от имени команды</span></label>`}
    <p class="err" data-err role="alert"></p>
    <div class="t-actions"><button type="submit" class="btn btn-primary btn-sm"><span class="label">${reg ? 'Сохранить состав' : 'Отправить заявку'}</span><span class="spinner" aria-hidden="true"></span></button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="form-close">Отмена</button></div>
  </form>`;
}

function regCard(team, reg, t, data, mode) {
  const editing = mode?.type === 'edit' && mode.slug === team.slug;
  const waiting = reg.status === 'waitlist';
  return `
  <div class="reg-card" data-team="${esc(team.slug)}">
    <div class="reg-head">${teamLogo(team, 'sm')}<div class="mem-t"><b>${esc(team.name)}</b><span>Заявка подана</span></div>${regBadge(reg)}</div>
    ${reg.status === 'paid' ? '<p class="t-note ok">Участие подтверждено. До старта проверьте состав и будьте готовы к матчам.</p>' : ''}
    ${waiting ? `<p class="t-note">Все места заняты. Ваш номер в листе ожидания: <b>${reg.waitlistPosition}</b>. Если место освободится, оно перейдёт команде автоматически, и появятся реквизиты для оплаты.</p>` : ''}
    ${reg.status === 'pending_payment' ? paymentBlock(reg) : ''}
    <p class="label">Состав заявки</p>${rosterChips(reg.roster)}
    ${editing ? rosterForm(team, t, data, reg) : `
      <div class="t-actions">
        ${reg.canEdit ? '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Изменить состав</button>' : ''}
        ${reg.canEdit || waiting ? `<button type="button" class="btn btn-danger btn-sm" data-act="cancel" data-id="${reg.id}">Отменить заявку</button>` : ''}
      </div>
      ${reg.canEdit ? '' : '<p class="hint-mut">Состав и заявка зафиксированы: до старта осталось слишком мало времени. Если нужна замена, напишите организаторам.</p>'}`}
  </div>`;
}

function newCard(team, t, data, mode) {
  const open = mode?.type === 'new' && mode.slug === team.slug;
  const full = t.teamsCount >= t.maxTeams;
  return `
  <div class="reg-card" data-team="${esc(team.slug)}">
    <div class="reg-head">${teamLogo(team, 'sm')}<div class="mem-t"><b>${esc(team.name)}</b><span>${team.members.length} в команде</span></div></div>
    ${open ? rosterForm(team, t, data, null) : `
      ${full ? `<p class="t-note">Мест нет, но можно встать в лист ожидания (до ${data.waitlistMax} команд): если кто-то откажется, место займёт ваша команда.</p>` : ''}
      <div class="t-actions"><button type="button" class="btn btn-primary btn-sm" data-act="open" ${data.canRegister ? '' : 'disabled'}>${full ? 'Встать в лист ожидания' : 'Зарегистрировать команду'}</button></div>`}
  </div>`;
}

function closedNote(t, data) {
  if (!t.registrationOpen) return 'Регистрация пока не открыта. Следите за анонсами.';
  return `Регистрация закрыта: она заканчивается ${dateLong(data.closesAt)}.`;
}

function render(S) {
  const { t, data, mode } = S;
  const parts = [];
  const hasAny = data.teams.some((x) => x.registration);
  if (!hasAny && !data.canRegister) parts.push(`<p class="t-note">${closedNote(t, data)}</p>`);
  if (!data.teams.length && !data.asPlayer.length && data.canRegister) {
    parts.push(`<p class="t-note">Регистрирует команду её капитан. Создайте команду и пригласите ${t.teamSize === 5 ? 'ещё минимум 4 игроков' : 'второго игрока'}: ${t.teamSize} ${t.teamSize === 5 ? 'игроков' : 'игрока'} в составе заявки.</p>
      <div class="t-actions"><a href="/teams/new" class="btn btn-primary btn-sm">Создать команду</a><a href="/teams" class="btn btn-ghost btn-sm">Найти команду</a></div>`);
  }
  if (data.teams.length && data.canRegister && !hasAny) {
    parts.push(`<p class="t-note">${t.fee ? `Взнос ${rub(t.fee)} с команды. После заявки появятся реквизиты; место держим ${data.holdHours} ч.` : 'Участие бесплатное.'} Свободных мест: ${Math.max(t.maxTeams - t.teamsCount, 0)} из ${t.maxTeams}.</p>`);
  }
  for (const team of data.teams) parts.push(team.registration ? regCard(team, team.registration, t, data, mode) : newCard(team, t, data, mode));
  for (const r of data.asPlayer) {
    parts.push(`<div class="reg-card"><div class="reg-head">${teamLogo(r.team, 'sm')}<div class="mem-t"><b>${esc(r.team.name)}</b><span>Вы в составе заявки</span></div>${regBadge(r)}</div>${rosterChips(r.roster)}<p class="hint-mut">Заявкой управляет капитан команды.</p></div>`);
  }
  return parts.join('');
}

/**
 * Блок регистрации внутри страницы турнира (только для upcoming).
 * onChange() вызывается после успешных действий: страница перезагружает счётчики мест и список команд.
 */
export function mountRegistration(el, t, { onChange }) {
  const user = getUser();
  let alive = true;
  const S = { t, data: null, mode: null };

  if (!user) {
    el.innerHTML = `<p class="t-note">Чтобы подать заявку, войдите: регистрацию делает капитан команды.</p>
      <div class="t-actions"><a href="/login?next=/tournaments/${esc(t.slug)}" class="btn btn-primary btn-sm">Войти</a><a href="/register" class="btn btn-ghost btn-sm">Создать аккаунт</a></div>`;
    return () => {};
  }

  const paint = () => {
    el.innerHTML = render(S);
    $$('.reg-form', el).forEach(count);
  };
  const count = (form) => { const n = $$('input[name="p"]:checked', form).length; $('[data-count]', form).textContent = n; };
  const busy = (b, v) => { b.disabled = v; b.classList.toggle('loading', v); };

  async function load() {
    try { S.data = await registrations.eligibility(t.slug); }
    catch (e) { if (alive) el.innerHTML = `<p class="t-note bad">${esc(tournamentError(e, 'Не удалось загрузить данные регистрации.'))}</p><button type="button" class="btn btn-ghost btn-sm" data-act="retry">Повторить</button>`; return; }
    if (alive) paint();
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const slug = b.closest('[data-team]')?.dataset.team;
    switch (b.dataset.act) {
      case 'retry': el.innerHTML = '<div class="sk sk-line"></div>'; load(); break;
      case 'open': S.mode = { type: 'new', slug }; paint(); $('.reg-form input:not(:disabled)', el)?.focus(); break;
      case 'edit': S.mode = { type: 'edit', slug }; paint(); break;
      case 'form-close': S.mode = null; paint(); break;
      case 'copy': copyText(b.dataset.copy, b); break;
      case 'cancel': {
        if (!confirm('Отменить заявку? Освободившееся место получит следующая команда. Если заявка уже оплачена, взнос вернут организаторы.')) break;
        busy(b, true);
        try { await registrations.cancel(b.dataset.id); if (alive) { S.mode = null; await onChange(); } }
        catch (err) { if (alive) { busy(b, false); alert(tournamentError(err)); } }
        break;
      }
      default:
    }
  });

  el.addEventListener('change', (e) => { const f = e.target.closest('.reg-form'); if (f) { count(f); $('[data-err]', f).textContent = ''; } });

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.closest('.reg-form'); if (!f) return;
    const err = $('[data-err]', f), btn = $('button[type=submit]', f), size = Number(f.dataset.size);
    const roster = $$('input[name="p"]:checked', f).map((i) => i.value);
    if (roster.length !== size) { err.textContent = `Выберите ровно ${size}: сейчас выбрано ${roster.length}.`; return; }
    const rules = f.elements.rules;
    if (rules && !rules.checked) { err.textContent = 'Подтвердите, что принимаете регламент.'; rules.focus(); return; }
    busy(btn, true);
    try {
      if (f.dataset.reg) await registrations.roster(f.dataset.reg, roster);
      else await registrations.create(t.slug, { teamSlug: f.dataset.slug, roster, acceptRules: true });
      if (alive) { S.mode = null; await onChange(); }
    } catch (ex) {
      if (!alive) return;
      busy(btn, false);
      err.textContent = tournamentError(ex);
      // Состав мог измениться за это время (игрока заняли в другой заявке): перечитываем данные, оставляя форму открытой
      if (['player_busy', 'roster_unverified', 'not_member', 'registration_closed', 'already_registered', 'tournament_full'].includes(ex.code)) {
        const keep = err.textContent; await load(); const nf = $('.reg-form [data-err]', el); if (nf) nf.textContent = keep;
      }
    }
  });

  el.innerHTML = '<div class="sk sk-line"></div>';
  load();
  return () => { alive = false; };
}
