import { isStaff } from '../services/permissions.js';
import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { config } from '../config.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import {
  ACTIVE, OCCUPY, canRegister, beforeClose, closesAt, payUntil, newPaymentCode, occupiedCount, promoteWaitlist, validateRoster, invalidateBracket,
} from '../services/registrations.js';

const R = config.registration;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const rosterSchema = z.array(uuid).min(1).max(10);
const schemas = {
  create: z.object({ teamSlug: z.string().regex(SLUG_RE), roster: rosterSchema, acceptRules: z.literal(true) }),
  roster: z.object({ roster: rosterSchema }),
};

/** Заявка + турнир + команда одним запросом; на этом строится и просмотр, и проверка прав. */
export const REG_SELECT = `
  SELECT r.*, t.slug AS t_slug, t.name AS t_name, t.starts_at, t.status AS t_status, t.team_size, t.registration_open,
         tm.slug AS team_slug, tm.logo AS team_logo, tm.captain_id AS team_captain,
         CASE WHEN r.status = 'waitlist'
              THEN (SELECT count(*)::int FROM tournament_registrations w WHERE w.tournament_id = r.tournament_id AND w.status = 'waitlist' AND w.created_at <= r.created_at) END AS wl_pos
    FROM tournament_registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    LEFT JOIN teams tm ON tm.id = r.team_id`;

/** Заявка в виде для клиента. Реквизиты оплаты отдаём только пока ждём оплату. */
export function serializeReg(r) {
  const t = { status: r.t_status, starts_at: r.starts_at, registration_open: r.registration_open };
  return {
    id: r.id,
    status: r.status,
    cancelReason: r.cancel_reason,
    refundDue: r.refund_due,
    fee: r.fee,
    paymentCode: r.payment_code,
    payUntil: r.pay_until,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    note: r.note,
    roster: r.roster,
    waitlistPosition: r.wl_pos ?? null,
    team: { name: r.team_name, slug: r.team_slug ?? null, logo: r.team_logo ?? null },
    tournament: { slug: r.t_slug, name: r.t_name, startsAt: r.starts_at, status: r.t_status, teamSize: r.team_size, registrationClosesAt: closesAt(t) },
    canEdit: ACTIVE.includes(r.status) && beforeClose(t),
    payment: r.status === 'pending_payment' ? { amount: r.fee, code: r.payment_code, until: r.pay_until, details: R.paymentDetails } : null,
  };
}

const findTournamentBySlug = async (db, slug, lock = false) => {
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
  const { rows } = await db.query(`SELECT * FROM tournaments WHERE slug = $1 AND status <> 'draft'${lock ? ' FOR UPDATE' : ''}`, [slug]);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  return rows[0];
};

/** Блокирует турнир, затем заявку (порядок блокировок везде одинаков: турнир → заявка) и проверяет, что действует капитан команды. */
async function lockOwnRegistration(db, req) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rows: [head] } = await db.query('SELECT tournament_id FROM tournament_registrations WHERE id = $1', [id.data]);
  if (!head) throw new HttpError(404, 'not_found');
  const { rows: [t] } = await db.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [head.tournament_id]);
  const { rows: [r] } = await db.query(`${REG_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id.data]);
  if (!r) throw new HttpError(404, 'not_found');
  if (r.team_captain !== req.user.id) throw new HttpError(r.roster_ids.includes(req.user.id) ? 403 : 404, r.roster_ids.includes(req.user.id) ? 'forbidden' : 'not_found');
  return { t, r };
}
const reload = async (db, id) => serializeReg((await db.query(`${REG_SELECT} WHERE r.id = $1`, [id])).rows[0]);

// ---------- Страница турнира: что может сделать этот игрок ----------
/**
 * Команды, где пользователь капитан, с признаками допустимости каждого игрока, и их заявки на этот турнир.
 * Плюс заявки, где пользователь заявлен игроком (но не капитаном): им показываем статус.
 */
export async function eligibility(req, res) {
  const t = await findTournamentBySlug({ query }, req.params.slug);
  const uid = req.user.id;
  const { rows: teams } = await query('SELECT id, slug, name, logo FROM teams WHERE captain_id = $1 ORDER BY created_at', [uid]);
  const { rows: regs } = await query(`${REG_SELECT} WHERE r.tournament_id = $1 AND r.status = ANY($2::text[])`, [t.id, ACTIVE]);

  const busy = new Map();   // игрок → id команды, в чьей активной заявке он уже стоит
  for (const r of regs) for (const id of r.roster_ids) busy.set(id, r.team_id);

  const out = [];
  for (const team of teams) {
    const { rows: members } = await query(
      `SELECT u.id, u.nick, m.role, (u.email_verified_at IS NOT NULL AND NOT u.blocked) AS verified, (u.steam_id IS NOT NULL) AS steam
         FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1
        ORDER BY (m.role = 'main') DESC, m.joined_at`, [team.id]);
    const reg = regs.find((r) => r.team_id === team.id);
    out.push({
      slug: team.slug, name: team.name, logo: team.logo,
      members: members.map((m) => ({ ...m, busy: busy.has(m.id) && busy.get(m.id) !== team.id })),
      registration: reg ? serializeReg(reg) : null,
    });
  }
  const asPlayer = regs.filter((r) => r.roster_ids.includes(uid) && r.team_captain !== uid).map(serializeReg);
  res.json({ canRegister: canRegister(t), closesAt: closesAt(t), requireSteam: R.requireSteam, holdHours: R.payHours, waitlistMax: R.waitlistMax, teams: out, asPlayer });
}

// ---------- Подача заявки ----------
export async function create(req, res) {
  const d = parse(schemas.create, req.body);
  const reg = await withTx(async (db) => {
    const t = await findTournamentBySlug(db, req.params.slug, true);
    if (!canRegister(t)) throw new HttpError(409, 'registration_closed');

    if (!SLUG_RE.test(d.teamSlug)) throw new HttpError(404, 'not_found');
    const { rows: [team] } = await db.query('SELECT * FROM teams WHERE slug = $1 FOR UPDATE', [d.teamSlug]);
    if (!team) throw new HttpError(404, 'not_found');
    if (team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');

    const { rowCount: dup } = await db.query(
      `SELECT 1 FROM tournament_registrations WHERE tournament_id = $1 AND team_id = $2 AND status = ANY($3::text[])`, [t.id, team.id, ACTIVE]);
    if (dup) throw new HttpError(409, 'already_registered');

    const roster = await validateRoster(db, { team, tournament: t, rosterIds: d.roster });

    let status, until = null, paidAt = null;
    if ((await occupiedCount(db, t.id)) < t.max_teams) {
      if (t.fee === 0) { status = 'paid'; paidAt = new Date(); } else { status = 'pending_payment'; until = payUntil(t); }
    } else {
      const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM tournament_registrations WHERE tournament_id = $1 AND status = 'waitlist'`, [t.id]);
      if (n >= R.waitlistMax) throw new HttpError(409, 'tournament_full');
      status = 'waitlist';
    }
    const { rows: [row] } = await db.query(
      `INSERT INTO tournament_registrations
         (tournament_id, team_id, team_name, status, roster, roster_ids, registered_by, fee, payment_code, pay_until, paid_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::uuid[], $7, $8, $9, $10, $11) RETURNING id`,
      [t.id, team.id, team.name, status, JSON.stringify(roster), roster.map((p) => p.id), req.user.id, t.fee, await newPaymentCode(db), until, paidAt]);
    if (status === 'paid') await invalidateBracket(db, t);   // бесплатный турнир: команда сразу подтверждена
    return reload(db, row.id);
  }).catch((e) => { throw e.code === '23505' && /team_active/.test(e.constraint || '') ? new HttpError(409, 'already_registered') : e; });
  res.status(201).json({ registration: reg });
}

