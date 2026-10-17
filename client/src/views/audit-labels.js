// Подписи действий журнала. Список действий — server/src/services/audit.js (ACTIONS).
export const ACTION_LABEL = {
  'tournament.create': 'Создан турнир',
  'tournament.update': 'Изменён турнир',
  'tournament.status': 'Изменён статус турнира',
  'tournament.delete': 'Удалён турнир',
  'tournament.duplicate': 'Турнир продублирован',
  'tournament.cancel': 'Отменён турнир',
  'tournament.export': 'Выгрузка в CSV',
  'registration.confirm': 'Подтверждена оплата заявки',
  'registration.cancel': 'Снята заявка',
  'registration.refunded': 'Отмечен возврат взноса',
  'registration.bulk_refunded': 'Массово отмечены возвраты взносов',
  'bracket.generate': 'Сформирована сетка',
  'bracket.remove': 'Удалена сетка',
  'bracket.schedule': 'Назначено время матчей',
  'match.update': 'Изменён матч (время, лобби, статус)',
  'match.result': 'Введён результат матча',
  'match.rollback': 'Откат результата матча',
  'note.create': 'Добавлена заметка',
  'note.delete': 'Удалена заметка',
  'user.block': 'Заблокирован пользователь',
  'user.unblock': 'Снята блокировка',
  'user.role': 'Изменена роль пользователя',
  'user.verify_email': 'Подтверждена почта пользователя',
  'user.reset_steam': 'Сброшена привязка Steam',
  'user.reset_telegram': 'Сброшена привязка Telegram',
  'user.nick': 'Принудительно изменён ник',
  'team.logo_remove': 'Снят логотип команды',
  'team.description_clear': 'Очищено описание команды',
  'team.rename': 'Переименована команда',
  'team.disband': 'Расформирована команда',
  'settings.update': 'Изменены настройки сайта',
  'settings.rating_recalc': 'Пересчитан рейтинг игроков',
};
export const GROUP_LABEL = { 'tournament.': 'Турниры', 'registration.': 'Заявки', 'bracket.': 'Сетка', 'match.': 'Матчи', 'note.': 'Заметки', 'user.': 'Пользователи', 'team.': 'Команды', 'settings.': 'Настройки' };
export const OBJECT_LABEL = { tournament: 'Турнир', registration: 'Заявка', match: 'Матч', user: 'Пользователь', team: 'Команда', setting: 'Настройка' };
export const actionLabel = (a) => ACTION_LABEL[a] ?? a;

// Названия полей в блоке «было → стало»
export const FIELD_LABEL = {
  name: 'Название', description: 'Описание', startsAt: 'Время', teamSize: 'Состав', matchFormat: 'Формат матча', fee: 'Взнос', maxTeams: 'Мест',
  mapPool: 'Карты', prizePlaces: 'Призы', registrationOpen: 'Регистрация открыта', status: 'Статус', winner: 'Победитель', cancelReason: 'Причина снятия',
  refundDue: 'Нужен возврат', note: 'Заметка', scoreA: 'Счёт A', scoreB: 'Счёт B', forfeit: 'Тех. поражение', forfeitReason: 'Причина', maps: 'Карты и счёт',
  demoUrl: 'Демо', lobby: 'Лобби',
  nick: 'Ник', role: 'Роль', blocked: 'Заблокирован', blockedUntil: 'Блокировка до', reason: 'Причина', emailVerified: 'Почта подтверждена',
  steam: 'Steam', telegram: 'Telegram', registrations: 'Заявок обновлено', winnerLists: 'Составов победителей обновлено',
  paid: 'Оплаченных заявок', refundTotal: 'К возврату, ₽', kind: 'Что выгружено', sourceName: 'Исходный турнир', sourceId: 'Исходный турнир (id)',
  cancelled: 'Заявок снято', rows: 'Заявок в файле', count: 'Заявок', total: 'Сумма, ₽', ids: 'Заявки (id)',
  contactEmail: 'Контактная почта', socialTelegram: 'Telegram', socialVk: 'ВКонтакте', socialDiscord: 'Discord', socialYoutube: 'YouTube',
  bannerEnabled: 'Баннер включён', bannerText: 'Текст баннера', bannerUntil: 'Баннер до',
  ratingParticipation: 'Очки за участие', ratingPlace1: 'Очки за 1 место', ratingPlace2: 'Очки за 2 место', ratingPlace3: 'Очки за 3 место', ratingMatchWin: 'Очки за победу в матче',
  players: 'Игроков в рейтинге', participation: 'За участие', place1: 'За 1 место', place2: 'За 2 место', place3: 'За 3 место', matchWin: 'За победу в матче',
  logo: 'Логотип', file: 'Файл', matches: 'Матчей обновлено', winners: 'Турниров с победителем обновлено', members: 'Состав', slug: 'Адрес',
};
const VALUE = {
  status: { draft: 'черновик', upcoming: 'анонс', live: 'идёт', finished: 'завершён', cancelled: 'отменён', pending_payment: 'ждёт оплаты', paid: 'оплачена', waitlist: 'лист ожидания', pending: 'ждёт', ready: 'готов' },
  kind: { registrations: 'заявки', participants: 'участники' },
  winner: { a: 'команда A', b: 'команда B' },
  role: { player: 'игрок', moderator: 'модератор', admin: 'администратор' },
};
export function fmtValue(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (typeof v === 'string' && VALUE[key]?.[v]) return VALUE[key][v];
  if (key === 'startsAt' && typeof v === 'string') { const d = new Date(v); if (!Number.isNaN(d.getTime())) return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
  if (key === 'prizePlaces' && Array.isArray(v)) return v.map((p) => `${p.place}: ${p.amount} ₽`).join(', ') || '—';
  if (key === 'maps' && Array.isArray(v)) return v.map((m) => `${m.map || 'карта'} ${m.a}:${m.b}`).join(', ');
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
