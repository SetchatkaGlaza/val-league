import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { config } from '../config.js';
import { slugify } from '../utils/slug.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { serialize, TSELECT } from './tournaments.js';
import { cancelWhere, promoteWaitlist } from '../services/registrations.js';
import { record } from '../services/audit.js';
import { attentionItems } from '../services/dashboard.js';
import { sectionsFor } from '../services/permissions.js';
import { duplicateFields, cancelSummary } from '../services/tournament-tools.js';

// ---------- Валидация ----------
const name = z.string().trim().transform((s) => s.replace(/\s+/g, ' ')).pipe(z.string().min(3).max(60));
const places = z.array(z.object({ place: z.number().int().min(1).max(8), amount: z.number().int().min(0).max(10_000_000) })).max(8)
  .refine((a) => a.every((p, i) => p.place === i + 1));   // 1, 2, 3… по порядку, без пропусков

const fields = {
  name,
  description: z.string().trim().max(3000),
  startsAt: z.string().datetime({ offset: true }),
  teamSize: z.union([z.literal(2), z.literal(5)]),
  matchFormat: z.enum(['bo1', 'bo3']),
  fee: z.number().int().min(0).max(100_000),
  maxTeams: z.number().int().min(2).max(128),
  mapPool: z.array(z.enum(config.maps)).max(config.maps.length).refine((a) => new Set(a).size === a.length),
  prizePlaces: places,
  registrationOpen: z.boolean(),
};
const createSchema = z.object({ ...fields, description: fields.description.default(''), teamSize: fields.teamSize.default(5), matchFormat: fields.matchFormat.default('bo1'),
  fee: fields.fee.default(0), mapPool: fields.mapPool.default([]), prizePlaces: fields.prizePlaces.default([]), registrationOpen: fields.registrationOpen.default(true) });
const updateSchema = z.object(fields).partial();
const cancelSchema = z.object({ reason: z.string().trim().min(5).max(300) });
const duplicateSchema = z.object({ startsAt: fields.startsAt, name: name.optional() });
const statusSchema = z.object({
  // «cancelled» здесь нет: отмена идёт отдельным маршрутом (POST /tournaments/:id/cancel) с обязательной причиной
  status: z.enum(['draft', 'upcoming', 'live', 'finished']),
  winnerName: z.string().trim().max(40).optional(),
  winnerRoster: z.array(z.string().trim().min(1).max(20)).max(7).optional(),
});

/** Разрешённые переходы статусов. Завершённый турнир изменить нельзя. */
const FLOW = { draft: ['upcoming'], upcoming: ['draft', 'live', 'cancelled'], live: ['finished', 'cancelled'], finished: [], cancelled: ['upcoming', 'draft'] };
/** Пока турнир не начался, можно менять всё; потом — только описание и открытие регистрации. */
const EDITABLE = ['draft', 'upcoming'];
const ALWAYS = ['description', 'registrationOpen'];

const DB_COLUMN = { name: 'name', description: 'description', startsAt: 'starts_at', teamSize: 'team_size', matchFormat: 'match_format', fee: 'fee', maxTeams: 'max_teams', mapPool: 'map_pool', prizePlaces: 'prize_places', registrationOpen: 'registration_open' };

async function findById(id, db = { query }, lock = false) {
  const ok = uuid.safeParse(id);
  if (!ok.success) throw new HttpError(404, 'not_found');
  const { rows } = await db.query(`${TSELECT} WHERE t.id = $1${lock ? ' FOR UPDATE OF t' : ''}`, [ok.data]);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  return rows[0];
}
/** Свободный адрес для турнира: slug, slug-2, slug-3… (вызывать в транзакции). */
async function uniqueSlug(db, title) {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; (await db.query('SELECT 1 FROM tournaments WHERE slug = $1', [slug])).rowCount; i++) slug = `${base}-${i}`;
  return slug;
}
const isFuture = (iso) => new Date(iso).getTime() > Date.now();
/** Поля турнира, которые попадают в журнал (в формате ключей API). */
const auditView = (t) => ({
  name: t.name, description: t.description, startsAt: t.starts_at, teamSize: t.team_size, matchFormat: t.match_format, fee: t.fee,
  maxTeams: t.max_teams, mapPool: t.map_pool, prizePlaces: t.prize_places, registrationOpen: t.registration_open,
  status: t.status, winner: t.winner_name,
});

