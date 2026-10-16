import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { config } from '../config.js';
import { randomToken } from '../utils/token.js';
import { slugify, RESERVED_SLUGS } from '../utils/slug.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { ACTIVE } from '../services/registrations.js';

const { maxMain, maxSub, maxOwned, maxJoined, maxPendingInvites } = config.teams;
const MAX_TOTAL = maxMain + maxSub;

// ---------- Валидация (правила те же, что на клиенте: client/src/js/validators.js) ----------
const RESERVED_NAMES = ['val', 'admin', 'administrator', 'moderator', 'support', 'vologdaamateurleague'];
const teamName = z.string().trim().transform((s) => s.replace(/\s+/g, ' '))
  .pipe(z.string().min(3).max(24).regex(/^[A-Za-zА-Яа-яЁё0-9 _.\-]+$/))
  .refine((v) => !RESERVED_NAMES.includes(v.toLowerCase().replace(/\s/g, '')));
const description = z.string().trim().max(300);
const nick = z.string().trim().min(1).max(40);

const schemas = {
  create: z.object({ name: teamName, description: description.default('') }),
  update: z.object({ name: teamName.optional(), description: description.optional() }),
  invite: z.object({ nick }),
  role: z.object({ role: z.enum(['main', 'sub']) }),
  captain: z.object({ userId: uuid }),
  invitePick: z.object({ token: z.string().min(20).max(200).optional(), id: uuid.optional() })
    .refine((d) => !!d.token !== !!d.id),
  decline: z.object({ id: uuid }),
};

// ---------- Вспомогательное ----------
const SLUG_RE = /^[a-z0-9-]{1,40}$/;

async function findTeam(slug, db = { query }, lock = false) {
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
  const { rows } = await db.query(`SELECT * FROM teams WHERE slug = $1${lock ? ' FOR UPDATE' : ''}`, [slug]);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  return rows[0];
}