// ---------- Мои заявки ----------
export async function listMine(req, res) {
  const { rows } = await query(
    `${REG_SELECT} WHERE ($1 = ANY(r.roster_ids) OR tm.captain_id = $1)
      ORDER BY (r.status = ANY($2::text[])) DESC, t.starts_at DESC, r.created_at DESC LIMIT 50`, [req.user.id, ACTIVE]);
  res.json({ registrations: rows.map((r) => ({ ...serializeReg(r), isCaptain: r.team_captain === req.user.id })) });
}

export async function get(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rows: [r] } = await query(`${REG_SELECT} WHERE r.id = $1`, [id.data]);
  if (!r || !(isStaff(req.user.role) || r.team_captain === req.user.id || r.roster_ids.includes(req.user.id))) throw new HttpError(404, 'not_found');
  res.json({ registration: { ...serializeReg(r), isCaptain: r.team_captain === req.user.id } });
}

// ---------- Отмена и смена состава (капитан) ----------
export async function cancel(req, res) {
  const reg = await withTx(async (db) => {
    const { t, r } = await lockOwnRegistration(db, req);
    if (!ACTIVE.includes(r.status)) throw new HttpError(409, 'not_active');
    // Лист ожидания можно покинуть всегда; занятое место — только пока регистрация не закрылась
    if (r.status !== 'waitlist' && !beforeClose(t)) throw new HttpError(409, 'locked');
    await db.query(
      `UPDATE tournament_registrations
          SET refund_due = (status = 'paid'), status = 'cancelled', cancel_reason = 'captain', pay_until = NULL, updated_at = now()
        WHERE id = $1`, [r.id]);
    if (r.status === 'paid') await invalidateBracket(db, t);
    if (OCCUPY.includes(r.status)) await promoteWaitlist(db, t);
    return reload(db, r.id);
  });
  res.json({ registration: reg });
}

export async function updateRoster(req, res) {
  const d = parse(schemas.roster, req.body);
  const reg = await withTx(async (db) => {
    const { t, r } = await lockOwnRegistration(db, req);
    if (!ACTIVE.includes(r.status)) throw new HttpError(409, 'not_active');
    if (!beforeClose(t)) throw new HttpError(409, 'locked');
    const { rows: [team] } = await db.query('SELECT * FROM teams WHERE id = $1 FOR UPDATE', [r.team_id]);
    if (!team) throw new HttpError(404, 'not_found');
    const roster = await validateRoster(db, { team, tournament: t, rosterIds: d.roster, exceptRegId: r.id });
    await db.query(
      'UPDATE tournament_registrations SET roster = $2::jsonb, roster_ids = $3::uuid[], updated_at = now() WHERE id = $1',
      [r.id, JSON.stringify(roster), roster.map((p) => p.id)]);
    return reload(db, r.id);
  });
  res.json({ registration: reg });
}
