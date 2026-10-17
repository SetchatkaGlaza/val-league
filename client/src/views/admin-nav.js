import { getUser } from '../js/session.js';
import { esc } from './parts.js';

// Разделы админки и роли. Это только про то, что показывать; права на самом деле проверяет сервер (routes/admin.js).
export const ROLE_LABEL = { player: 'Игрок', moderator: 'Модератор', admin: 'Администратор' };
export const isStaff = (role) => role === 'moderator' || role === 'admin';
export const isAdmin = (role) => role === 'admin';
export const myRole = () => getUser()?.role ?? 'player';

const SECTIONS = [
  { id: 'dashboard', href: '/admin', label: 'Главная', roles: ['moderator', 'admin'] },
  { id: 'teams', href: '/admin/teams', label: 'Команды', roles: ['moderator', 'admin'] },
  { id: 'users', href: '/admin/users', label: 'Пользователи', roles: ['admin'] },
  { id: 'audit', href: '/admin/audit', label: 'Журнал', roles: ['admin'] },
  { id: 'settings', href: '/admin/settings', label: 'Настройки', roles: ['admin'] },
];

/** Полоса разделов над страницей админки. Недоступные роли разделы не видны. */
export function adminNav(active) {
  const role = myRole();
  const items = SECTIONS.filter((s) => s.roles.includes(role));
  return `<nav class="adm-nav" aria-label="Разделы админки">${items.map((s) => `<a href="${s.href}" ${s.id === active ? 'aria-current="page"' : ''}>${esc(s.label)}</a>`).join('')}<span class="adm-role">${esc(ROLE_LABEL[role] ?? role)}</span></nav>`;
}
