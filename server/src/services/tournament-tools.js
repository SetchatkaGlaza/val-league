// Инструменты организатора: дублирование турнира, CSV-выгрузки, итоги отмены. Чистая логика без БД (тесты: test/tournament-tools.test.js).

const NAME_MAX = 60;
const COPY_SUFFIX = ' (копия)';

/** Название копии: «VAL Open #5 (копия)», не длиннее 60 символов (сначала обрезаем исходное название). */
export function copyName(name) {
  const base = String(name).trim().replace(/\s+/g, ' ');
  return base.length + COPY_SUFFIX.length <= NAME_MAX ? base + COPY_SUFFIX : base.slice(0, NAME_MAX - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX;
}

/**
 * Поля новой записи для копии. Берём настройки турнира; заявки, сетку, победителя и статус не переносим.
 * Копия — всегда черновик с регистрацией «открыта», новая дата обязательна.
 */
export function duplicateFields(src, { startsAt, name } = {}) {
  return {
    name: (name && String(name).trim().replace(/\s+/g, ' ')) || copyName(src.name),
    description: src.description ?? '',
    startsAt,
    teamSize: src.team_size,
    matchFormat: src.match_format,
    fee: src.fee,
    maxTeams: src.max_teams,
    mapPool: [...(src.map_pool ?? [])],
    prizePlaces: (src.prize_places ?? []).map((p) => ({ place: p.place, amount: p.amount })),
    registrationOpen: true,
  };
}

// ---------- CSV ----------
const BOM = '﻿';          // без него Excel открывает UTF-8 «кракозябрами»
const SEP = ';';               // русский Excel ждёт «;»
const EOL = '\r\n';

/**
 * Значение ячейки. Строки, начинающиеся с = + - @ или табуляции, Excel исполнил бы как формулу (ник «=1+1» в таблице организатора):
 * в начало добавляется апостроф. Числа и булевы значения записываются как есть.
 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  let s = v instanceof Date ? formatDate(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Дата для таблицы: по Москве, «17.10.2026 19:00». */
export function formatDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

export function toCsv(headers, rows) {
  return BOM + [headers, ...rows].map((r) => r.map(csvCell).join(SEP)).join(EOL) + EOL;
}

export const REG_STATUS_RU = { pending_payment: 'ждёт оплаты', paid: 'оплачена', waitlist: 'лист ожидания', cancelled: 'снята' };
export const CANCEL_REASON_RU = { captain: 'отменил капитан', admin: 'снята организатором', expired: 'вышел срок оплаты', tournament_started: 'турнир начался', tournament_cancelled: 'турнир отменён' };

/** Выгрузка всех заявок турнира. regs — строки tournament_registrations. */
export function registrationsCsv(regs) {
  const headers = ['№', 'Команда', 'Статус', 'Состав', 'Взнос, ₽', 'Код платежа', 'Оплата подтверждена', 'Подана', 'Причина снятия', 'К возврату', 'Заметка'];
  const rows = regs.map((r, i) => [
    i + 1, r.team_name, REG_STATUS_RU[r.status] ?? r.status, (r.roster ?? []).map((p) => p.nick).join(', '), r.fee, r.payment_code,
    r.paid_at ? formatDate(r.paid_at) : '', formatDate(r.created_at), r.cancel_reason ? (CANCEL_REASON_RU[r.cancel_reason] ?? r.cancel_reason) : '',
    r.refund_due ? 'да' : '', r.note ?? '',
  ]);
  return toCsv(headers, rows);
}

/** Выгрузка участников: по строке на игрока, только оплаченные заявки. */
export function participantsCsv(regs) {
  const headers = ['№', 'Команда', 'Игрок'];
  const rows = [];
  let n = 0;
  for (const r of regs.filter((x) => x.status === 'paid')) {
    n++;
    for (const p of r.roster ?? []) rows.push([n, r.team_name, p.nick]);
  }
  return toCsv(headers, rows);
}

/** Имя файла только из латиницы: заголовок Content-Disposition не должен ломаться на кириллице. */
export function csvFileName(slug, kind, now = new Date()) {
  const safe = String(slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tournament';
  return `${safe}-${kind}-${now.toISOString().slice(0, 10)}.csv`;
}

// ---------- Отмена и возвраты ----------
/** Что произойдёт при отмене: сколько заявок снимется, сколько оплачено и на какую сумму нужно вернуть. regs — { status, fee, refund_due }. */
export function cancelSummary(regs) {
  const live = regs.filter((r) => ['pending_payment', 'paid', 'waitlist'].includes(r.status));
  const paid = live.filter((r) => r.status === 'paid');
  return { cancelled: live.length, paid: paid.length, refundTotal: paid.reduce((s, r) => s + (r.fee || 0), 0) };
}

/** Итог массовой отметки «взнос возвращён»: сколько заявок и на какую сумму. */
export function refundTotals(regs) {
  const due = regs.filter((r) => r.refund_due);
  return { count: due.length, total: due.reduce((s, r) => s + (r.fee || 0), 0), ids: due.map((r) => r.id) };
}
