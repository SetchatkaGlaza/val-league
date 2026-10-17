import { teams } from '../js/api.js';
import { esc } from './parts.js';
import { dateShort } from './tournament-parts.js';
import { plural } from './team-parts.js';
import { playerLink } from './player-link.js';

export { playerLink };

/** Загружает историю команды; ошибка не ломает страницу: блок покажет сообщение. */
export const loadHistory = (slug) => teams.history(slug).then((d) => ({ state: 'ok', ...d }), () => ({ state: 'error' }));


const PLACE = { 1: '1 место', 2: '2 место', 3: '3 место' };

/** Итог команды в турнире одной короткой подписью: [текст, класс]. */
export function outcome(h) {
  if (h.place) return [PLACE[h.place], `p${h.place}`];
  if (h.inGame) return ['В игре', 'live'];
  if (h.stage) return [`Вылет: ${h.stage}`, 'out'];
  if (h.tournament.status === 'upcoming') return ['Заявка подтверждена', 'soon'];
  if (h.tournament.status === 'live') return ['Идёт турнир', 'live'];
  return ['Участие', 'out'];
}

const row = (h) => {
  const t = h.tournament, [text, cls] = outcome(h);
  const format = `${t.teamSize}×${t.teamSize} · ${String(t.matchFormat).toUpperCase()}`;
  const rec = h.record ? `<span class="th-rec" title="Победы и поражения в сетке">${h.record.wins}–${h.record.losses}</span>` : '';
  return `
  <li class="th-row">
    <a class="th-t" href="/tournaments/${esc(t.slug)}"><b>${esc(t.name)}</b><span>${dateShort(t.startsAt)} · ${format}</span></a>
    <span class="th-res th-${cls}">${esc(text)}</span>
    ${h.roster.length ? `<p class="th-roster">${h.roster.map(playerLink).join(' · ')}</p>` : ''}
    <span class="th-x">${rec}${h.hasBracket ? `<a class="plain" href="/tournaments/${esc(t.slug)}/bracket">Сетка</a>` : ''}</span>
  </li>`;
};

/** Блок «История и результаты» для страницы команды. hist — { state: 'loading' | 'error' | 'ok', stats, history }. */
export function historyHtml(hist) {
  const wrap = (inner, busy = false) => `<section class="acc-card tm-wide" id="tmHistory"${busy ? ' aria-busy="true"' : ''}><h2>История и результаты</h2>${inner}</section>`;
  if (!hist || hist.state === 'loading') return wrap('<p class="th-note">Загружаем историю…</p>', true);
  if (hist.state === 'error') return wrap('<p class="th-note">Не удалось загрузить историю. Обновите страницу.</p>');
  if (!hist.history.length) {
    return wrap('<div class="acc-empty"><p>Команда пока не участвовала в турнирах.</p><span>Здесь появятся места и результаты по каждому турниру.</span></div>');
  }
  const s = hist.stats;
  const chips = [
    `${s.tournaments} ${plural(s.tournaments, 'турнир', 'турнира', 'турниров')}`,
    s.titles ? `${s.titles} ${plural(s.titles, 'победа', 'победы', 'побед')} в турнирах` : '',
    s.podiums ? `${s.podiums} ${plural(s.podiums, 'призовое место', 'призовых места', 'призовых мест')}` : '',
    s.matchWins + s.matchLosses ? `Матчи: ${s.matchWins}–${s.matchLosses}` : '',
  ].filter(Boolean);
  return wrap(`${chips.length ? `<ul class="chips th-chips">${chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <ul class="th-list">${hist.history.map(row).join('')}</ul>`);
}
