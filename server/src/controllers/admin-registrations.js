import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { ACTIVE, OCCUPY, occupiedCount, promoteWaitlist, validateRoster, invalidateBracket } from '../services/registrations.js';
import { REG_SELECT, serializeReg } from './registrations.js';
import { record } from '../services/audit.js';
import { registrationsCsv, participantsCsv, csvFileName, refundTotals } from '../services/tournament-tools.js';

const noteSchema = z.object({ note: z.string().trim().max(300).optional() });

/** Заявки турнира: сначала те, что требуют внимания (ждут подтверждения, нужен возврат), затем лист ожидания, подтверждённые и снятые. */
export async function list(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rows } = await query(
    `${REG_SELECT} WHERE r.tournament_id = $1
      ORDER BY r.refund_due DESC,
               CASE r.status WHEN 'pending_payment' THEN 0 WHEN 'waitlist' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END,
               r.created_at`, [id.data]);
  res.json({
    registrations: rows.map((r) => ({
      ...serializeReg(r),
      registeredAt: r.created_at,
      confirmed: !!r.confirmed_by,
    })),
  });
}

/** Находит заявку, блокирует турнир и заявку (порядок: турнир → заявка, как в controllers/registrations.js). */
async function lockReg(db, rawId) {
  const id = uuid.safeParse(rawId);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rows: [head] } = await db.query('SELECT tournament_id FROM tournament_registrations WHERE id = $1', [id.data]);
  if (!head) throw new HttpError(404, 'not_found');
  const { rows: [t] } = await db.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [head.tournament_id]);
  const { rows: [r] } = await db.query(`${REG_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id.data]);
  return { t, r };
}
const regView = (r) => ({ status: r.status, cancelReason: r.cancel_reason, refundDue: r.refund_due, note: r.note, fee: r.fee });
const regLabel = (t, r) => `${r.team_name} → ${t.name}`;
const reload = async (db, id) => serializeReg((await db.query(`${REG_SELECT} WHERE r.id = $1`, [id])).rows[0]);

/**
 * Подтвердить оплату. Подходит заявка «ждёт оплату». Если срок оплаты вышел, а перевод всё же пришёл (заявка снята как «expired»),
 * её можно вернуть, если место ещё свободно и команда с игроками не заняты в другой заявке.
 */
export async function confirm(req, res) {
  const d = parse(noteSchema, req.body);
  const reg = await withTx(async (db) => {
    const { t, r } = await lockReg(db, req.params.id);
    const revive = r.status === 'cancelled' && r.cancel_reason === 'expired';
    if (r.status !== 'pending_payment' && !revive) throw new HttpError(409, 'bad_transition');
    if (revive) {
      if (t.status !== 'upcoming') throw new HttpError(409, 'locked');
      if ((await occupiedCount(db, t.id)) >= t.max_teams) throw new HttpError(409, 'no_slot');
      if (r.team_id) {
        const { rowCount } = await db.query(
          `SELECT 1 FROM tournament_registrations WHERE tournament_id = $1 AND team_id = $2 AND status = ANY($3::text[])`, [t.id, r.team_id, ACTIVE]);
        if (rowCount) throw new HttpError(409, 'already_registered');
      }
      const { rows: [team] } = r.team_id ? await db.query('SELECT * FROM teams WHERE id = $1', [r.team_id]) : { rows: [] };
      if (!team) throw new HttpError(409, 'team_gone');
      await validateRoster(db, { team, tournament: t, rosterIds: r.roster_ids, exceptRegId: r.id });   // игроки не заняты в других заявках
    }
    await db.query(
      `UPDATE tournament_registrations
          SET status = 'paid', cancel_reason = NULL, pay_until = NULL, paid_at = now(), confirmed_by = $2, note = COALESCE($3, note), updated_at = now()
        WHERE id = $1`, [r.id, req.user.id, d.note ?? null]);
    await invalidateBracket(db, t);   // новая оплаченная команда: сетку нужно сформировать заново
    const out = await reload(db, r.id);
    await record(db, req, { action: 'registration.confirm', objectType: 'registration', objectId: r.id, label: regLabel(t, r), before: regView(r), after: { status: 'paid', cancelReason: null, refundDue: r.refund_due, note: d.note ?? r.note, fee: r.fee }, meta: { revived: revive, code: r.payment_code } });
    return out;
  });
  res.json({ registration: reg });
}

/** Снять заявку (отклонить). Оплаченную снимаем с пометкой «вернуть взнос». Освободившееся место отдаём листу ожидания. */
export async function cancel(req, res) {
  const d = parse(noteSchema, req.body);
  const reg = await withTx(async (db) => {
    const { t, r } = await lockReg(db, req.params.id);
    if (!ACTIVE.includes(r.status)) throw new HttpError(409, 'not_active');
    // В идущем турнире снятие команды ломает сетку: такие случаи решаются результатом матча (техническое поражение)
    if (t.status === 'live' && r.status === 'paid') throw new HttpError(409, 'tournament_live');
    await db.query(
      `UPDATE tournament_registrations
          SET refund_due = (status = 'paid'), status = 'cancelled', cancel_reason = 'admin', pay_until = NULL, note = COALESCE($2, note), updated_at = now()
        WHERE id = $1`, [r.id, d.note ?? null]);
    if (r.status === 'paid') await invalidateBracket(db, t);
    if (OCCUPY.includes(r.status)) await promoteWaitlist(db, t);
    const out = await reload(db, r.id);
    await record(db, req, { action: 'registration.cancel', objectType: 'registration', objectId: r.id, label: regLabel(t, r), before: regView(r), after: { status: 'cancelled', cancelReason: 'admin', refundDue: r.status === 'paid', note: d.note ?? r.note, fee: r.fee }, meta: { code: r.payment_code } });
    return out;
  });
  res.json({ registration: reg });
}

/** Отметить, что взнос возвращён игрокам. */
export async function refunded(req, res) {
  const reg = await withTx(async (db) => {
    const { t, r } = await lockReg(db, req.params.id);
    if (!r.refund_due) throw new HttpError(409, 'bad_transition');
    await db.query('UPDATE tournament_registrations SET refund_due = false, updated_at = now() WHERE id = $1', [r.id]);
    await record(db, req, { action: 'registration.refunded', objectType: 'registration', objectId: r.id, label: regLabel(t, r), before: { refundDue: true }, after: { refundDue: false }, meta: { fee: r.fee, code: r.payment_code } });
    return reload(db, r.id);
  });
  res.json({ registration: reg });
}

const exportSchema = z.object({ kind: z.enum(['registrations', 'participants']) });

/** Выгрузка в CSV (UTF-8 с BOM, разделитель «;»). Только ники и названия команд, без почт и Steam. Выгрузка пишется в журнал. */
export async function exportCsv(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { kind } = parse(exportSchema, req.query);
  const { rows: [t] } = await query('SELECT id, slug, name FROM tournaments WHERE id = $1', [id.data]);
  if (!t) throw new HttpError(404, 'not_found');
  const { rows: regs } = await query(
    `SELECT team_name, status, roster, fee, payment_code, paid_at, created_at, cancel_reason, refund_due, note
       FROM tournament_registrations WHERE tournament_id = $1
      ORDER BY CASE status WHEN 'paid' THEN 0 WHEN 'pending_payment' THEN 1 WHEN 'waitlist' THEN 2 ELSE 3 END, created_at`, [t.id]);
  const csv = kind === 'registrations' ? registrationsCsv(regs) : participantsCsv(regs);
  await record({ query }, req, { action: 'tournament.export', objectType: 'tournament', objectId: t.id, label: t.name, meta: { kind, rows: regs.length } });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${csvFileName(t.slug, kind)}"`, 'Cache-Control': 'no-store' });
  res.send(csv);
}

/** Массово отметить «взнос возвращён» у всех заявок турнира, где возврат ещё не отмечен. Деньги не двигаются: это только пометка. */
export async function refundedAll(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const out = await withTx(async (db) => {
    const { rows: [t] } = await db.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [id.data]);
    if (!t) throw new HttpError(404, 'not_found');
    const { rows } = await db.query(`SELECT id, fee FROM tournament_registrations WHERE tournament_id = $1 AND refund_due FOR UPDATE`, [t.id]);
    const sum = refundTotals(rows);
    if (!sum.count) throw new HttpError(409, 'nothing_to_do');
    await db.query(`UPDATE tournament_registrations SET refund_due = false, updated_at = now() WHERE id = ANY($1::uuid[])`, [sum.ids]);
    await record(db, req, { action: 'registration.bulk_refunded', objectType: 'tournament', objectId: t.id, label: t.name, before: { refundDue: sum.count }, after: { refundDue: 0 }, meta: { count: sum.count, total: sum.total, ids: sum.ids } });
    return { count: sum.count, total: sum.total };
  });
  res.json(out);
}
