import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { record } from '../services/audit.js';
import { isStaff } from '../services/permissions.js';
import { rollbackBlocker } from '../services/match-tools.js';
import { buildBracket, forfeitScore, roundName, scheduleMatches, seriesFromMaps, shuffle, validateMaps, validateScore, winnerSlot } from '../services/bracket.js';

/** Состояние матча для журнала (в том числе то, что нужно для отката результата). */
const matchView = (m) => ({ status: m.status, scoreA: m.score_a, scoreB: m.score_b, winner: m.winner, forfeit: m.forfeit, forfeitReason: m.forfeit_reason, maps: m.maps, demoUrl: m.demo_url, startsAt: m.starts_at, lobby: m.lobby });
const matchLabel = (m, t) => `${m.name_a ?? '?'} — ${m.name_b ?? '?'} (${t.name})`;

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

/** Матч + участники (заявки → команды) + турнир. Основа и просмотра, и проверок прав. */
const MATCH_SELECT = `
  SELECT m.*,
         ra.team_id AS team_a_id, ra.roster AS roster_a, ra.roster_ids AS ids_a, ta.slug AS slug_a, ta.logo AS logo_a,
         rb.team_id AS team_b_id, rb.roster AS roster_b, rb.roster_ids AS ids_b, tb.slug AS slug_b, tb.logo AS logo_b,
         t.slug AS t_slug, t.name AS t_name, t.status AS t_status, t.match_format, t.team_size, t.starts_at AS t_starts_at
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    LEFT JOIN tournament_registrations ra ON ra.id = m.reg_a LEFT JOIN teams ta ON ta.id = ra.team_id
    LEFT JOIN tournament_registrations rb ON rb.id = m.reg_b LEFT JOIN teams tb ON tb.id = rb.team_id`;

const side = (m, s) => (m[`reg_${s}`] || m[`name_${s}`]
  ? { regId: m[`reg_${s}`], name: m[`name_${s}`], slug: m[`slug_${s}`] ?? null, logo: m[`logo_${s}`] ?? null, seed: m[`seed_${s}`] }
  : null);

/** Матч для клиента. Данные лобби отдаём только когда это явно разрешено (участникам матча и админам). */
export function serializeMatch(m, { lobby = false } = {}) {
  return {
    id: m.id, round: m.round, position: m.position, status: m.status, bye: m.bye,
    startsAt: m.starts_at, finishedAt: m.finished_at,
    scoreA: m.score_a, scoreB: m.score_b, winner: m.winner,
    a: side(m, 'a'), b: side(m, 'b'),
    nextId: m.next_match_id, demoUrl: m.demo_url,
    forfeit: m.forfeit, forfeitReason: m.forfeit_reason, maps: m.maps ?? null,
    hasLobby: !!m.lobby, ...(lobby && { lobby: m.lobby }),
  };
}

/** Сетка по раундам. */
async function loadBracket(db, tournamentId, opts) {
  const { rows } = await db.query(`${MATCH_SELECT} WHERE m.tournament_id = $1 ORDER BY m.round, m.position`, [tournamentId]);
  const total = rows.length ? Math.max(...rows.map((r) => r.round)) : 0;
  const rounds = [];
  for (let r = 1; r <= total; r++) {
    rounds.push({ round: r, name: roundName(r, total), matches: rows.filter((m) => m.round === r).map((m) => serializeMatch(m, opts)) });
  }
  return { totalRounds: total, rounds };
}

const tournamentBrief = (t) => ({ slug: t.slug, name: t.name, status: t.status, matchFormat: t.match_format, teamSize: t.team_size, startsAt: t.starts_at });

// ---------- Публичный API ----------
export async function publicBracket(req, res) {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
  const { rows: [t] } = await query(`SELECT * FROM tournaments WHERE slug = $1 AND status <> 'draft'`, [slug]);
  if (!t) throw new HttpError(404, 'not_found');
  const bracket = await loadBracket({ query }, t.id);
  // Пока турнир не начался, сетка предварительная: админ может её пересоздать
  res.json({ tournament: tournamentBrief(t), preliminary: t.status === 'upcoming', ...bracket });
}

