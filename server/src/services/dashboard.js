// Что требует внимания организаторов: чистая сборка списка из строк, которые отдаёт БД (controllers/admin.js).

export const plural = (n, [one, few, many]) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};

const href = (id) => `/admin/tournaments/${id}`;

/**
 * raw: { now, expiring: [{ id, tournamentId, tournamentName, teamName, payUntil }], noTime: [{ id, name, n }],
 *        noBracket: [{ id, name, startsAt, paid }], overdue: [{ id, name, n }], refunds: число }
 * Порядок: сначала то, что горит.
 */
export function attentionItems(raw) {
  const now = new Date(raw.now ?? Date.now()).getTime();
  const out = [];
  for (const e of raw.expiring ?? []) {
    const left = new Date(e.payUntil).getTime() - now;
    out.push({
      kind: 'payment_expiring', level: left < 2 * 3_600_000 ? 'danger' : 'warn', href: href(e.tournamentId),
      text: `Оплата «${e.teamName}» (${e.tournamentName}) ${left <= 0 ? 'просрочена' : 'истекает скоро'}`, at: e.payUntil,
    });
  }
  for (const o of raw.overdue ?? []) {
    out.push({ kind: 'matches_overdue', level: 'danger', href: href(o.id), text: `${o.name}: ${o.n} ${plural(o.n, ['матч не завершён', 'матча не завершены', 'матчей не завершены'])}, время уже прошло` });
  }
  for (const b of raw.noBracket ?? []) {
    const enough = b.paid >= 2;
    out.push({
      kind: 'no_bracket', level: 'warn', href: href(b.id), at: b.startsAt,
      text: enough ? `${b.name}: старт скоро, а сетка не сформирована` : `${b.name}: старт скоро, оплаченных команд ${b.paid} — для сетки нужно минимум две`,
    });
  }
  for (const n of raw.noTime ?? []) {
    out.push({ kind: 'matches_no_time', level: 'info', href: href(n.id), text: `${n.name}: у ${n.n} ${plural(n.n, ['матча', 'матчей', 'матчей'])} не назначено время` });
  }
  if (raw.refunds > 0) out.push({ kind: 'refunds_due', level: 'warn', href: '/admin', text: `Нужно вернуть взносы: ${raw.refunds} ${plural(raw.refunds, ['заявка', 'заявки', 'заявок'])}` });
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