// ---------- Обработчики ----------
/** Кто я и какие разделы админки мне доступны (клиент по этому прячет лишнее). */
export async function me(req, res) {
  res.json({ role: req.user.role, sections: sectionsFor(req.user.role) });
}

export async function dashboard(req, res) {
  const [{ rows: [u] }, { rows: [t] }, { rows: st }, { rows: [reg] }, { rows: upcoming }, { rows: expiring }, { rows: noTime }, { rows: noBracket }, { rows: overdue }] = await Promise.all([
    query(`SELECT count(*)::int AS users, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified, count(*) FILTER (WHERE blocked)::int AS blocked FROM users`),
    query(`SELECT count(*)::int AS teams FROM teams`),
    query(`SELECT status, count(*)::int AS n FROM tournaments GROUP BY status`),
    query(`SELECT count(*) FILTER (WHERE status = 'pending_payment')::int AS pending,
                  count(*) FILTER (WHERE status = 'paid')::int AS paid,
                  COALESCE(sum(fee) FILTER (WHERE status = 'paid'), 0)::int AS fees,
                  count(*) FILTER (WHERE refund_due)::int AS refunds
             FROM tournament_registrations`),
    query(`SELECT id, name, slug, status, starts_at, max_teams,
                  (SELECT count(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'paid') AS paid
             FROM tournaments t WHERE status IN ('upcoming', 'live') ORDER BY (status = 'live') DESC, starts_at LIMIT 5`),
    query(`SELECT r.id, r.team_name, r.pay_until, t.id AS tournament_id, t.name AS tournament_name
             FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
            WHERE r.status = 'pending_payment' AND r.pay_until IS NOT NULL AND r.pay_until < now() + interval '6 hours'
            ORDER BY r.pay_until LIMIT 10`),
    query(`SELECT t.id, t.name, count(*)::int AS n
             FROM matches m JOIN tournaments t ON t.id = m.tournament_id
            WHERE t.status IN ('upcoming', 'live') AND m.starts_at IS NULL AND NOT m.bye AND m.status <> 'finished'
            GROUP BY t.id, t.name, t.starts_at ORDER BY t.starts_at LIMIT 10`),
    query(`SELECT t.id, t.name, t.starts_at,
                  (SELECT count(*)::int FROM tournament_registrations r WHERE r.tournament_id = t.id AND r.status = 'paid') AS paid
             FROM tournaments t
            WHERE t.status = 'upcoming' AND t.starts_at < now() + interval '48 hours'
              AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = t.id)
            ORDER BY t.starts_at LIMIT 10`),
    query(`SELECT t.id, t.name, count(*)::int AS n
             FROM matches m JOIN tournaments t ON t.id = m.tournament_id
            WHERE t.status = 'live' AND m.status IN ('ready', 'live') AND m.starts_at < now() - interval '30 minutes'
            GROUP BY t.id, t.name ORDER BY t.name LIMIT 10`),
  ]);
  const tournaments = { draft: 0, upcoming: 0, live: 0, finished: 0, cancelled: 0 };
  for (const r of st) tournaments[r.status] = r.n;
  const attention = attentionItems({
    expiring: expiring.map((e) => ({ id: e.id, teamName: e.team_name, payUntil: e.pay_until, tournamentId: e.tournament_id, tournamentName: e.tournament_name })),
    noTime, noBracket: noBracket.map((b) => ({ id: b.id, name: b.name, startsAt: b.starts_at, paid: b.paid })), overdue, refunds: reg.refunds,
  });
  // Журнал целиком — только админам
  let recent = [];
  if (req.user.role === 'admin') {
    const { rows } = await query(`SELECT id, created_at, actor_nick, actor_role, action, object_type, object_label FROM audit_log ORDER BY id DESC LIMIT 8`);
    recent = rows.map((e) => ({ id: String(e.id), at: e.created_at, actor: { nick: e.actor_nick, role: e.actor_role }, action: e.action, objectType: e.object_type, label: e.object_label }));
  }
  res.json({
    users: u.users, verified: u.verified, blocked: u.blocked, teams: t.teams, tournaments,
    pendingPayments: reg.pending, paidRegistrations: reg.paid, feesTotal: reg.fees, refundsDue: reg.refunds,
    upcoming: upcoming.map((x) => ({ id: x.id, name: x.name, slug: x.slug, status: x.status, startsAt: x.starts_at, maxTeams: x.max_teams, paid: x.paid })),
    attention, recent,
  });
}

