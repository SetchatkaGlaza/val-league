import { randomInt } from 'node:crypto';
import { query, withTx } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../utils/http.js';

const R = config.registration;

/** Места занимают заявки в этих статусах. */
export const OCCUPY = ['pending_payment', 'paid'];
/** «Живые» заявки: команда не может подать вторую, игрок не может быть в двух составах. */
export const ACTIVE = ['pending_payment', 'paid', 'waitlist'];

/** Когда закрываются регистрация, отмена и смена состава. */
export const closesAt = (t) => new Date(new Date(t.starts_at).getTime() - R.closeMinutes * 60_000);
/** Можно ли сейчас подавать заявки. */
export const canRegister = (t) => t.status === 'upcoming' && t.registration_open && Date.now() < closesAt(t).getTime();
/** До закрытия можно менять заявку и отменять оплаченную. */
export const beforeClose = (t) => t.status === 'upcoming' && Date.now() < closesAt(t).getTime();

/** Крайний срок оплаты: сутки с момента занятия места, но не позже закрытия регистрации. */
export const payUntil = (t) => new Date(Math.min(Date.now() + R.payHours * 3_600_000, closesAt(t).getTime()));

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих символов (0/O, 1/I)
export async function newPaymentCode(db) {
  for (;;) {
    const code = `VAL-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
    const { rowCount } = await db.query('SELECT 1 FROM tournament_registrations WHERE payment_code = $1', [code]);
    if (!rowCount) return code;
  }
}

export async function occupiedCount(db, tournamentId) {
  const { rows: [{ n }] } = await db.query(
    'SELECT count(*)::int AS n FROM tournament_registrations WHERE tournament_id = $1 AND status = ANY($2::text[])', [tournamentId, OCCUPY]);
  return n;
}

/**
 * Освободилось место (отмена, истёк срок оплаты, вырос лимит) — первые в листе ожидания занимают его.
 * Вызывать в транзакции, когда строка турнира уже заблокирована (SELECT … FOR UPDATE).
 * После закрытия регистрации лист не двигается: у новой команды не осталось бы времени на оплату и смену состава.
 */
export async function promoteWaitlist(db, t) {
  if (!beforeClose(t)) return [];
  const promoted = [];
  let free = t.max_teams - (await occupiedCount(db, t.id));
  while (free > 0) {
    const { rows: [r] } = await db.query(
      `SELECT id FROM tournament_registrations WHERE tournament_id = $1 AND status = 'waitlist' ORDER BY created_at LIMIT 1 FOR UPDATE`, [t.id]);
    if (!r) break;
    const isFree = t.fee === 0;
    await db.query(
      `UPDATE tournament_registrations
          SET status = $2, fee = $3, pay_until = $4, paid_at = $5, updated_at = now()
        WHERE id = $1`,
      [r.id, isFree ? 'paid' : 'pending_payment', t.fee, isFree ? null : payUntil(t), isFree ? new Date() : null]);
    promoted.push(r.id);
    free--;
  }
  return promoted;
}

/** Снимает заявки турнира с указанными статусами; оплаченные помечает «вернуть взнос». */
export async function cancelWhere(db, tournamentId, statuses, reason) {
  await db.query(
    `UPDATE tournament_registrations
        SET refund_due = refund_due OR (status = 'paid'), status = 'cancelled', cancel_reason = $3, pay_until = NULL, updated_at = now()
      WHERE tournament_id = $1 AND status = ANY($2::text[])`,
    [tournamentId, statuses, reason]);
}

/**
 * Проверяет состав заявки и возвращает его в виде [{ id, nick }].
 * Ошибки: validation (число игроков), not_member, roster_unverified, roster_no_steam, player_busy (+ details — ники).
 * exceptRegId — заявка, которую сейчас меняем (её собственный состав не считается «занятым»).
 */
export async function validateRoster(db, { team, tournament, rosterIds, exceptRegId = null }) {
  const ids = [...new Set(rosterIds)];
  if (ids.length !== rosterIds.length || ids.length !== tournament.team_size) throw new HttpError(400, 'validation', 'roster');

  const { rows: users } = await db.query(
    `SELECT u.id, u.nick, u.email_verified_at, u.blocked, u.steam_id
       FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1 AND u.id = ANY($2::uuid[])`, [team.id, ids]);
  if (users.length !== ids.length) throw new HttpError(409, 'not_member', 'roster');

  const unverified = users.filter((u) => u.blocked || !u.email_verified_at).map((u) => u.nick);
  if (unverified.length) throw new HttpError(409, 'roster_unverified', 'roster', unverified);
  if (R.requireSteam) {
    const noSteam = users.filter((u) => !u.steam_id).map((u) => u.nick);
    if (noSteam.length) throw new HttpError(409, 'roster_no_steam', 'roster', noSteam);
  }
  const { rows: busy } = await db.query(
    `SELECT DISTINCT u.nick
       FROM tournament_registrations r JOIN users u ON u.id = ANY(r.roster_ids)
      WHERE r.tournament_id = $1 AND r.status = ANY($2::text[]) AND u.id = ANY($3::uuid[])
        AND ($4::uuid IS NULL OR r.id <> $4)`,
    [tournament.id, ACTIVE, ids, exceptRegId]);
  if (busy.length) throw new HttpError(409, 'player_busy', 'roster', busy.map((b) => b.nick));

  // Порядок как в запросе клиента: так состав выглядит так, как его выбрал капитан
  return ids.map((id) => ({ id, nick: users.find((u) => u.id === id).nick }));
}

/** Снимает заявки, у которых вышел срок оплаты, и двигает лист ожидания. Запускается по таймеру (index.js). */
export async function sweepExpired() {
  const { rows } = await query(
    `SELECT DISTINCT tournament_id FROM tournament_registrations WHERE status = 'pending_payment' AND pay_until IS NOT NULL AND pay_until < now()`);
  for (const { tournament_id: id } of rows) {
    await withTx(async (db) => {
      const { rows: [t] } = await db.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [id]);
      if (!t) return;
      await db.query(
        `UPDATE tournament_registrations SET status = 'cancelled', cancel_reason = 'expired', pay_until = NULL, updated_at = now()
          WHERE tournament_id = $1 AND status = 'pending_payment' AND pay_until IS NOT NULL AND pay_until < now()`, [id]);
      await promoteWaitlist(db, t);
    });
  }
  return rows.length;
}
