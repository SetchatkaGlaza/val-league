import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { ACTIVE, OCCUPY, occupiedCount, promoteWaitlist, validateRoster } from '../services/registrations.js';
import { REG_SELECT, serializeReg } from './registrations.js';

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
    return reload(db, r.id);
  });
  res.json({ registration: reg });
}

/** Снять заявку (отклонить). Оплаченную снимаем с пометкой «вернуть взнос». Освободившееся место отдаём листу ожидания. */
export async function cancel(req, res) {
  const d = parse(noteSchema, req.body);
  const reg = await withTx(async (db) => {
    const { t, r } = await lockReg(db, req.params.id);
    if (!ACTIVE.includes(r.status)) throw new HttpError(409, 'not_active');
    await db.query(
      `UPDATE tournament_registrations
          SET refund_due = (status = 'paid'), status = 'cancelled', cancel_reason = 'admin', pay_until = NULL, note = COALESCE($2, note), updated_at = now()
        WHERE id = $1`, [r.id, d.note ?? null]);
    if (OCCUPY.includes(r.status)) await promoteWaitlist(db, t);
    return reload(db, r.id);
  });
  res.json({ registration: reg });
}

/** Отметить, что взнос возвращён игрокам. */
export async function refunded(req, res) {
  const reg = await withTx(async (db) => {
    const { r } = await lockReg(db, req.params.id);
    if (!r.refund_due) throw new HttpError(409, 'bad_transition');
    await db.query('UPDATE tournament_registrations SET refund_due = false, updated_at = now() WHERE id = $1', [r.id]);
    return reload(db, r.id);
  });
  res.json({ registration: reg });
}