export async function getMatch(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rows: [m] } = await query(`${MATCH_SELECT} WHERE m.id = $1 AND t.status <> 'draft'`, [id.data]);
  if (!m) throw new HttpError(404, 'not_found');

  const uid = req.user?.id;
  const mySide = uid ? ((m.ids_a || []).includes(uid) ? 'a' : (m.ids_b || []).includes(uid) ? 'b' : null) : null;
  const lobby = (isStaff(req.user?.role) || !!mySide) && m.status !== 'finished';

  const { rows: prev } = await query(
    `${MATCH_SELECT} WHERE m.next_match_id = $1 ORDER BY m.position`, [m.id]);
  const total = (await query('SELECT max(round)::int AS n FROM matches WHERE tournament_id = $1', [m.tournament_id])).rows[0].n;
  res.json({
    match: { ...serializeMatch(m, { lobby }), rosterA: m.roster_a || [], rosterB: m.roster_b || [], roundName: roundName(m.round, total), totalRounds: total },
    tournament: tournamentBrief({ slug: m.t_slug, name: m.t_name, status: m.t_status, match_format: m.match_format, team_size: m.team_size, starts_at: m.t_starts_at }),
    previous: prev.map((p) => ({ id: p.id, round: p.round, position: p.position, a: side(p, 'a'), b: side(p, 'b'), scoreA: p.score_a, scoreB: p.score_b, winner: p.winner, status: p.status })),
    viewer: { side: mySide },
  });
}

/** «Мои матчи»: матчи команд, в чьём составе заявки стоит пользователь. Сначала идущие и ближайшие. */
export async function myMatches(req, res) {
  const { rows } = await query(
    `${MATCH_SELECT}
      WHERE ($1 = ANY(ra.roster_ids) OR $1 = ANY(rb.roster_ids)) AND NOT m.bye AND t.status <> 'draft'
      ORDER BY CASE m.status WHEN 'live' THEN 0 WHEN 'ready' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
               m.starts_at NULLS LAST, m.finished_at DESC NULLS LAST
      LIMIT 30`, [req.user.id]);
  res.json({
    matches: rows.map((m) => {
      const mine = (m.ids_a || []).includes(req.user.id) ? 'a' : 'b';
      return {
        ...serializeMatch(m, { lobby: m.status !== 'finished' }),
        side: mine,
        tournament: { slug: m.t_slug, name: m.t_name, status: m.t_status },
      };
    }),
  });
}

// ---------- Админка ----------
const genSchema = z.object({
  seeding: z.enum(['random', 'registration', 'manual']).default('random'),
  order: z.array(uuid).min(2).max(128).optional(),
});
const demoUrlSchema = z.string().trim().url().max(300).refine((u) => /^https?:\/\//i.test(u));
// Результат: либо счёт, либо forfeit (кто проиграл без игры и почему). Ссылку на демо можно приложить сразу.
const mapSchema = z.object({
  map: z.string().trim().regex(/^[A-Za-z0-9_]{2,32}$/).nullable().optional(),
  a: z.number().int().min(0).max(99),
  b: z.number().int().min(0).max(99),
  demoUrl: demoUrlSchema.nullable().optional(),
});
const resultSchema = z.object({
  maps: z.array(mapSchema).min(2).max(3).nullable().optional(),
  scoreA: z.number().int().min(0).max(99).optional(),
  scoreB: z.number().int().min(0).max(99).optional(),
  forfeit: z.object({ loser: z.enum(['a', 'b']), reason: z.enum(['tech', 'noshow']) }).nullable().optional(),
  demoUrl: demoUrlSchema.nullable().optional(),
});
const patchSchema = z.object({
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  lobby: z.string().trim().max(300).nullable().optional(),
  demoUrl: demoUrlSchema.nullable().optional(),
  status: z.enum(['ready', 'live']).optional(),
});
const scheduleSchema = z.object({
  start: z.string().datetime({ offset: true }),
  intervalMin: z.number().int().min(1).max(720),
  parallel: z.number().int().min(1).max(32).default(1),
  rounds: z.enum(['first', 'all']).default('all'),
  overwrite: z.boolean().default(false),
});

async function lockTournament(db, id) {
  const ok = uuid.safeParse(id);
  if (!ok.success) throw new HttpError(404, 'not_found');
  const { rows: [t] } = await db.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [ok.data]);
  if (!t) throw new HttpError(404, 'not_found');
  return t;
}

