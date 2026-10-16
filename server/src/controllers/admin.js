import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { config } from '../config.js';
import { slugify } from '../utils/slug.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { serialize, TSELECT } from './tournaments.js';
import { cancelWhere, promoteWaitlist } from '../services/registrations.js';

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
const statusSchema = z.object({
  status: z.enum(['draft', 'upcoming', 'live', 'finished', 'cancelled']),
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
const isFuture = (iso) => new Date(iso).getTime() > Date.now();

// ---------- Обработчики ----------
export async function dashboard(_req, res) {
  const [{ rows: [u] }, { rows: [t] }, { rows: st }, { rows: [reg] }] = await Promise.all([
    query(`SELECT count(*)::int AS users, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified FROM users`),
    query(`SELECT count(*)::int AS teams FROM teams`),
    query(`SELECT status, count(*)::int AS n FROM tournaments GROUP BY status`),
    query(`SELECT count(*) FILTER (WHERE status = 'pending_payment')::int AS pending, count(*) FILTER (WHERE refund_due)::int AS refunds FROM tournament_registrations`),
  ]);
  const tournaments = { draft: 0, upcoming: 0, live: 0, finished: 0, cancelled: 0 };
  for (const r of st) tournaments[r.status] = r.n;
  res.json({ users: u.users, verified: u.verified, teams: t.teams, tournaments, pendingPayments: reg.pending, refundsDue: reg.refunds });
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
  const base = slugify(d.name);
  let slug = base;
  for (let i = 2; (await query('SELECT 1 FROM tournaments WHERE slug = $1', [slug])).rowCount; i++) slug = `${base}-${i}`;
  const { rows } = await query(
    `INSERT INTO tournaments (slug, name, description, starts_at, team_size, match_format, fee, max_teams, map_pool, prize_places, registration_open, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) RETURNING *`,
    [slug, d.name, d.description, d.startsAt, d.teamSize, d.matchFormat, d.fee, d.maxTeams, d.mapPool, JSON.stringify(d.prizePlaces), d.registrationOpen, req.user.id],
  );
  res.status(201).json({ tournament: serialize(rows[0]) });
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
    if (d.status === 'cancelled') await cancelWhere(db, t.id, ['pending_payment', 'paid', 'waitlist'], 'tournament_cancelled');   // оплаченным вернуть взнос
    const winner = d.status === 'finished' ? { name: d.winnerName || null, roster: d.winnerRoster || [] } : { name: t.winner_name, roster: t.winner_roster };
    await db.query(
      `UPDATE tournaments SET status = $2, winner_name = $3, winner_roster = $4, updated_at = now() WHERE id = $1`,
      [t.id, d.status, winner.name, winner.roster],
    );
    return findById(t.id, db);
  });
  res.json({ tournament: serialize(out) });
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
  });
  res.json({ ok: true });
}
