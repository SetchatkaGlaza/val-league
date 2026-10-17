import login from './views/login.js';
import register from './views/register.js';
import forgot from './views/forgot.js';
import verifyEmail from './views/verify-email.js';
import resetPassword from './views/reset-password.js';
import account from './views/account.js';
import settingsPage from './views/settings.js';
import { rules, privacy } from './views/docs.js';
import home from './views/home.js';
import teamNew from './views/team-new.js';
import team from './views/team.js';
import player from './views/player.js';
import invite from './views/invite.js';
import tournamentsList from './views/tournaments.js';
import tournament from './views/tournament.js';
import bracketPage from './views/bracket.js';
import matchPage from './views/match.js';
import teamsList from './views/teams-list.js';
import winnersPage from './views/winners.js';
import ratingPage from './views/rating.js';
import adminHome from './views/admin.js';
import adminTournament from './views/admin-tournament.js';
import adminAudit from './views/admin-audit.js';
import adminSettings from './views/admin-settings.js';
import adminUsers from './views/admin-users.js';
import adminUser from './views/admin-user.js';
import adminTeams from './views/admin-teams.js';
import adminTeam from './views/admin-team.js';
import { notFound } from './views/stubs.js';

// Новая страница: файл в src/views + строка здесь. Все страницы входят в один бандл,
// поэтому переходы между ними мгновенные — без запросов к серверу.
export const routes = {
  '/': home,
  '/login': login,
  '/register': register,
  '/forgot': forgot,
  '/verify-email': verifyEmail,
  '/reset-password': resetPassword,
  '/account': account,
  '/settings': settingsPage,
  '/rules': rules,
  '/privacy': privacy,
  '/teams': teamsList,
  '/teams/new': teamNew,
  '/tournaments': tournamentsList,
  '/winners': winnersPage,
  '/rating': ratingPage,
  '/admin': adminHome,
  '/admin/users': adminUsers,
  '/admin/teams': adminTeams,
  '/admin/audit': adminAudit,
  '/admin/settings': adminSettings,
  '/admin/tournaments/new': adminTournament,
  '/invite': invite,
};

// Адреса с параметром: [шаблон, имя параметра, страница]. Точные адреса из таблицы выше проверяются первыми.
const dynamic = [
  [/^\/teams\/([a-z0-9-]{1,40})$/, 'slug', team],
  [/^\/players\/([^/]{1,80})$/, 'nick', player],
  [/^\/tournaments\/([a-z0-9-]{1,40})$/, 'slug', tournament],
  [/^\/tournaments\/([a-z0-9-]{1,40})\/bracket$/, 'slug', bracketPage],
  [/^\/matches\/([0-9a-f-]{36})$/i, 'id', matchPage],
  [/^\/admin\/tournaments\/([0-9a-f-]{36})$/i, 'id', adminTournament],
  [/^\/admin\/users\/([0-9a-f-]{36})$/i, 'id', adminUser],
  [/^\/admin\/teams\/([0-9a-f-]{36})$/i, 'id', adminTeam],
];

export function resolve(path) {
  if (routes[path]) return { view: routes[path], params: {} };
  for (const [re, name, view] of dynamic) {
    const m = re.exec(path);
    if (m) return { view, params: { [name]: m[1] } };
  }
  return null;
}
export { notFound };
