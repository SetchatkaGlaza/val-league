import { esc } from './parts.js';
import { rub } from './tournament-parts.js';
import { playerLink } from './player-link.js';

const nameLink = (t) => (t.slug ? `<a class="plain" href="/teams/${esc(t.slug)}">${esc(t.name)}</a>` : esc(t.name));
const rosterLine = (t) => (t.roster?.length ? `<p class="pd-roster">${t.roster.map(playerLink).join(' · ')}</p>` : '');

/**
 * Призёры турнира: 1 место, 2 место и 3 место (его делят два проигравших полуфиналиста: матча за 3 место в сетке нет).
 * p — tournament.podium из API, prizePlaces — призовые по местам (необязательно).
 */
export function podiumBlock(p, prizePlaces = []) {
  if (!p || !p.first) return '';
  const prize = (i) => (prizePlaces[i] && prizePlaces[i].amount ? `<span class="pd-prize">Приз ${rub(prizePlaces[i].amount)}</span>` : '');
  const item = (n, label, teams, cls, prizeIdx) => `
    <li class="pd pd-${cls}">
      <span class="pd-n" aria-hidden="true">${n}</span>
      <div class="pd-b"><p class="pd-l">${label}</p>
        ${teams.map((t) => `<div class="pd-team"><b class="pd-t">${nameLink(t)}</b>${rosterLine(t)}</div>`).join('')}
        ${prizeIdx === null ? '' : prize(prizeIdx)}</div>
    </li>`;
  return `<ol class="podium" aria-label="Призёры турнира">
    ${item(1, '1 место', [p.first], 'first', 0)}
    ${p.second ? item(2, '2 место', [p.second], 'second', 1) : ''}
    ${p.thirds?.length ? item(3, '3 место', p.thirds, 'third', p.thirds.length === 1 ? 2 : null) : ''}
  </ol>`;
}