export async function adminBracket(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rows: [t] } = await query('SELECT * FROM tournaments WHERE id = $1', [id.data]);
  if (!t) throw new HttpError(404, 'not_found');
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM tournament_registrations WHERE tournament_id = $1 AND status = 'paid'`, [t.id]);
  const bracket = await loadBracket({ query }, t.id, { lobby: true });
  res.json({ tournament: tournamentBrief(t), paidTeams: n, canGenerate: t.status === 'upcoming' && n >= 2, ...bracket });
}

/**
 * Формирует сетку из оплаченных заявок (заменяет прежнюю). Только пока турнир не начался.
 * seeding: random — жеребьёвка; registration — по порядку оплаты (первые оплатившие получают проход без игры); manual — порядок order (id заявок).
 */
export async function generate(req, res) {
  const d = parse(genSchema, req.body ?? {});
  const bracket = await withTx(async (db) => {
    const t = await lockTournament(db, req.params.id);
    if (t.status !== 'upcoming') throw new HttpError(409, 'bad_state');
    const { rows: paid } = await db.query(
      `SELECT id, team_name FROM tournament_registrations WHERE tournament_id = $1 AND status = 'paid' ORDER BY paid_at, created_at`, [t.id]);
    if (paid.length < 2) throw new HttpError(409, 'not_enough_teams');

    let ids = paid.map((p) => p.id);
    if (d.seeding === 'random') ids = shuffle(ids);
    if (d.seeding === 'manual') {
      const order = d.order ?? [];
      if (order.length !== ids.length || new Set(order).size !== order.length || order.some((x) => !ids.includes(x))) throw new HttpError(400, 'validation', 'order');
      ids = order;
    }
    const names = new Map(paid.map((p) => [p.id, p.team_name]));
    const plan = buildBracket(ids);
    const seedOf = (regId) => (regId ? ids.indexOf(regId) + 1 : null);

    await db.query('DELETE FROM matches WHERE tournament_id = $1', [t.id]);
    const mid = new Map(plan.matches.map((m) => [`${m.round}:${m.position}`, randomUUID()]));
    // Вставляем с финала к первому раунду: ссылка next_match_id всегда указывает на уже существующую строку
    for (const m of [...plan.matches].sort((x, y) => y.round - x.round || x.position - y.position)) {
      await db.query(
        `INSERT INTO matches (id, tournament_id, round, position, reg_a, reg_b, name_a, name_b, seed_a, seed_b, winner, bye, status, next_match_id, next_slot, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [mid.get(`${m.round}:${m.position}`), t.id, m.round, m.position, m.a, m.b, m.a ? names.get(m.a) : null, m.b ? names.get(m.b) : null,
          seedOf(m.a), seedOf(m.b), m.winner, m.bye, m.status,
          m.next ? mid.get(`${m.next.round}:${m.next.position}`) : null, m.next?.slot ?? null, m.bye ? new Date() : null]);
    }
    await record(db, req, { action: 'bracket.generate', objectType: 'tournament', objectId: t.id, label: t.name, meta: { teams: ids.length, seeding: d.seeding } });
    return loadBracket(db, t.id, { lobby: true });
  });
  res.status(201).json({ ...bracket });
}

export async function removeBracket(req, res) {
  await withTx(async (db) => {
    const t = await lockTournament(db, req.params.id);
    if (t.status !== 'upcoming') throw new HttpError(409, 'bad_state');
    await db.query('DELETE FROM matches WHERE tournament_id = $1', [t.id]);
    await record(db, req, { action: 'bracket.remove', objectType: 'tournament', objectId: t.id, label: t.name });
  });
  res.json({ ok: true });
}

/**
 * Результат матча. Победитель проходит в следующий матч; результат финала завершает турнир и записывает победителя.
 * Исправить уже введённый результат можно, пока следующий матч не начат (если победитель при этом меняется).
 */
