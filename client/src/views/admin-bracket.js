import { $ } from '../js/ui.js';
import { admin } from '../js/api.js';
import { esc } from './parts.js';
import { tournamentError, mapName, MATCH } from './tournament-parts.js';
import { matchBadge, whenShort, sideName, forfeitLabel } from './bracket-parts.js';

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const SEEDING = {
  random: ['Жеребьёвка', 'Случайный порядок. Свободные места в сетке достанутся случайным командам.'],
  registration: ['По порядку оплаты', 'Первые оплатившие становятся сеяными: сильнейшие места и проход без игры достаются им.'],
  manual: ['Вручную', 'Порядок в списке и есть посев: первая команда сеяная № 1, и так далее. Сильнейшие встретятся как можно позже.'],
};

/** Та же проверка, что на сервере (services/bracket.js validateScore): ошибка видна до отправки. */
function scoreError(format, a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 'Введите счёт обеих команд целыми числами.';
  if (a === b) return 'Ничьей не бывает: у одной команды счёт должен быть больше.';
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (format === 'bo3') return hi === 2 && lo <= 1 ? '' : 'BO3 считается по картам: 2:0 или 2:1.';
  return hi <= 99 ? '' : 'Счёт не больше 99.';
}

/** Та же проверка, что на сервере (validateMaps): серия BO3 по картам должна закончиться 2:0 или 2:1. */
function mapsError(maps) {
  if (maps.length < 2) return 'Укажите счёт минимум двух карт.';
  let wa = 0, wb = 0;
  for (const x of maps) {
    if (!Number.isInteger(x.a) || !Number.isInteger(x.b) || x.a < 0 || x.b < 0 || x.a > 99 || x.b > 99) return 'Счёт каждой карты — целые числа от 0 до 99.';
    if (x.a === x.b) return 'На карте не бывает ничьей: у одной команды очков должно быть больше.';
    if (x.a > x.b) wa++; else wb++;
  }
  if (maps.length === 2 && wa === 1) return 'Карты разделились 1:1: нужна третья карта.';
  if (maps.length === 3 && (wa === 0 || wb === 0)) return 'Серия закончилась 2:0, третьей карты не было.';
  return '';
}

/**
 * Раздел «Сетка и матчи» на странице турнира в админке.
 * host — контейнер, t — турнир (нужны id, slug, status, matchFormat), ctx.say — всплывающее сообщение,
 * ctx.onTournament — вызывается, когда статус турнира мог измениться (результат финала завершает турнир).
 */
