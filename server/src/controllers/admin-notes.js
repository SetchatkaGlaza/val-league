import { z } from 'zod';
import { query, withTx } from '../db/index.js';
import { HttpError, parse, uuid } from '../utils/http.js';
import { record, listAudit } from '../services/audit.js';
import { historyItem, noteItem, NOTE_MAX } from '../services/match-tools.js';

const noteSchema = z.object({ body: z.string().trim().min(1).max(NOTE_MAX), matchId: uuid.optional() });
const COLS = 'id, tournament_id, match_id, match_label, body, author_nick, author_role, created_at';

const tournamentId = (raw) => { const id = uuid.safeParse(raw); if (!id.success) throw new HttpError(404, 'not_found'); return id.data; };

/** Заметки турнира и его матчей, новые сверху. Видят модераторы и админы. */
export async function list(req, res) {
  const tid = tournamentId(req.params.id);
  const { rows } = await query(`SELECT ${COLS} FROM admin_notes WHERE tournament_id = $1 ORDER BY id DESC LIMIT 300`, [tid]);
  res.json({ notes: rows.map(noteItem) });
}

/** Добавить заметку к турниру или (с matchId) к матчу этого турнира. */
export async function create(req, res) {
  const tid = tournamentId(req.params.id);
  const d = parse(noteSchema, req.body);
  const note = await withTx(async (db) => {
    const { rows: [t] } = await db.query('SELECT id, name FROM tournaments WHERE id = $1 FOR UPDATE', [tid]);
    if (!t) throw new HttpError(404, 'not_found');
    let label = null;
    if (d.matchId) {
      const { rows: [m] } = await db.query('SELECT id, round, position, name_a, name_b FROM matches WHERE id = $1 AND tournament_id = $2', [d.matchId, t.id]);
      if (!m) throw new HttpError(404, 'not_found');
      label = `${m.name_a ?? '?'} — ${m.name_b ?? '?'}`;
    }
    const { rows: [n] } = await db.query(
      `INSERT INTO admin_notes (tournament_id, match_id, match_label, body, author_id, author_nick, author_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
      [t.id, d.matchId ?? null, label, d.body, req.user.id, req.user.nick, req.user.role]);
    await record(db, req, {
      action: 'note.create', objectType: d.matchId ? 'match' : 'tournament', objectId: d.matchId ?? t.id, label: label ? `${label} (${t.name})` : t.name,
      after: { note: d.body }, meta: { tournamentId: t.id, noteId: n.id },
    });
    return n;
  });
  res.status(201).json({ note: noteItem(note) });
}

/** Удалить заметку (только админ). Текст удалённой заметки остаётся в журнале. */
export async function remove(req, res) {
  const raw = String(req.params.id);
  if (!/^\d{1,18}$/.test(raw)) throw new HttpError(404, 'not_found');
  await withTx(async (db) => {
    const { rows: [n] } = await db.query(`SELECT ${COLS}, (SELECT name FROM tournaments WHERE id = tournament_id) AS t_name FROM admin_notes WHERE id = $1 FOR UPDATE`, [raw]);
    if (!n) throw new HttpError(404, 'not_found');
    await db.query('DELETE FROM admin_notes WHERE id = $1', [n.id]);
    await record(db, req, {
      action: 'note.delete', objectType: n.match_id ? 'match' : 'tournament', objectId: n.match_id ?? n.tournament_id, label: n.match_label ? `${n.match_label} (${n.t_name})` : n.t_name,
      before: { note: n.body }, meta: { tournamentId: n.tournament_id, noteId: n.id, author: n.author_nick },
    });
  });
  res.json({ ok: true });
}

/** История матча из журнала: результаты, правки, откаты. Журнал целиком видит только админ, а эту выжимку по матчу — и модератор. */
export async function matchHistory(req, res) {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'not_found');
  const { entries } = await listAudit({ objectType: 'match', objectId: id.data }, 30);
  res.json({ history: entries.filter((e) => e.action.startsWith('match.')).map(historyItem) });
}
