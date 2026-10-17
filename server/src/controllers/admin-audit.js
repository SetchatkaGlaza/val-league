import { z } from 'zod';
import { HttpError, parse } from '../utils/http.js';
import { ACTIONS, OBJECT_TYPES, listAudit } from '../services/audit.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const schema = z.object({
  actor: z.string().trim().max(40).optional(),
  action: z.string().refine((a) => ACTIONS.includes(a) || (a.endsWith('.') && ACTIONS.some((x) => x.startsWith(a)))).optional(),
  objectType: z.enum(OBJECT_TYPES).optional(),
  objectId: z.string().trim().max(64).optional(),
  from: day.optional(),
  to: day.optional(),
  before: z.string().regex(/^\d{1,18}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Дата-фильтры приходят как «день» по времени Москвы (UTC+3): «по» включает весь день. */
const dayStart = (s) => new Date(`${s}T00:00:00+03:00`);

/** Журнал действий с фильтрами и подгрузкой (курсор — id последней записи). Только для админов. */
export async function list(req, res) {
  const q = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string' && v !== ''));
  const d = parse(schema, q);
  if (d.from && d.to && d.from > d.to) throw new HttpError(400, 'validation', 'from');
  const filter = {
    actor: d.actor, action: d.action, objectType: d.objectType, objectId: d.objectId, before: d.before,
    from: d.from ? dayStart(d.from) : undefined,
    to: d.to ? new Date(dayStart(d.to).getTime() + 86_400_000) : undefined,
  };
  const { entries, nextCursor } = await listAudit(filter, d.limit ?? 30);
  res.json({
    entries: entries.map((e) => ({
      id: String(e.id), at: e.created_at, actor: { id: e.actor_id, nick: e.actor_nick, role: e.actor_role },
      action: e.action, objectType: e.object_type, objectId: e.object_id, label: e.object_label,
      before: e.before, after: e.after, meta: e.meta, ip: e.ip,
    })),
    nextCursor,
  });
}