export function mountAdminBracket(host, t, ctx) {
  let alive = true, data = null, error = '', editing = null, schedOpen = false, seeding = 'random', order = null, loadingOrder = false, working = false;

  const say = (m, ok) => ctx.say(m, ok);

  async function load() {
    try { data = await admin.bracket(t.id); error = ''; }
    catch (e) { error = tournamentError(e, 'Не удалось загрузить сетку.'); }
    if (alive) draw();
  }

  /** Список оплаченных команд для ручного посева: порядок подачи заявок, дальше админ двигает сам. */
  async function loadOrder() {
    if (order || loadingOrder) return;
    loadingOrder = true;
    try {
      const r = await admin.registrations(t.id);
      order = r.registrations.filter((x) => x.status === 'paid').map((x) => ({ id: x.id, name: x.team.name }));   // порядок подачи заявок
    } catch (e) { say(tournamentError(e, 'Не удалось загрузить команды.')); seeding = 'random'; }
    loadingOrder = false;
    if (alive) draw();
  }

  const matchRow = (m) => {
    const live = t.status === 'live', fin = t.status === 'finished';
    const hasBoth = !!(m.a && m.b);
    const score = m.status === 'finished' && !m.bye ? `<b class="bm-score">${m.scoreA}:${m.scoreB}</b>${m.forfeit ? `<span class="st st-draft">${forfeitLabel(m)}</span>` : ''}` : '';
    const acts = m.bye ? '' : [
      (live || fin) && hasBoth ? `<button type="button" class="btn btn-${m.status === 'finished' ? 'ghost' : 'primary'} btn-xs" data-bact="result" data-id="${m.id}">${m.status === 'finished' ? 'Исправить счёт' : 'Ввести результат'}</button>` : '',
      live && m.status === 'ready' ? `<button type="button" class="btn btn-ghost btn-xs" data-bact="start" data-id="${m.id}">Матч начался</button>` : '',
      live && m.status === 'live' ? `<button type="button" class="btn btn-ghost btn-xs" data-bact="unstart" data-id="${m.id}">Вернуть в «готов»</button>` : '',
      hasBoth && m.status !== 'finished' ? `<button type="button" class="btn btn-ghost btn-xs" data-bact="edit" data-id="${m.id}">Время и лобби</button>` : '',
      `<a class="btn btn-ghost btn-xs" href="/matches/${m.id}">Страница</a>`,
    ].join('');
    const mapsText = m.maps ? m.maps.map((x) => `${x.map ? `${mapName(x.map)} ` : ''}${x.a}:${x.b}`).join(' · ') : '';
    const meta = [m.startsAt ? whenShort(m.startsAt) : '', m.hasLobby ? 'лобби добавлено' : '', mapsText].filter(Boolean).join(' · ');
    return `
    <li class="bm${m.bye ? ' dim' : ''}" data-mid="${m.id}">
      <div class="bm-main">
        <span class="bm-teams"><span class="${m.winner === 'a' ? 'pw' : ''}">${sideName(m, 'a')}</span><i>—</i><span class="${m.winner === 'b' ? 'pw' : ''}">${sideName(m, 'b')}</span></span>
        ${score}${matchBadge(m)}${meta ? `<small class="bm-meta">${meta}</small>` : ''}
      </div>
      ${acts ? `<div class="bm-act">${acts}</div>` : ''}
      ${editing && editing.id === m.id ? editor(m) : ''}
    </li>`;
  };

  const editor = (m) => {
    if (editing.kind === 'result') {
      const bo3 = t.matchFormat === 'bo3', pool = t.mapPool || [];
      const ff = m.forfeit ? (m.forfeitReason === 'noshow' ? 'noshow' : 'tech') : bo3 && m.status === 'finished' && !m.maps ? 'series' : 'played';
      const w = bo3 ? '2:0' : '13:0';
      const mm = m.maps || [];
      const mapRow = (i) => {
        const x = mm[i] || {};
        const opts = [...new Set([...pool, ...(x.map ? [x.map] : [])])];
        return `<fieldset class="bm-map" data-maprow="${i}" ${i === 2 && mm.length < 3 ? 'hidden' : ''}>
          <legend>Карта ${i + 1}</legend>
          <div class="control"><select name="map${i}" aria-label="Карта ${i + 1}"><option value="">Карта не указана</option>${opts.map((o) => `<option value="${esc(o)}" ${x.map === o ? 'selected' : ''}>${esc(mapName(o))}</option>`).join('')}</select></div>
          <div class="bm-score-in">
            <label><span>${esc(m.a.name)}</span><input type="number" inputmode="numeric" min="0" max="99" name="ma${i}" value="${x.a ?? ''}" /></label>
            <i>:</i>
            <label><span>${esc(m.b.name)}</span><input type="number" inputmode="numeric" min="0" max="99" name="mb${i}" value="${x.b ?? ''}" /></label>
          </div>
          <div class="field"><label>Демо карты (необязательно)<div class="control"><input type="url" name="md${i}" maxlength="300" value="${esc(x.demoUrl || '')}" placeholder="https://…" /></div></label></div>
        </fieldset>`;
      };
      return `<form class="bm-form" data-bform="result" novalidate>
        <div class="field"><label>Как закончился матч<div class="control"><select name="kind">
          <option value="played" ${ff === 'played' ? 'selected' : ''}>${bo3 ? 'Сыгран, счёт по картам' : 'Сыгран, есть счёт'}</option>
          ${bo3 ? `<option value="series" ${ff === 'series' ? 'selected' : ''}>Сыгран, только итог серии (2:0 или 2:1)</option>` : ''}
          <option value="tech" ${ff === 'tech' ? 'selected' : ''}>Техническое поражение</option>
          <option value="noshow" ${ff === 'noshow' ? 'selected' : ''}>Неявка</option>
        </select></div></label></div>
        ${m.status === 'finished' ? '<p class="acc-sub">Если победитель изменится, он автоматически заменится в следующем матче.</p>' : ''}
        ${bo3 ? `<div data-part="maps" ${ff === 'played' ? '' : 'hidden'}>
          <p class="acc-sub">Очки раундов на каждой карте. Третья карта появится, если первые две разделились.</p>
          ${[0, 1, 2].map(mapRow).join('')}
        </div>` : ''}
        <div data-part="score" ${ff === (bo3 ? 'series' : 'played') ? '' : 'hidden'}>
          <p class="acc-sub">${bo3 ? 'Итог серии по картам: 2:0 или 2:1.' : 'BO1: счёт по раундам, например 13:7.'}</p>
          <div class="bm-score-in">
            <label><span>${esc(m.a.name)}</span><input type="number" inputmode="numeric" min="0" max="99" name="a" value="${m.forfeit || m.maps ? '' : m.scoreA ?? ''}" /></label>
            <i>:</i>
            <label><span>${esc(m.b.name)}</span><input type="number" inputmode="numeric" min="0" max="99" name="b" value="${m.forfeit || m.maps ? '' : m.scoreB ?? ''}" /></label>
          </div>
        </div>
        <fieldset class="bm-loser" data-part="loser" ${ff === 'tech' || ff === 'noshow' ? '' : 'hidden'}>
          <legend>Какая команда проиграла</legend>
          <label class="check"><input type="radio" name="loser" value="a" ${m.forfeit === 'a' ? 'checked' : ''} /><span class="box"></span>${esc(m.a.name)}</label>
          <label class="check"><input type="radio" name="loser" value="b" ${m.forfeit === 'b' ? 'checked' : ''} /><span class="box"></span>${esc(m.b.name)}</label>
          <p class="hint-mut">Победителю запишется счёт ${w}, он пройдёт дальше. Результат можно исправить позже.</p>
        </fieldset>
        <div class="field" data-part="demo" ${ff === 'played' && bo3 ? 'hidden' : ''}><label>Ссылка на демо (необязательно)<div class="control"><input type="url" name="demoUrl" maxlength="300" value="${esc(m.demoUrl || '')}" placeholder="https://…" /></div></label></div>
        <p class="err" data-ferr role="alert"></p>
        <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm"><span class="label">Сохранить результат</span><span class="spinner" aria-hidden="true"></span></button><button type="button" class="btn btn-ghost btn-sm" data-bact="close">Отмена</button></div>
      </form>`;
    }
    return `<form class="bm-form" data-bform="edit" novalidate>
      <div class="field"><label>Время матча<div class="control"><input type="datetime-local" name="startsAt" value="${m.startsAt ? toLocal(m.startsAt) : ''}" /></div></label></div>
      <div class="field"><label>Данные для подключения<div class="control area"><textarea name="lobby" rows="3" maxlength="300" placeholder="connect ip:порт; password пароль">${esc(m.lobby || '')}</textarea></div></label><p class="hint-mut">Видят только участники матча и админы, пока матч не сыгран.</p></div>
      <div class="field"><label>Ссылка на демо (после матча)<div class="control"><input type="url" name="demoUrl" maxlength="300" value="${esc(m.demoUrl || '')}" placeholder="https://…" /></div></label></div>
      <p class="err" data-ferr role="alert"></p>
      <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm"><span class="label">Сохранить</span><span class="spinner" aria-hidden="true"></span></button><button type="button" class="btn btn-ghost btn-sm" data-bact="close">Отмена</button></div>
    </form>`;
  };

  function genPanel() {
    if (t.status !== 'upcoming') return '';
    const has = data.rounds.length > 0;
    const can = data.canGenerate;
    const list = seeding === 'manual' ? (order
      ? `<ol class="seed-list">${order.map((o, i) => `<li><span class="seed-n">${i + 1}</span><span class="seed-t">${esc(o.name)}</span><span class="seed-b"><button type="button" class="btn btn-ghost btn-xs" data-seed="up" data-i="${i}" aria-label="Поднять ${esc(o.name)}" ${i === 0 ? 'disabled' : ''}>Выше</button><button type="button" class="btn btn-ghost btn-xs" data-seed="down" data-i="${i}" aria-label="Опустить ${esc(o.name)}" ${i === order.length - 1 ? 'disabled' : ''}>Ниже</button></span></li>`).join('')}</ol>`
      : '<div class="sk sk-card"></div>') : '';
    return `
    <div class="bk-gen">
      <div class="field"><label for="bk-seeding">Посев команд</label><div class="control"><select id="bk-seeding">${Object.entries(SEEDING).map(([k, [n]]) => `<option value="${k}" ${k === seeding ? 'selected' : ''}>${n}</option>`).join('')}</select></div><p class="hint-mut">${SEEDING[seeding][1]}</p></div>
      ${list}
      <div class="tg-actions">
        <button type="button" class="btn btn-primary btn-sm" data-bact="generate" ${can && !working ? '' : 'disabled'}>${has ? 'Сформировать заново' : 'Сформировать сетку'}</button>
        ${has ? '<button type="button" class="btn btn-danger btn-sm" data-bact="remove">Удалить сетку</button>' : ''}
      </div>
      ${can ? '' : '<p class="t-note">Для сетки нужно минимум две оплаченные команды.</p>'}
      <p class="hint-mut">Любое изменение состава оплаченных команд до старта удаляет готовую сетку: её придётся сформировать заново.</p>
    </div>`;
  }

  /** Массовое расписание: время первого матча и интервал; доступно, пока есть сетка и турнир не закончен. */
  function schedPanel() {
    if (!data.rounds.length || !['upcoming', 'live'].includes(t.status)) return '';
    const base = t.startsAt ? toLocal(t.startsAt) : '';
    if (!schedOpen) return '<div class="tg-actions bk-sched-open"><button type="button" class="btn btn-ghost btn-sm" data-bact="sched">Назначить время матчей</button></div>';
    return `<form class="bm-form bk-sched" data-bform="schedule" novalidate>
      <h3 class="bm-round">Массовое расписание</h3>
      <p class="acc-sub">Время получат матчи без игры в сетке: сыгранные, идущие и проходы без игры не меняются. Следующий раунд начнётся через интервал после последнего матча предыдущего.</p>
      <div class="field"><label>Начало первого матча<div class="control"><input type="datetime-local" name="start" value="${base}" required /></div></label></div>
      <div class="bk-sched-row">
        <div class="field"><label>Интервал, минут<div class="control"><input type="number" inputmode="numeric" name="interval" min="1" max="720" value="60" required /></div></label></div>
        <div class="field"><label>Матчей одновременно<div class="control"><input type="number" inputmode="numeric" name="parallel" min="1" max="32" value="1" required /></div></label></div>
      </div>
      <label class="check block"><input type="checkbox" name="allRounds" checked /><span class="box"></span><span>Расписать и следующие раунды</span></label>
      <label class="check block"><input type="checkbox" name="overwrite" /><span class="box"></span><span>Заменить уже назначенное время</span></label>
      <p class="err" data-ferr role="alert"></p>
      <div class="tg-actions"><button type="submit" class="btn btn-primary btn-sm"><span class="label">Назначить время</span><span class="spinner" aria-hidden="true"></span></button><button type="button" class="btn btn-ghost btn-sm" data-bact="sched">Отмена</button></div>
    </form>`;
  }

  function draw() {
    if (!alive) return;
    if (error) { host.innerHTML = `<section class="acc-card"><h2>Сетка и матчи</h2><div class="acc-empty"><p>${esc(error)}</p><button type="button" class="btn btn-ghost btn-sm" data-bact="reload">Повторить</button></div></section>`; return; }
    if (!data) { host.innerHTML = '<div class="sk sk-card"></div>'; return; }
    const has = data.rounds.length > 0;
    const hint = t.status === 'upcoming' ? (has ? 'Сетка готова. Результаты можно вводить после старта турнира; время и лобби — уже сейчас.' : '')
      : t.status === 'live' ? 'Введите результаты сыгранных матчей: победитель автоматически пройдёт дальше. Результат финала завершит турнир.'
        : 'Турнир завершён. Счёт можно исправить, пока он не влияет на сыгранный следующий матч.';
    host.innerHTML = `
    <section class="acc-card bk-admin" id="bkAdmin">
      <div class="adm-status-top"><h2>Сетка и матчи</h2>${has ? `<a class="link" href="/tournaments/${esc(t.slug)}/bracket">Открыть сетку</a>` : ''}</div>
      <p class="acc-sub">Оплаченных команд: <b>${data.paidTeams}</b> · ${MATCH[t.matchFormat] || ''}${hint ? ` · ${hint}` : ''}</p>
      ${genPanel()}
      ${schedPanel()}
      ${has ? data.rounds.map((r) => `<h3 class="bm-round">${esc(r.name)}</h3><ul class="bm-list">${r.matches.map(matchRow).join('')}</ul>`).join('')
        : (t.status === 'upcoming' ? '' : '<div class="acc-empty"><p>Сетки нет.</p></div>')}
    </section>`;
  }

  const setBusy = (b, v) => { if (b) { b.disabled = v; b.classList.toggle('loading', v); } };
  const findMatch = (id) => data.rounds.flatMap((r) => r.matches).find((m) => m.id === id);

  /** Выполняет действие; при успехе перечитывает сетку. */
  async function run(btn, fn, okText) {
    working = true; setBusy(btn, true);
    try {
      const r = await fn();
      working = false;
      if (!alive) return;
      editing = null; await load();
      if (okText) say(okText, true);
      return r || true;
    } catch (e) {
      if (!alive) return;
      setBusy(btn, false); say(tournamentError(e));
      // Сервер мог изменить сетку (например, её сбросили): показываем актуальное состояние
      if (['bad_state', 'not_found', 'next_match_played', 'not_ready'].includes(e.code)) load();
    } finally { working = false; }
  }

  async function onClick(e) {
    const sb = e.target.closest('[data-seed]');
    if (sb && !sb.disabled) {
      const i = Number(sb.dataset.i), j = sb.dataset.seed === 'up' ? i - 1 : i + 1;
      [order[i], order[j]] = [order[j], order[i]]; draw();
      $(`[data-seed="${sb.dataset.seed}"][data-i="${j}"]`, host)?.focus();
      return;
    }
    const b = e.target.closest('[data-bact]'); if (!b || b.disabled) return;
    const act = b.dataset.bact, id = b.dataset.id;
    switch (act) {
      case 'reload': error = ''; data = null; draw(); load(); break;
      case 'close': editing = null; draw(); break;
      case 'sched': schedOpen = !schedOpen; draw(); $('[data-bform="schedule"] input', host)?.focus(); break;
      case 'result': case 'edit': editing = { id, kind: act }; draw(); $(`[data-mid="${id}"] input`, host)?.focus(); break;
      case 'generate': {
        if (data.rounds.length && !confirm('Пересоздать сетку? Текущие пары и введённое расписание будут удалены.')) return;
        if (seeding === 'manual' && !order) return;
        await run(b, () => admin.generateBracket(t.id, { seeding, ...(seeding === 'manual' && { order: order.map((o) => o.id) }) }), 'Сетка сформирована.');
        break;
      }
      case 'remove':
        if (confirm('Удалить сетку? Расписание и данные лобби будут потеряны.')) await run(b, () => admin.removeBracket(t.id), 'Сетка удалена.');
        break;
      case 'start': await run(b, () => admin.patchMatch(id, { status: 'live' }), 'Матч отмечен как идущий.'); break;
      case 'unstart': await run(b, () => admin.patchMatch(id, { status: 'ready' }), 'Матч снова «готов к игре».'); break;
      default:
    }
  }

  async function onSubmit(e) {
    const f = e.target.closest('[data-bform]'); if (!f) return;
    e.preventDefault();
    const btn = $('button[type=submit]', f), err = $('[data-ferr]', f);
    err.textContent = '';
    if (f.dataset.bform === 'schedule') {
      const start = f.start.value ? new Date(f.start.value) : null;
      const interval = Number(f.interval.value), parallel = Number(f.parallel.value);
      if (!start || isNaN(start)) { err.textContent = 'Укажите дату и время первого матча.'; return; }
      if (!Number.isInteger(interval) || interval < 1 || interval > 720) { err.textContent = 'Интервал: целое число минут от 1 до 720.'; return; }
      if (!Number.isInteger(parallel) || parallel < 1 || parallel > 32) { err.textContent = 'Одновременных матчей: от 1 до 32.'; return; }
      const r = await run(btn, () => admin.scheduleBracket(t.id, { start: start.toISOString(), intervalMin: interval, parallel, rounds: f.allRounds.checked ? 'all' : 'first', overwrite: f.overwrite.checked }));
      if (r) { schedOpen = false; draw(); say(r.scheduled ? `Время назначено: матчей — ${r.scheduled}.` : 'Менять нечего: у всех матчей уже есть время. Отметьте «Заменить уже назначенное время».', !!r.scheduled); }
      return;
    }
    const row = f.closest('[data-mid]'), id = row.dataset.mid, m = findMatch(id);
    if (f.dataset.bform === 'result') {
      const kind = f.kind.value, url = f.demoUrl.value.trim();
      const badUrl = (u) => u && !/^https?:\/\/\S+$/i.test(u);
      if (badUrl(url)) { err.textContent = 'Ссылка на демо должна начинаться с http:// или https://'; return; }
      let body;
      if (kind === 'played' && t.matchFormat === 'bo3') {
        const maps = [];
        for (let i = 0; i < 3; i++) {
          if ($(`[data-maprow="${i}"]`, f).hidden) continue;
          const av = f[`ma${i}`].value, bv = f[`mb${i}`].value, du = f[`md${i}`].value.trim();
          if (av === '' && bv === '') { if (i < 2) { err.textContent = 'Укажите счёт первых двух карт.'; return; } continue; }
          if (av === '' || bv === '') { err.textContent = `Карта ${i + 1}: введите очки обеих команд.`; return; }
          if (badUrl(du)) { err.textContent = `Карта ${i + 1}: ссылка на демо должна начинаться с http:// или https://`; return; }
          maps.push({ map: f[`map${i}`].value || null, a: Number(av), b: Number(bv), demoUrl: du || null });
        }
        const bad = mapsError(maps);
        if (bad) { err.textContent = bad; return; }
        body = { maps };
      } else if (kind === 'played' || kind === 'series') {
        const a = f.a.value === '' ? NaN : Number(f.a.value), b = f.b.value === '' ? NaN : Number(f.b.value);
        const bad = scoreError(t.matchFormat, a, b);
        if (bad) { err.textContent = bad; return; }
        body = { scoreA: a, scoreB: b };
      } else {
        const loser = f.loser.value;
        if (!loser) { err.textContent = 'Выберите, какая команда проиграла.'; return; }
        body = { forfeit: { loser, reason: kind } };
      }
      const r = await run(btn, () => admin.setResult(id, { ...body, demoUrl: url || null }), 'Результат сохранён.');
      if (r && ctx.onTournament) ctx.onTournament();
      return;
    }
    const raw = f.startsAt.value;
    const start = raw ? new Date(raw) : null;
    if (start && isNaN(start)) { err.textContent = 'Проверьте дату и время.'; return; }
    const url = f.demoUrl.value.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) { err.textContent = 'Ссылка на демо должна начинаться с http:// или https://'; return; }
    await run(btn, () => admin.patchMatch(m.id, { startsAt: start ? start.toISOString() : null, lobby: f.lobby.value.trim() || null, demoUrl: url || null }), 'Сохранено.');
  }

  /** Что показывать в форме результата: счёт, карты BO3, проигравшая команда. Третья карта — только если первые две разделились. */
  function syncResultForm(f) {
    const k = f.kind.value, bo3 = t.matchFormat === 'bo3';
    const show = (part, on) => { const el = $(`[data-part="${part}"]`, f); if (el) el.hidden = !on; };
    show('maps', bo3 && k === 'played'); show('score', bo3 ? k === 'series' : k === 'played');
    show('loser', k === 'tech' || k === 'noshow'); show('demo', !(bo3 && k === 'played'));
    if (bo3) {
      const win = (i) => { const a = f[`ma${i}`].value, b = f[`mb${i}`].value; return a === '' || b === '' || a === b ? null : Number(a) > Number(b) ? 'a' : 'b'; };
      const w0 = win(0), w1 = win(1);
      $('[data-maprow="2"]', f).hidden = !(w0 && w1 && w0 !== w1);
    }
  }
  function onInput(e) { if (/^m[ab]\d$/.test(e.target.name || '')) syncResultForm(e.target.closest('form')); }

  function onChange(e) {
    if (e.target.name === 'kind') { syncResultForm(e.target.closest('form')); return; }
    if (e.target.id !== 'bk-seeding') return;
    seeding = e.target.value; draw();
    if (seeding === 'manual') loadOrder();
  }

  host.addEventListener('click', onClick);
  host.addEventListener('submit', onSubmit);
  host.addEventListener('change', onChange);
  host.addEventListener('input', onInput);
  draw(); load();

  return {
    /** Заявки изменились (оплата подтверждена или снята): сервер мог сбросить сетку. */
    reload() { order = null; data = null; draw(); load(); if (seeding === 'manual') loadOrder(); },
    /** Турнир обновился (статус): перерисовываем с новыми правами. */
    setTournament(next) { t = next; draw(); },
    stop() { alive = false; host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit); host.removeEventListener('change', onChange); host.removeEventListener('input', onInput); },
  };
}
