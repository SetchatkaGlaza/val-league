import { esc } from './parts.js';
import { logoUrl } from '../js/api.js';
import { playerLink } from './player-link.js';
import { plural } from './team-parts.js';
import { ratingRow } from './rating.js';
import { rub, dateShort } from './tournament-parts.js';

const ICON = {
  cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 13v4M9 20h6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>',
};

/** Герб команды: загруженный логотип или первая буква названия. Только данные из API. */
const crest = (name, logo) => (logo
  ? `<img class="ch-logo" src="${esc(logoUrl(logo))}" alt="" width="88" height="88" loading="lazy" decoding="async" />`
  : `<span class="ch-logo ph" aria-hidden="true">${esc([...String(name || '?')][0].toUpperCase())}</span>`);

const teamName = (name, slug) => (slug ? `<a class="plain" href="/teams/${esc(slug)}">${esc(name)}</a>` : esc(name));

/** Крупный блок последнего победителя. */
const featured = (w) => {
  const f = w.podium?.first;
  const second = w.podium?.second;
  const thirds = w.podium?.thirds || [];
  return `
  <article class="champ">
    <img class="champ-bg" src="/media/champion-atmosphere.webp" srcset="/media/champion-atmosphere-sm.webp 800w, /media/champion-atmosphere.webp 1600w" sizes="(max-width: 1120px) 100vw, 1120px" width="1600" height="900" alt="" aria-hidden="true" loading="lazy" decoding="async" />
    <div class="champ-body">
      <p class="label">Чемпион · ${esc(dateShort(w.date))}</p>
      <div class="champ-head">${crest(w.team, f?.logo)}<h3>${teamName(w.team, f?.slug)}</h3></div>
      <div class="champ-t"><span class="champ-k">${ICON.cup}Победитель турнира</span><a class="champ-tn" href="/tournaments/${esc(w.slug)}" title="Страница турнира">${esc(w.tournament)}${ICON.arrow}</a></div>
      ${w.roster?.length ? `<p class="champ-roster">${w.roster.map(playerLink).join(' · ')}</p>` : ''}
      <div class="champ-meta">
        ${w.prize ? `<div><span>Приз за 1 место</span><b>${rub(w.prize)}</b></div>` : ''}
        ${w.prizeTotal ? `<div><span>Призовой фонд</span><b>${rub(w.prizeTotal)}</b></div>` : ''}
        ${w.teamsCount ? `<div><span>Команд</span><b>${w.teamsCount}</b></div>` : ''}
      </div>
      ${second || thirds.length ? `<ul class="champ-places" aria-label="Призовые места">
        ${second ? `<li><b>2</b><span>${esc(second.name)}</span></li>` : ''}
        ${thirds.length ? `<li><b>3</b><span>${thirds.map((x) => esc(x.name)).join(', ')}</span></li>` : ''}
      </ul>` : ''}
    </div>
  </article>`;
};

/** Компактная карточка предыдущего победителя. */
const compact = (w, i) => {
  const second = w.podium?.second;
  return `
  <article class="win win-sm">
    <span class="win-no" aria-hidden="true">${String(i + 2).padStart(2, '0')}</span>
    <div class="win-top">${crest(w.team, w.podium?.first?.logo)}<div class="win-id"><span class="win-k">${ICON.cup}Победитель</span><h3>${teamName(w.team, w.podium?.first?.slug)}</h3></div></div>
    <a class="win-tn" href="/tournaments/${esc(w.slug)}">${esc(w.tournament)}${ICON.arrow}</a>
    ${second ? `<p class="win-sub"><b>2</b>${esc(second.name)}</p>` : ''}
    <div class="win-foot">
      <span class="win-date">${esc(dateShort(w.date))}</span>
      ${w.prize ? `<span class="win-prize"><small>Приз</small><b>${rub(w.prize)}</b></span>` : ''}
    </div>
  </article>`;
};

/** Секция победителей: первый в списке (последний по дате) выделен, остальные компактно. */
export const winnersHtml = (list) => {
  const [first, ...rest] = list;
  return `${featured(first)}${rest.length ? `<div class="win-grid win-grid-sm">${rest.map(compact).join('')}</div>` : ''}`;
};

/** Карточка топ-3 рейтинга. Аватаров в данных нет, поэтому показываем место и ник. */
const podiumCard = (p) => `
  <li class="rtp rtp-${p.rank}">
    <span class="rtp-rank" aria-label="Место ${p.rank}">${p.rank}</span>
    <b class="rtp-nick">${playerLink(p.nick)}</b>
    <b class="rtp-pts" title="Очки рейтинга">${p.points}<small>очков</small></b>
    <small class="rtp-sub">${p.tournaments} ${plural(p.tournaments, 'турнир', 'турнира', 'турниров')}${p.titles ? ` · ${p.titles} ${plural(p.titles, 'победа', 'победы', 'побед')}` : ''}${p.matchWins + p.matchLosses ? ` · матчи ${p.matchWins}–${p.matchLosses}` : ''}</small>
  </li>`;

/** Рейтинг: места 1–3 выразительно, остальные списком (строки те же, что на странице /rating). */
export const ratingHtml = (list) => {
  const top = list.slice(0, 3), rest = list.slice(3);
  return `<ol class="rt-podium" aria-label="Лидеры рейтинга">${top.map(podiumCard).join('')}</ol>${rest.length ? `<ol class="rt-list rt-rest" start="4">${rest.map(ratingRow).join('')}</ol>` : ''}`;
};