export async function setResult(req, res) {
  const d = parse(resultSchema, req.body);
  const out = await withTx(async (db) => {
    const mid = uuid.safeParse(req.params.id);
    if (!mid.success) throw new HttpError(404, 'not_found');
    const { rows: [head] } = await db.query('SELECT tournament_id FROM matches WHERE id = $1', [mid.data]);
    if (!head) throw new HttpError(404, 'not_found');
    const t = await lockTournament(db, head.tournament_id);        // порядок блокировок: турнир → матч → следующий матч
    const { rows: [m] } = await db.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [mid.data]);

    if (!['live', 'finished'].includes(t.status)) throw new HttpError(409, 'bad_state');
    if (m.bye) throw new HttpError(409, 'bye_match');
    if (!m.reg_a || !m.reg_b) throw new HttpError(409, 'not_ready');
    let sa = d.scoreA, sb = d.scoreB, maps = null;
    if (d.forfeit) [sa, sb] = forfeitScore(t.match_format, d.forfeit.loser);
    else if (d.maps) {                                   // BO3 с очками по картам: счёт серии считаем сами
      if (t.match_format !== 'bo3') throw new HttpError(400, 'validation', 'maps');
      const badMaps = validateMaps(d.maps);
      if (badMaps) throw new HttpError(400, badMaps, 'maps');
      [sa, sb] = seriesFromMaps(d.maps);
      maps = d.maps.map((x) => ({ map: x.map || null, a: x.a, b: x.b, demoUrl: x.demoUrl || null }));
    } else {
      if (sa === undefined || sb === undefined) throw new HttpError(400, 'validation', 'scoreA');
      const bad = validateScore(t.match_format, sa, sb);
      if (bad) throw new HttpError(400, bad, 'scoreA');
    }

    const win = winnerSlot(sa, sb);
    const winReg = win === 'a' ? m.reg_a : m.reg_b;
    const winName = win === 'a' ? m.name_a : m.name_b;
    const winSeed = win === 'a' ? m.seed_a : m.seed_b;

    let next = null;
    if (m.next_match_id) {
      next = (await db.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [m.next_match_id])).rows[0];
      // Победитель меняется — следующий матч не должен быть начат
      if (m.status === 'finished' && m.winner !== win && ['live', 'finished'].includes(next.status)) throw new HttpError(409, 'next_match_played');
    }

    await db.query(
      `UPDATE matches SET score_a = $2, score_b = $3, winner = $4, forfeit = $5, forfeit_reason = $6, maps = $9::jsonb,
              demo_url = CASE WHEN $7::boolean THEN $8 ELSE demo_url END,
              status = 'finished', finished_at = COALESCE(finished_at, now()), updated_at = now() WHERE id = $1`,
      [m.id, sa, sb, win, d.forfeit?.loser ?? null, d.forfeit?.reason ?? null, d.demoUrl !== undefined, d.demoUrl || null, maps ? JSON.stringify(maps) : null]);

    if (next && (m.status !== 'finished' || m.winner !== win)) {
      const s = m.next_slot;
      const other = s === 'a' ? next.reg_b : next.reg_a;
      await db.query(
        `UPDATE matches SET reg_${s} = $2, name_${s} = $3, seed_${s} = $4,
                status = $5, score_a = NULL, score_b = NULL, winner = NULL, updated_at = now()
          WHERE id = $1`,
        [next.id, winReg, winName, winSeed, other ? 'ready' : 'pending']);
    }

    if (!m.next_match_id) {          // финал: турнир завершён, победитель известен
      const { rows: [reg] } = await db.query('SELECT team_name, roster FROM tournament_registrations WHERE id = $1', [winReg]);
      await db.query(
        `UPDATE tournaments SET status = 'finished', winner_name = $2, winner_roster = $3, updated_at = now() WHERE id = $1`,
        [t.id, reg.team_name, reg.roster.map((p) => p.nick)]);
    }
    const { rows: [fresh] } = await db.query(`${MATCH_SELECT} WHERE m.id = $1`, [m.id]);
    const { rows: [tt] } = await db.query('SELECT status, winner_name FROM tournaments WHERE id = $1', [t.id]);
    await record(db, req, {
      action: 'match.result', objectType: 'match', objectId: m.id, label: matchLabel(m, t), before: matchView(m), after: matchView(fresh),
      meta: { tournamentId: t.id, round: m.round, position: m.position, winnerName: winName, nextMatchId: m.next_match_id, tournamentFinished: !m.next_match_id },
    });
    return { match: serializeMatch(fresh, { lobby: true }), tournament: { status: tt.status, winner: tt.winner_name } };
  });
  res.json(out);
}

/**
 * Откат результата: матч снова «готов», победитель убирается из следующего матча.
 * Можно, пока следующий матч не начат. Откат финала возвращает турнир в «идёт». Причина обязательна, пишется в журнал.
 */