export async function list(_req, res) {
  const { rows } = await query(`${TSELECT} ORDER BY (t.status IN ('live', 'upcoming', 'draft')) DESC, t.starts_at DESC LIMIT 200`);
  res.json({ tournaments: rows.map(serialize) });
}

export async function get(req, res) {
  res.json({ tournament: serialize(await findById(req.params.id)) });
}

export async function create(req, res) {
  const d = parse(createSchema, req.body);
  if (!isFuture(d.startsAt)) throw new HttpError(400, 'validation', 'startsAt');
  const row = await withTx(async (db) => {
    const slug = await uniqueSlug(db, d.name);
    const { rows } = await db.query(
      `INSERT INTO tournaments (slug, name, description, starts_at, team_size, match_format, fee, max_teams, map_pool, prize_places, registration_open, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) RETURNING *`,
      [slug, d.name, d.description, d.startsAt, d.teamSize, d.matchFormat, d.fee, d.maxTeams, d.mapPool, JSON.stringify(d.prizePlaces), d.registrationOpen, req.user.id],
    );
    await record(db, req, { action: 'tournament.create', objectType: 'tournament', objectId: rows[0].id, label: rows[0].name, after: auditView(rows[0]) });
    return rows[0];
  });
  res.status(201).json({ tournament: serialize(row) });
}

export async function update(req, res) {
  const d = parse(updateSchema, req.body);
  const keys = Object.keys(d);
  const out = await withTx(async (db) => {
    const t = await findById(req.params.id, db, true);
    if (!keys.length) return t;
    if (!EDITABLE.includes(t.status)) {
      const locked = keys.find((k) => !ALWAYS.includes(k));
      if (locked) throw new HttpError(409, 'locked', locked);
    }
    // «Будущее» проверяем, только если дату меняют: у анонсированного турнира время старта могло пройти, а описание поправить нужно.
    const dateChanged = d.startsAt && new Date(d.startsAt).getTime() !== new Date(t.starts_at).getTime();
    if (dateChanged && EDITABLE.includes(t.status) && !isFuture(d.startsAt)) throw new HttpError(400, 'validation', 'startsAt');
    // Заявки уже поданы под определённый формат состава и лимит мест
    if (d.teamSize !== undefined && d.teamSize !== t.team_size && t.teams_count + t.waitlist_count > 0) throw new HttpError(409, 'has_registrations', 'teamSize');
    if (d.maxTeams !== undefined && d.maxTeams < t.teams_count) throw new HttpError(409, 'max_below_occupied', 'maxTeams');

    const sets = [], vals = [t.id];
    for (const k of keys) {
      vals.push(k === 'prizePlaces' ? JSON.stringify(d[k]) : d[k]);
      sets.push(`${DB_COLUMN[k]} = $${vals.length}${k === 'prizePlaces' ? '::jsonb' : ''}`);
    }
    const { rows: [row] } = await db.query(`UPDATE tournaments SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals);
    await promoteWaitlist(db, row);    // лимит мест мог вырасти
    await record(db, req, { action: 'tournament.update', objectType: 'tournament', objectId: t.id, label: t.name, before: auditView(t), after: auditView(row), diff: true });
    return findById(t.id, db);
  });
  res.json({ tournament: serialize(out) });
}

export async function setStatus(req, res) {
  const d = parse(statusSchema, req.body);
  const out = await withTx(async (db) => {
    const t = await findById(req.params.id, db, true);
    if (!FLOW[t.status].includes(d.status)) throw new HttpError(409, 'bad_transition');
    if (d.status === 'upcoming' && !isFuture(t.starts_at)) throw new HttpError(409, 'start_in_past');
    // Черновик «невидим»: нельзя прятать турнир, на который уже кто-то записался
    if (d.status === 'draft' && t.teams_count + t.waitlist_count > 0) throw new HttpError(409, 'has_registrations');
    const { rows: [fin] } = await db.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE next_match_id IS NULL AND status = 'finished')::int AS final_done FROM matches WHERE tournament_id = $1`, [t.id]);
    // Начать турнир можно, только когда сформирована сетка; закрыть вручную — только если нет сетки или финал сыгран
    if (d.status === 'live' && !fin.total) throw new HttpError(409, 'bracket_required');
    if (d.status === 'finished' && fin.total && !fin.final_done) throw new HttpError(409, 'matches_unfinished');
    // Черновик и восстановление отменённого турнира начинают с чистой сетки (заявки отменённого уже сняты)
    if (d.status === 'draft' || t.status === 'cancelled') await db.query('DELETE FROM matches WHERE tournament_id = $1', [t.id]);
    if (d.status === 'live') await cancelWhere(db, t.id, ['pending_payment', 'waitlist'], 'tournament_started');   // неоплаченные и лист ожидания не играют
    const winner = d.status === 'finished' ? { name: d.winnerName || null, roster: d.winnerRoster || [] } : { name: t.winner_name, roster: t.winner_roster };
    await db.query(
      `UPDATE tournaments SET status = $2, winner_name = $3, winner_roster = $4, updated_at = now() WHERE id = $1`,
      [t.id, d.status, winner.name, winner.roster],
    );
    await record(db, req, {
      action: 'tournament.status', objectType: 'tournament', objectId: t.id, label: t.name,
      before: { status: t.status, winner: t.winner_name }, after: { status: d.status, winner: winner.name },
    });
    return findById(t.id, db);
  });
  res.json({ tournament: serialize(out) });
}

