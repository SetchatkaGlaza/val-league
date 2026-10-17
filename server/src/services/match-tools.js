// Заметки, история и откат результата матча. Чистая логика без БД (тесты: test/match-tools.test.js).

/**
 * Можно ли откатить результат матча. Возвращает null (можно) или код ошибки.
 * match — строка matches, next — следующий матч (или null для финала), tournamentStatus — статус турнира.
 */
export function rollbackBlocker({ tournamentStatus, match, next }) {
  if (!['live', 'finished'].includes(tournamentStatus)) return 'bad_state';
  if (match.bye) return 'bye_match';
  if (match.status !== 'finished' || !match.winner) return 'not_finished';
  // Победитель уже вышел в следующий матч: пока тот не начался, его можно убрать оттуда
  if (next && ['live', 'finished'].includes(next.status)) return 'next_match_played';
  return null;
}

/** Состояние следующего матча после того, как из него убрали участника слота. Участник остаётся один — матч ждёт соперника. */
export const nextAfterRollback = () => ({ status: 'pending' });

/** Запись журнала для показа в истории матча: без IP и лишних полей. */
export function historyItem(e) {
  return {
    id: String(e.id), at: e.created_at, actor: { nick: e.actor_nick, role: e.actor_role }, action: e.action,
    before: e.before ?? null, after: e.after ?? null, reason: e.meta?.reason ?? null,
  };
}

export const NOTE_MAX = 1000;
/** Заметка для клиента. */
export function noteItem(n) {
  return { id: String(n.id), matchId: n.match_id ?? null, matchLabel: n.match_label ?? null, body: n.body, at: n.created_at, author: { nick: n.author_nick, role: n.author_role } };
}