export async function rollbackResult(req, res) {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  const out = await withTx(async (db) => {
    const mid = uuid.safeParse(req.params.id);
    if (!mid.success) throw new HttpError(404, 'not_found');
    const { rows: [head] } = await db.query('SELECT tournament_id FROM matches WHERE id = $1', [mid.data]);
    if (!head) throw new HttpError(404, 'not_found');
    const t = await lockTournament(db, head.tournament_id);
    const { rows: [m] } = await db.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [mid.data]);
    const next = m.next_match_id ? (await db.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [m.next_match_id])).rows[0] : null;
    const blocked = rollbackBlocker({ tournamentStatus: t.status, match: m, next });
    if (blocked) throw new HttpError(409, blocked);

    await db.query(
      `UPDATE matches SET score_a = NULL, score_b = NULL, winner = NULL, forfeit = NULL, forfeit_reason = NULL, maps = NULL,
              status = 'ready', finished_at = NULL, updated_at = now() WHERE id = $1`, [m.id]);
    if (next) {
      const s = m.next_slot;
      await db.query(
        `UPDATE matches SET reg_${s} = NULL, name_${s} = NULL, seed_${s} = NULL, status = 'pending', score_a = NULL, score_b = NULL, winner = NULL, updated_at = now() WHERE id = $1`, [next.id]);
    } else {          // откатили финал: турнир снова идёт, победитель неизвестен
      await db.query(`UPDATE tournaments SET status = 'live', winner_name = NULL, winner_roster = '{}', updated_at = now() WHERE id = $1`, [t.id]);
    }
    const { rows: [fresh] } = await db.query(`${MATCH_SELECT} WHERE m.id = $1`, [m.id]);
    const { rows: [tt] } = await db.query('SELECT status, winner_name FROM tournaments WHERE id = $1', [t.id]);
    await record(db, req, {
      action: 'match.rollback', objectType: 'match', objectId: m.id, label: matchLabel(m, t), before: matchView(m), after: matchView(fresh),
      meta: { reason, tournamentId: t.id, round: m.round, position: m.position, nextMatchId: m.next_match_id, tournamentReopened: !m.next_match_id },
    });
    return { match: serializeMatch(fresh, { lobby: true }), tournament: { status: tt.status, winner: tt.winner_name } };
  });
  res.json(out);
}

/** Расписание, данные лобби, ссылка на демо, отметка «идёт». */
export async function patchMatch(req, res) {
  const d = parse(patchSchema, req.body);
  const out = await withTx(async (db) => {
    const mid = uuid.safeParse(req.params.id);
    if (!mid.success) throw new HttpError(404, 'not_found');
    const { rows: [head] } = await db.query('SELECT tournament_id FROM matches WHERE id = $1', [mid.data]);
    if (!head) throw new HttpError(404, 'not_found');
    const t = await lockTournament(db, head.tournament_id);
    const { rows: [m] } = await db.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [mid.data]);
    if (!['upcoming', 'live', 'finished'].includes(t.status)) throw new HttpError(409, 'bad_state');

    const sets = [], vals = [m.id];
    const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (d.startsAt !== undefined) put('starts_at', d.startsAt);
    if (d.lobby !== undefined) put('lobby', d.lobby || null);
    if (d.demoUrl !== undefined) put('demo_url', d.demoUrl || null);
    if (d.status) {
      if (t.status !== 'live' || m.bye) throw new HttpError(409, 'bad_state');
      if (d.status === 'live' && m.status !== 'ready') throw new HttpError(409, 'not_ready');
      if (d.status === 'ready' && m.status !== 'live') throw new HttpError(409, 'bad_state');
      put('status', d.status);
    }
    if (sets.length) await db.query(`UPDATE matches SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
    const { rows: [fresh] } = await db.query(`${MATCH_SELECT} WHERE m.id = $1`, [m.id]);
    if (sets.length) await record(db, req, { action: 'match.update', objectType: 'match', objectId: m.id, label: matchLabel(m, t), before: matchView(m), after: matchView(fresh), diff: true, meta: { tournamentId: t.id } });
    return { match: serializeMatch(fresh, { lobby: true }) };
  });
  res.json(out);
}

/**
 * Массовое расписание: время первого матча и интервал между матчами (см. scheduleMatches).
 * Идущие, сыгранные матчи и проходы без игры не трогаются; уже назначенное время — только если overwrite.
 */
export async function schedule(req, res) {
  const d = parse(scheduleSchema, req.body ?? {});
  const out = await withTx(async (db) => {
    const t = await lockTournament(db, req.params.id);
    if (!['upcoming', 'live'].includes(t.status)) throw new HttpError(409, 'bad_state');
    const { rows } = await db.query('SELECT id, round, position, bye, status, starts_at FROM matches WHERE tournament_id = $1', [t.id]);
    if (!rows.length) throw new HttpError(409, 'no_bracket');
    const plan = scheduleMatches(
      rows.map((r) => ({ id: r.id, round: r.round, position: r.position, bye: r.bye, status: r.status, startsAt: r.starts_at })), d);
    for (const p of plan) await db.query('UPDATE matches SET starts_at = $2, updated_at = now() WHERE id = $1', [p.id, p.startsAt]);
    await record(db, req, { action: 'bracket.schedule', objectType: 'tournament', objectId: t.id, label: t.name, meta: { scheduled: plan.length, start: d.start, intervalMin: d.intervalMin, parallel: d.parallel, rounds: d.rounds, overwrite: d.overwrite } });
    return { scheduled: plan.length, ...(await loadBracket(db, t.id, { lobby: true })) };
  });
  res.json(out);
}