/** Команда под блокировкой строки + проверка, что запрос от капитана. Блокировка защищает лимиты состава от гонок. */
async function lockCaptainTeam(db, req) {
  const team = await findTeam(req.params.slug, db, true);
  if (team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');
  return team;
}

const memberRows = async (db, teamId) => (await db.query(
  'SELECT user_id, role FROM team_members WHERE team_id = $1', [teamId])).rows;

const paramUserId = (req) => {
  const r = uuid.safeParse(req.params.userId);
  if (!r.success) throw new HttpError(404, 'not_found');
  return r.data;
};

// ---------- Логотипы ----------
const logoFile = (name) => path.join(config.uploadsDir, 'logos', path.basename(name));
const dropLogo = (name) => (name ? fs.unlink(logoFile(name)).catch(() => {}) : undefined);

/** Тип картинки определяем по первым байтам, а не по заголовку от клиента. SVG не принимаем: в нём может быть скрипт. */
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// ---------- Ответы ----------
/** Турниры команды: живые заявки в предстоящих и идущих турнирах и сыгранные (оплаченные). Снятые заявки в историю не попадают. */
async function teamTournaments(teamId) {
  const { rows } = await query(
    `SELECT t.slug, t.name, t.status, t.starts_at AS \"startsAt\", r.status AS \"regStatus\"
       FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.team_id = $1 AND r.status <> 'cancelled' AND t.status <> 'draft'
      ORDER BY t.starts_at DESC LIMIT 20`, [teamId]);
  return rows;
}

/** Активные заявки команды в предстоящих/идущих турнирах: пока они есть, состав и сама команда заморожены. */
async function activeRegistrations(db, teamId) {
  const { rows } = await db.query(
    `SELECT r.roster_ids, t.name FROM tournament_registrations r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.team_id = $1 AND r.status = ANY($2::text[]) AND t.status IN ('upcoming', 'live')`, [teamId, ACTIVE]);
  return rows;
}

async function teamPayload(team, user) {
  const { rows } = await query(
    `SELECT u.id, u.nick, (u.steam_id IS NOT NULL) AS steam, m.role
       FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1
      ORDER BY COALESCE(u.id = $2::uuid, false) DESC, (m.role = 'main') DESC, m.joined_at`,
    [team.id, team.captain_id],
  );
  const members = rows.map((r) => ({ id: r.id, nick: r.nick, role: r.role, steam: r.steam, isCaptain: r.id === team.captain_id }));
  const me = user ? members.find((m) => m.id === user.id) : null;
  const isCaptain = !!user && team.captain_id === user.id;

  const out = {
    team: {
      slug: team.slug, name: team.name, description: team.description, logo: team.logo, createdAt: team.created_at,
      limits: { main: maxMain, sub: maxSub },
    },
    members,
    viewer: user ? { isMember: !!me, isCaptain, role: me?.role ?? null } : null,
    tournaments: await teamTournaments(team.id),
  };
  if (isCaptain) {
    out.inviteToken = team.invite_token;
    out.invites = (await query(
      `SELECT i.id, u.nick, i.created_at AS "createdAt"
         FROM team_invites i JOIN users u ON u.id = i.invitee_id
        WHERE i.team_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
      [team.id],
    )).rows;
  }
  return out;
}

/** Вступление в команду. Вызывать внутри транзакции, когда строка команды уже заблокирована. */
async function join(db, teamId, userId) {
  const members = await memberRows(db, teamId);
  if (members.some((m) => m.user_id === userId)) throw new HttpError(409, 'already_member');
  if (members.length >= MAX_TOTAL) throw new HttpError(409, 'team_full');
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM team_members WHERE user_id = $1', [userId]);
  if (n >= maxJoined) throw new HttpError(409, 'too_many_teams');
  const role = members.filter((m) => m.role === 'main').length < maxMain ? 'main' : 'sub';
  await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [teamId, userId, role]);
  await db.query(
    `UPDATE team_invites SET status = 'accepted', responded_at = now()
      WHERE team_id = $1 AND invitee_id = $2 AND status = 'pending'`,
    [teamId, userId],
  );
  return role;
}

// ---------- Команды ----------
export async function listMine(req, res) {
  const uid = req.user.id;
  const teams = (await query(
    `SELECT t.slug, t.name, t.logo, m.role, (t.captain_id = $1) AS "isCaptain",
            (SELECT count(*) FROM team_members x WHERE x.team_id = t.id)::int AS members
       FROM team_members m JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = $1 ORDER BY (t.captain_id = $1) DESC, m.joined_at`,
    [uid],
  )).rows;
  const invites = (await query(
    `SELECT i.id, t.slug, t.name, t.logo, ub.nick AS "invitedBy", i.created_at AS "createdAt"
       FROM team_invites i JOIN teams t ON t.id = i.team_id LEFT JOIN users ub ON ub.id = i.invited_by
      WHERE i.invitee_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
    [uid],
  )).rows;
  res.json({ teams, invites, limits: { owned: maxOwned } });
}

/** Публичный каталог команд: поиск по названию, постранично. */
export async function directory(req, res) {
  const q = String(req.query.q ?? '').trim().slice(0, 40).replace(/[\\%_]/g, (c) => `\\${c}`);
  const limit = 24, offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const where = q ? `WHERE t.name ILIKE $1 ESCAPE '\\'` : '';
  const args = q ? [`%${q}%`] : [];
  const { rows } = await query(
    `SELECT t.slug, t.name, t.logo, uc.nick AS captain,
            (SELECT count(*) FROM team_members m WHERE m.team_id = t.id)::int AS members
       FROM teams t LEFT JOIN users uc ON uc.id = t.captain_id ${where}
      ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`, args);
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM teams t ${where}`, args);
  res.json({ teams: rows, total: n, limit });
}

export async function create(req, res) {
  const d = parse(schemas.create, req.body);
  const u = req.user;
  const slug = await withTx(async (db) => {
    // Один пользователь не должен плодить команды и состоять в десятках: блокируем строку пользователя на время проверки.
    await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [u.id]);
    const owned = (await db.query('SELECT count(*)::int AS n FROM teams WHERE captain_id = $1', [u.id])).rows[0].n;
    if (owned >= maxOwned) throw new HttpError(409, 'too_many_owned');
    const joined = (await db.query('SELECT count(*)::int AS n FROM team_members WHERE user_id = $1', [u.id])).rows[0].n;
    if (joined >= maxJoined) throw new HttpError(409, 'too_many_teams');

    const base = slugify(d.name);
    let candidate = RESERVED_SLUGS.includes(base) ? `${base}-team` : base;
    for (let i = 2; (await db.query('SELECT 1 FROM teams WHERE slug = $1', [candidate])).rowCount; i++) candidate = `${base}-${i}`;

    let team;
    try {
      team = (await db.query(
        'INSERT INTO teams (slug, name, description, captain_id, invite_token) VALUES ($1, $2, $3, $4, $5) RETURNING id, slug',
        [candidate, d.name, d.description, u.id, randomToken()],
      )).rows[0];
    } catch (e) {
      if (e.code === '23505' && /name/.test(e.constraint || '')) throw new HttpError(409, 'name_taken', 'name');
      throw e;
    }
    await db.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'main')`, [team.id, u.id]);
    return team.slug;
  });
  res.status(201).json({ slug });
}

