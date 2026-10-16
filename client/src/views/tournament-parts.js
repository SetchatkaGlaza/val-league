import { ApiError, serverFallback } from '../js/api.js';
import { esc } from './parts.js';
import { plural } from './team-parts.js';

export const rub = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
const withYear = (d) => d.getFullYear() !== new Date().getFullYear();
/** «суббота, 17 октября, 19:00» (по времени пользователя); год добавляем, если он не текущий. */
export const dateLong = (iso) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', ...(withYear(d) && { year: 'numeric' }), hour: '2-digit', minute: '2-digit' }).format(d);
};
export const dateShort = (iso) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', ...(withYear(d) && { year: 'numeric' }) }).format(d);
};

export const MATCH = { bo1: 'BO1', bo3: 'BO3' };
export const formatLine = (t) => `${t.teamSize}x${t.teamSize} · Single Elimination · ${MATCH[t.matchFormat]}`;
export const feeLine = (t) => (t.fee ? `Взнос: ${rub(t.fee)} с команды` : 'Участие бесплатное');

/** Подпись статуса и его оформление (css-класс st-…). */
export function statusOf(t) {
  switch (t.status) {
    case 'live': return ['Идёт сейчас', 'live'];
    case 'finished': return ['Завершён', 'done'];
    case 'cancelled': return ['Отменён', 'cancel'];
    case 'draft': return ['Черновик', 'draft'];
    default: return t.registrationOpen ? ['Регистрация открыта', 'open'] : ['Анонс', 'soon'];
  }
}
export const statusBadge = (t) => { const [label, cls] = statusOf(t); return `<span class="st st-${cls}">${label}</span>`; };

export const slotsLine = (t) => {
  const left = Math.max(t.maxTeams - t.teamsCount, 0);
  return { pct: Math.round((t.teamsCount / t.maxTeams) * 100), text: `Команд: <b>${t.teamsCount}</b> из ${t.maxTeams}`, left: `${left} ${plural(left, 'свободное место', 'свободных места', 'свободных мест')}` };
};

/** Карточка турнира для списков (вся карточка — ссылка). */
export function tournamentCard(t) {
  const s = slotsLine(t);
  return `
  <a class="t-card" href="/tournaments/${esc(t.slug)}">
    <div class="t-card-top">${statusBadge(t)}<span class="t-card-date">${dateShort(t.startsAt)}</span></div>
    <h3>${esc(t.name)}</h3>
    <ul class="chips"><li>${formatLine(t)}</li><li>${t.fee ? rub(t.fee) : 'Бесплатно'}</li></ul>
    <div class="t-card-bottom">
      <div><p class="label">Призовой фонд</p><p class="t-prize">${t.prizeTotal ? rub(t.prizeTotal) : '—'}</p></div>
      <div class="slots"><div class="slots-bar"><i style="width:${s.pct}%"></i></div><span>${s.text}</span></div>
    </div>
    ${t.winner ? `<p class="t-card-win">Победитель: <b>${esc(t.winner.name)}</b></p>` : ''}
  </a>`;
}

/** Обратный отсчёт: ищет в root элементы [data-cd="d|h|m|s"]. Возвращает функцию остановки. */
export function startCountdown(root, iso, onZero) {
  const els = Object.fromEntries(['d', 'h', 'm', 's'].map((k) => [k, root.querySelector(`[data-cd="${k}"]`)]));
  if (!els.d) return () => {};
  const pad = (n) => String(n).padStart(2, '0');
  let done = false;
  const tick = () => {
    let left = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000));
    const d = Math.floor(left / 86400); left -= d * 86400;
    const h = Math.floor(left / 3600); left -= h * 3600;
    const m = Math.floor(left / 60);
    els.d.textContent = pad(d); els.h.textContent = pad(h); els.m.textContent = pad(m); els.s.textContent = pad(left % 60);
    if (!done && new Date(iso) <= Date.now()) { done = true; onZero && onZero(); }
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
const cdBox = (k, label) => `<div class="cd-box"><b data-cd="${k}">00</b><span>${label}</span></div>`;
export const countdownHtml = (iso, id = 'cd') => `<time class="cd" id="${id}" datetime="${new Date(iso).toISOString()}">${cdBox('d', 'дн')}${cdBox('h', 'ч')}${cdBox('m', 'мин')}${cdBox('s', 'сек')}</time>`;

export const ERRORS = {
  not_found: 'Не найдено. Возможно, страница уже изменилась — обновите её.',
  forbidden: 'Недостаточно прав для этого действия.',
  locked: 'Это уже нельзя изменить: турнир начался или до старта осталось слишком мало времени.',
  bad_transition: 'Такой переход статуса недоступен.',
  start_in_past: 'Дата начала уже прошла. Измените дату, чтобы опубликовать турнир.',
  not_deletable: 'Удалить можно только черновик или отменённый турнир.',
  validation: 'Проверьте заполненные поля.',
  // Администратор
  has_registrations: 'Уже есть заявки команд: это изменить или скрыть нельзя. Сначала снимите заявки.',
  max_below_occupied: 'Лимит меньше числа занятых мест. Сначала снимите лишние заявки.',
  has_payments: 'По турниру есть оплаченные заявки или невозвращённые взносы. Отметьте возврат и повторите.',
  no_slot: 'Свободных мест нет: вернуть заявку нельзя.',
  team_gone: 'Команда уже удалена: вернуть заявку нельзя.',
  // Заявки команд
  registration_closed: 'Регистрация закрыта: она заканчивается за час до старта или ещё не открыта.',
  already_registered: 'Эта команда уже подала заявку на турнир.',
  tournament_full: 'Мест нет, и лист ожидания заполнен.',
  not_active: 'Заявка уже снята, действие недоступно.',
  not_member: 'В составе могут быть только игроки этой команды. Обновите страницу.',
};
/** Коды, к которым сервер прикладывает ники игроков (details) */
const WITH_NICKS = {
  player_busy: 'Уже заявлены другой командой на этот турнир:',
  roster_unverified: 'Не подтверждена почта или аккаунт заблокирован:',
  roster_no_steam: 'Не привязан Steam:',
};
export const tournamentError = (e, base = 'Не удалось выполнить. Попробуйте ещё раз.') => {
  const err = e instanceof ApiError ? e : new ApiError(0, 'network', '');
  if (WITH_NICKS[err.code]) return `${WITH_NICKS[err.code]} ${(err.details || []).join(', ')}.`;
  return ERRORS[err.code] || serverFallback(err, base);
};

export const skeletonCards = (n = 3) => `<div class="t-grid" aria-busy="true">${'<div class="sk sk-card"></div>'.repeat(n)}</div>`;
export const mapName = (m) => m.replace(/^de_/, '').replace(/^./, (c) => c.toUpperCase());
