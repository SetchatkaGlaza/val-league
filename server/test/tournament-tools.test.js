import test from 'node:test';
import assert from 'node:assert/strict';
import { copyName, duplicateFields, csvCell, toCsv, formatDate, registrationsCsv, participantsCsv, csvFileName, cancelSummary, refundTotals } from '../src/services/tournament-tools.js';
import { ACTIONS } from '../src/services/audit.js';

const src = { name: 'VAL Open #5', description: 'Правила', team_size: 5, match_format: 'bo3', fee: 500, max_teams: 16, map_pool: ['de_mirage', 'de_nuke'], prize_places: [{ place: 1, amount: 30000 }, { place: 2, amount: 10000 }], status: 'finished', winner_name: 'Alpha', slug: 'val-open-5' };

test('copyName: добавляет «(копия)» и не вылезает за 60 символов', () => {
  assert.equal(copyName('VAL Open #5'), 'VAL Open #5 (копия)');
  const long = copyName('x'.repeat(60));
  assert.ok(long.length <= 60 && long.endsWith(' (копия)'));
  assert.equal(copyName('  A   B  '), 'A B (копия)');
});

test('duplicateFields: переносит настройки, не переносит победителя и статус, не делится ссылками на массивы', () => {
  const f = duplicateFields(src, { startsAt: '2026-12-01T16:00:00.000Z' });
  assert.deepEqual(f, { name: 'VAL Open #5 (копия)', description: 'Правила', startsAt: '2026-12-01T16:00:00.000Z', teamSize: 5, matchFormat: 'bo3', fee: 500, maxTeams: 16,
    mapPool: ['de_mirage', 'de_nuke'], prizePlaces: [{ place: 1, amount: 30000 }, { place: 2, amount: 10000 }], registrationOpen: true });
  f.mapPool.push('x'); f.prizePlaces[0].amount = 1;
  assert.deepEqual(src.map_pool, ['de_mirage', 'de_nuke']);
  assert.equal(src.prize_places[0].amount, 30000);
  assert.equal(duplicateFields(src, { startsAt: 'x', name: '  VAL   Open #6 ' }).name, 'VAL Open #6');
});

test('csvCell: кавычки, разделитель, переносы, формулы', () => {
  assert.equal(csvCell('простой'), 'простой');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('он сказал "да"'), '"он сказал ""да"""');
  assert.equal(csvCell('строка\nвторая'), '"строка\nвторая"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('-5 команд'), "'-5 команд");
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(true), 'да');
  assert.equal(csvCell(NaN), '');
});

test('toCsv: BOM в начале, «;» между полями, CRLF, кириллица цела', () => {
  const out = toCsv(['Команда', 'Взнос'], [['Альфа', 500]]);
  assert.ok(out.startsWith('﻿Команда;Взнос\r\n'));
  assert.ok(out.endsWith('Альфа;500\r\n'));
});

test('formatDate: по Москве', () => {
  assert.equal(formatDate('2026-10-17T16:20:00Z'), '17.10.2026 19:20');
  assert.equal(formatDate(null), '');
  assert.equal(formatDate('не дата'), '');
});

const regs = [
  { id: 'r1', team_name: 'Alpha', status: 'paid', roster: [{ nick: 'a1' }, { nick: '=cmd' }], fee: 500, payment_code: 'VAL-AAAAAA', paid_at: '2026-10-10T10:00:00Z', created_at: '2026-10-09T10:00:00Z', cancel_reason: null, refund_due: false, note: null },
  { id: 'r2', team_name: 'Beta; "B"', status: 'cancelled', roster: [{ nick: 'b1' }], fee: 500, payment_code: 'VAL-BBBBBB', paid_at: '2026-10-10T10:00:00Z', created_at: '2026-10-09T11:00:00Z', cancel_reason: 'tournament_cancelled', refund_due: true, note: 'заметка' },
  { id: 'r3', team_name: 'Gamma', status: 'pending_payment', roster: [{ nick: 'g1' }], fee: 0, payment_code: 'VAL-CCCCCC', paid_at: null, created_at: '2026-10-09T12:00:00Z', cancel_reason: null, refund_due: false, note: null },
];

test('registrationsCsv: ник-формула в начале состава экранируется', () => {
  const out = registrationsCsv([{ ...regs[0], roster: [{ nick: '=cmd' }, { nick: 'ok' }] }]);
  assert.ok(out.includes(";'=cmd, ok;"));
});

test('registrationsCsv: статусы по-русски, кавычки и «;» экранированы, возврат отмечен', () => {
  const lines = registrationsCsv(regs).replace('﻿', '').trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^№;Команда;Статус;/);
  assert.match(lines[1], /^1;Alpha;оплачена;a1, =cmd;500;VAL-AAAAAA;/);
  assert.match(lines[2], /"Beta; ""B""";снята;b1;500;VAL-BBBBBB;.*;турнир отменён;да;заметка$/);
  assert.match(lines[3], /^3;Gamma;ждёт оплаты;g1;0;VAL-CCCCCC;;/);
});

test('participantsCsv: только оплаченные, по строке на игрока', () => {
  const lines = participantsCsv(regs).replace('﻿', '').trim().split('\r\n');
  assert.deepEqual(lines, ['№;Команда;Игрок', "1;Alpha;a1", "1;Alpha;'=cmd"]);
});

test('csvFileName: только латиница, дата, безопасно для заголовка', () => {
  assert.equal(csvFileName('val-open-5', 'registrations', new Date('2026-10-17T10:00:00Z')), 'val-open-5-registrations-2026-10-17.csv');
  assert.equal(csvFileName('Турнир "x"\r\nSet-Cookie: a', 'participants', new Date('2026-10-17T10:00:00Z')), 'x-set-cookie-a-participants-2026-10-17.csv');
  assert.equal(csvFileName('Турнир', 'participants', new Date('2026-10-17T10:00:00Z')), 'tournament-participants-2026-10-17.csv');
});

test('cancelSummary: считает живые заявки, оплаченные и сумму возврата', () => {
  assert.deepEqual(cancelSummary(regs), { cancelled: 2, paid: 1, refundTotal: 500 });
  assert.deepEqual(cancelSummary([]), { cancelled: 0, paid: 0, refundTotal: 0 });
});

test('refundTotals: только заявки с возвратом', () => {
  assert.deepEqual(refundTotals(regs), { count: 1, total: 500, ids: ['r2'] });
  assert.deepEqual(refundTotals([]), { count: 0, total: 0, ids: [] });
});

test('новые действия журнала зарегистрированы', () => {
  for (const a of ['tournament.duplicate', 'tournament.cancel', 'tournament.export', 'registration.bulk_refunded']) assert.ok(ACTIONS.includes(a), a);
});