export async function get(req, res) {
  const team = await findTeam(req.params.slug);
  res.json(await teamPayload(team, req.user));
}

export async function update(req, res) {
  const d = parse(schemas.update, req.body);
  await withTx(async (db) => {
    const team = await lockCaptainTeam(db, req);
    try {
      await db.query('UPDATE teams SET name = $2, description = $3 WHERE id = $1',
        [team.id, d.name ?? team.name, d.description ?? team.description]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'name_taken', 'name');
      throw e;
    }
  });
  res.json({ ok: true });
}

export async function remove(req, res) {
  const team = await withTx(async (db) => {
    const t = await lockCaptainTeam(db, req);
    const regs = await activeRegistrations(db, t.id);
    if (regs.length) throw new HttpError(409, 'team_registered', undefined, regs.map((r) => r.name));
    await db.query('DELETE FROM teams WHERE id = $1', [t.id]);
    return t;
  });
  await dropLogo(team.logo);
  res.json({ ok: true });
}

// ---------- Логотип ----------
export async function setLogo(req, res) {
  const team = await findTeam(req.params.slug);
  if (team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');
  const buf = req.body;
  const ext = Buffer.isBuffer(buf) ? sniffImage(buf) : null;
  if (!ext) throw new HttpError(415, 'bad_image');

  const name = `${randomToken().slice(0, 24)}.${ext}`;   // случайное имя: старые копии в кэше браузера не мешают
  await fs.mkdir(path.dirname(logoFile(name)), { recursive: true });
  await fs.writeFile(logoFile(name), buf);
  await query('UPDATE teams SET logo = $2 WHERE id = $1', [team.id, name]);
  await dropLogo(team.logo);
  res.json({ logo: name });
}

export async function removeLogo(req, res) {
  const team = await findTeam(req.params.slug);
  if (team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');
  await query('UPDATE teams SET logo = NULL WHERE id = $1', [team.id]);
  await dropLogo(team.logo);
  res.json({ ok: true });
}

// ---------- Приглашения (со стороны капитана) ----------
export async function inviteByNick(req, res) {
  const d = parse(schemas.invite, req.body);
  await withTx(async (db) => {
    const team = await lockCaptainTeam(db, req);
    const target = (await db.query('SELECT id FROM users WHERE nick = $1 AND NOT blocked', [d.nick])).rows[0];
    if (!target) throw new HttpError(404, 'user_not_found', 'nick');
    const members = await memberRows(db, team.id);
    if (members.some((m) => m.user_id === target.id)) throw new HttpError(409, 'already_member', 'nick');
    if (members.length >= MAX_TOTAL) throw new HttpError(409, 'team_full');
    const pending = (await db.query(`SELECT count(*)::int AS n FROM team_invites WHERE team_id = $1 AND status = 'pending'`, [team.id])).rows[0].n;
    if (pending >= maxPendingInvites) throw new HttpError(409, 'too_many_invites');
    try {
      await db.query('INSERT INTO team_invites (team_id, invitee_id, invited_by) VALUES ($1, $2, $3)', [team.id, target.id, req.user.id]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'already_invited', 'nick');
      throw e;
    }
  });
  res.status(201).json({ ok: true });
}

export async function revokeInvite(req, res) {
  const team = await findTeam(req.params.slug);
  if (team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');
  const id = uuid.safeParse(req.params.inviteId);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { rowCount } = await query(
    `UPDATE team_invites SET status = 'revoked', responded_at = now() WHERE id = $1 AND team_id = $2 AND status = 'pending'`,
    [id.data, team.id],
  );
  if (!rowCount) throw new HttpError(404, 'not_found');
  res.json({ ok: true });
}

export async function resetInviteLink(req, res) {
  const team = await findTeam(req.params.slug);
  if (team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');
  const token = randomToken();
  await query('UPDATE teams SET invite_token = $2 WHERE id = $1', [team.id, token]);
  res.json({ inviteToken: token });
}

// ---------- Состав ----------
export async function setMemberRole(req, res) {
  const d = parse(schemas.role, req.body);
  const userId = paramUserId(req);
  await withTx(async (db) => {
    const team = await lockCaptainTeam(db, req);
    const members = await memberRows(db, team.id);
    const target = members.find((m) => m.user_id === userId);
    if (!target) throw new HttpError(404, 'not_found');
    if (target.role !== d.role) {
      const inRole = members.filter((m) => m.role === d.role).length;
      if (inRole >= (d.role === 'main' ? maxMain : maxSub)) throw new HttpError(409, d.role === 'main' ? 'main_full' : 'sub_full');
      await db.query('UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2', [team.id, userId, d.role]);
    }
  });
  res.json({ ok: true });
}

/** Капитан исключает игрока или игрок уходит сам. Капитан уйти не может: сначала передаёт капитанство или удаляет команду. */
export async function removeMember(req, res) {
  const userId = paramUserId(req);
  await withTx(async (db) => {
    const team = await findTeam(req.params.slug, db, true);
    const isSelf = userId === req.user.id;
    if (!isSelf && team.captain_id !== req.user.id) throw new HttpError(403, 'forbidden');
    if (userId === team.captain_id) throw new HttpError(409, 'captain_cannot_leave');
    // Игрок, заявленный на турнир, не может уйти и его нельзя исключить: сначала капитан меняет состав заявки на странице турнира
    const regs = (await activeRegistrations(db, team.id)).filter((r) => r.roster_ids.includes(userId));
    if (regs.length) throw new HttpError(409, 'roster_locked', undefined, regs.map((r) => r.name));
    const { rowCount } = await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, userId]);
    if (!rowCount) throw new HttpError(404, 'not_found');
  });
  res.json({ ok: true });
}

export async function transferCaptain(req, res) {
  const d = parse(schemas.captain, req.body);
  await withTx(async (db) => {
    const team = await lockCaptainTeam(db, req);
    if (d.userId === req.user.id) throw new HttpError(409, 'already_captain');
    const members = await memberRows(db, team.id);
    if (!members.some((m) => m.user_id === d.userId)) throw new HttpError(404, 'not_found');
    await db.query('UPDATE teams SET captain_id = $2 WHERE id = $1', [team.id, d.userId]);
  });
  res.json({ ok: true });
}

// ---------- Приглашённый: страница «Вас пригласили» ----------
/** Находит приглашение по ссылке (token) или персональное (id). Возвращает команду и того, кто пригласил. */
async function resolveInvite(db, user, pick, lock = false) {
  const suffix = lock ? ' FOR UPDATE OF t' : '';
  if (pick.token) {
    const { rows } = await db.query(
      `SELECT t.*, uc.nick AS by_nick FROM teams t LEFT JOIN users uc ON uc.id = t.captain_id WHERE t.invite_token = $1${suffix}`, [pick.token]);
    if (!rows[0]) throw new HttpError(404, 'invite_invalid');
    return { team: rows[0], by: rows[0].by_nick, inviteId: null };
  }
  const { rows } = await db.query(
    `SELECT t.*, ub.nick AS by_nick, i.id AS invite_id
       FROM team_invites i JOIN teams t ON t.id = i.team_id LEFT JOIN users ub ON ub.id = i.invited_by
      WHERE i.id = $1 AND i.invitee_id = $2 AND i.status = 'pending'${suffix}`,
    [pick.id, user.id]);
  if (!rows[0]) throw new HttpError(404, 'invite_invalid');
  return { team: rows[0], by: rows[0].by_nick, inviteId: rows[0].invite_id };
}

export async function previewInvite(req, res) {
  const pick = parse(schemas.invitePick, { token: req.query.token, id: req.query.id });
  const { team, by } = await resolveInvite({ query }, req.user, pick);
  const members = await memberRows({ query }, team.id);
  const state = members.some((m) => m.user_id === req.user.id) ? 'already_member' : members.length >= MAX_TOTAL ? 'full' : 'ok';
  res.json({
    state, invitedBy: by,
    team: { slug: team.slug, name: team.name, description: team.description, logo: team.logo },
    members: members.length, limit: MAX_TOTAL,
  });
}

export async function acceptInvite(req, res) {
  const pick = parse(schemas.invitePick, req.body);
  const slug = await withTx(async (db) => {
    const { team } = await resolveInvite(db, req.user, pick, true);
    await join(db, team.id, req.user.id);
    return team.slug;
  });
  res.json({ slug });
}

export async function declineInvite(req, res) {
  const d = parse(schemas.decline, req.body);
  const { rowCount } = await query(
    `UPDATE team_invites SET status = 'declined', responded_at = now() WHERE id = $1 AND invitee_id = $2 AND status = 'pending'`,
    [d.id, req.user.id],
  );
  if (!rowCount) throw new HttpError(404, 'invite_invalid');
  res.json({ ok: true });
}