/** Копия турнира: настройки переносятся, заявки, сетка и победитель — нет. Копия — черновик с новой датой. */
export async function duplicate(req, res) {
  const d = parse(duplicateSchema, req.body);
  if (!isFuture(d.startsAt)) throw new HttpError(400, 'validation', 'startsAt');
  const row = await withTx(async (db) => {
    const src = await findById(req.params.id, db, true);
    const f = duplicateFields(src, d);
    const slug = await uniqueSlug(db, f.name);
    const { rows } = await db.query(
      `INSERT INTO tournaments (slug, name, description, starts_at, team_size, match_format, fee, max_teams, map_pool, prize_places, registration_open, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) RETURNING *`,
      [slug, f.name, f.description, f.startsAt, f.teamSize, f.matchFormat, f.fee, f.maxTeams, f.mapPool, JSON.stringify(f.prizePlaces), f.registrationOpen, req.user.id]);
    await record(db, req, { action: 'tournament.duplicate', objectType: 'tournament', objectId: rows[0].id, label: rows[0].name, after: auditView(rows[0]), meta: { sourceId: src.id, sourceName: src.name } });
    return rows[0];
  });
  res.status(201).json({ tournament: serialize(row) });
}

/**
 * Отмена турнира с причиной. Все живые заявки снимаются, оплаченные помечаются «вернуть взнос» (cancelWhere).
 * Сетка остаётся как история, но турнир из анонса и из «идущих» пропадает.
 */
export async function cancel(req, res) {
  const d = parse(cancelSchema, req.body);
  const out = await withTx(async (db) => {
    const t = await findById(req.params.id, db, true);
    if (!FLOW[t.status].includes('cancelled')) throw new HttpError(409, 'bad_transition');
    const { rows: regs } = await db.query('SELECT status, fee FROM tournament_registrations WHERE tournament_id = $1', [t.id]);
    const summary = cancelSummary(regs);
    await cancelWhere(db, t.id, ['pending_payment', 'paid', 'waitlist'], 'tournament_cancelled');
    await db.query(`UPDATE tournaments SET status = 'cancelled', updated_at = now() WHERE id = $1`, [t.id]);
    await record(db, req, {
      action: 'tournament.cancel', objectType: 'tournament', objectId: t.id, label: t.name,
      before: { status: t.status }, after: { status: 'cancelled' }, meta: { reason: d.reason, ...summary },
    });
    return { tournament: await findById(t.id, db), summary };
  });
  res.json({ tournament: serialize(out.tournament), summary: out.summary });
}

/** Удалять можно только черновик или отменённый турнир, и только если по нему нет денежных следов (оплаченных заявок и невозвращённых взносов). */
export async function remove(req, res) {
  await withTx(async (db) => {
    const t = await findById(req.params.id, db, true);
    if (!['draft', 'cancelled'].includes(t.status)) throw new HttpError(409, 'not_deletable');
    const { rowCount } = await db.query(
      `SELECT 1 FROM tournament_registrations WHERE tournament_id = $1 AND (status = 'paid' OR refund_due) LIMIT 1`, [t.id]);
    if (rowCount) throw new HttpError(409, 'has_payments');
    await db.query('DELETE FROM tournaments WHERE id = $1', [t.id]);
    await record(db, req, { action: 'tournament.delete', objectType: 'tournament', objectId: t.id, label: t.name, before: auditView(t) });
  });
  res.json({ ok: true });
}
