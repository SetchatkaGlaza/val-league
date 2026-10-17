import { buildTeamHistory } from './team-history.js';

// Чистая логика публичного профиля игрока (без БД, проверяется server/test/player-profile.test.js).

/**
 * Профиль игрока по его участию в турнирах.
 *   nick        — ник игрока (как в аккаунте)
 *   regs        — подтверждённые (оплаченные) заявки, в составе которых есть этот ник:
 *                 { id, tournament_id, team_name, team_slug, roster: [{ nick }] }
 *   tournaments / matchesByT — как в buildTeamHistory
 * Публикуем только завершённые турниры: составы идущих и будущих турниров не раскрываем (как и в истории команды).
 * Результат игрока в турнире — результат его команды; счёт матчей — счёт команды в сетке.
 * Возвращает { nick, stats, history }, история — от новых турниров к старым.
 */
export function buildPlayerProfile({ nick, regs, tournaments, matchesByT }) {
  const history = [];
  for (const reg of regs) {
    const t = tournaments.get(reg.tournament_id);
    if (!t || t.status !== 'finished') continue;
    // Каждую заявку разбираем отдельно, чтобы не потерять связь результата с командой
    const [h] = buildTeamHistory({ regs: [reg], tournaments, matchesByT }).history;
    if (!h) continue;
    const { roster, ...rest } = h;
    history.push({ ...rest, team: { name: reg.team_name, slug: reg.team_slug || null }, roster });
  }
  history.sort((a, b) => new Date(b.tournament.startsAt) - new Date(a.tournament.startsAt));

  const places = history.map((h) => h.place).filter(Boolean);
  const stats = {
    tournaments: history.length,
    titles: history.filter((h) => h.place === 1).length,
    podiums: places.length,
    bestPlace: places.length ? Math.min(...places) : null,
    matchWins: history.reduce((s, h) => s + (h.record?.wins ?? 0), 0),
    matchLosses: history.reduce((s, h) => s + (h.record?.losses ?? 0), 0),
  };
  return { nick, stats, history };
}
