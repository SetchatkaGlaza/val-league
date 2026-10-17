// Роли и разделы админки. Чистая логика без БД; проверка на сервере — middleware requireRole (middleware/auth.js).
// «player» в базе — это роль «user» из ТЗ: так названа колонка с самого начала, переименовывать не стали.

export const ROLES = ['player', 'moderator', 'admin'];
export const ROLE_LABEL = { player: 'Игрок', moderator: 'Модератор', admin: 'Администратор' };

/** Сотрудники: видят админку. */
export const STAFF = ['moderator', 'admin'];
export const isStaff = (role) => STAFF.includes(role);
export const hasRole = (role, ...allowed) => allowed.includes(role);

/** Разделы админки по ролям. Клиент прячет недоступные, сервер всё равно проверяет каждый маршрут. */
const SECTIONS = {
  moderator: ['dashboard', 'tournaments', 'teams'],
  admin: ['dashboard', 'tournaments', 'teams', 'users', 'audit', 'settings'],
};
export const sectionsFor = (role) => SECTIONS[role] ?? [];
