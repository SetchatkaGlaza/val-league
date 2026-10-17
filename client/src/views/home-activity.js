import { logoUrl } from '../js/api.js';
import { esc } from './parts.js';

const when = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const ago = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(iso));

/**
 * Из публичной сетки выбираем то, что интересно на главной: идущие, ближайшие и сыгранные матчи.
 * Ничего не придумываем: берём только матчи, у которых известны обе команды.
 */
export function pickMatches(data, { upcoming = true } = {}) {
  const all = (data?.rounds || []).flatMap((r) => r.matches.map((m) => ({ ...m, roundName: r.name, t: data.tournament })));
  const real = all.filter((m) => !m.bye && m.a && m.b);
  const liveM = real.filter((m) => m.status === 'live');
  const next = upcoming ? real.filter((m) => m.status !== 'live' && m.status !== 'finished' && m.startsAt).sort((x, y) => new Date(x.startsAt) - new Date(y.startsAt)) : [];
  const done = real.filter((m) => m.status === 'finished').sort((x, y) => new Date(y.finishedAt || 0) - new Date(x.finishedAt || 0));
  return { live: liveM, next, done };
}

const logo = (s) => (s?.logo
  ? `<img src="${esc(logoUrl(s.logo))}" alt="" width="40" height="40" loading="lazy" decoding="async" />`
  : `<span class="ac-ini" aria-hidden="true">${esc((s?.name || '?').trim().charAt(0).toUpperCase())}</span>`);

const forfeit = (m) => (m.forfeit ? (m.forfeitReason === 'noshow' ? 'Неявка' : 'Тех. поражение') : '');

function teamRow(m, s, big) {
  const t = m[s], score = s === 'a' ? m.scoreA : m.scoreB;
  const state = m.winner === s ? ' is-win' : m.winner ? ' is-lose' : '';
  return `<div class="ac-t${state}">${big ? logo(t) : ''}<span class="ac-n">${esc(t.name)}</span><b class="ac-s">${m.status === 'finished' || m.status === 'live' ? score ?? '' : ''}</b></div>`;
}

function foot(m) {
  if (m.status === 'live') return '<span class="st st-live">Идёт сейчас</span>';
  if (m.status === 'finished') return `<span class="ac-meta">${[forfeit(m), m.finishedAt ? ago(m.finishedAt) : ''].filter(Boolean).join(' · ')}</span>`;
  return `<span class="ac-meta">${m.startsAt ? when(m.startsAt) : 'Время уточняется'}</span>`;
}

/** Карточка матча. big = главный матч с логотипами команд. */
function card(m, big = false) {
  const label = `Матч: ${m.a.name} — ${m.b.name}`;
  return `<a class="ac-m${big ? ' big' : ''}${m.status === 'live' ? ' is-live' : ''}" href="/matches/${esc(m.id)}" aria-label="${esc(label)}">
    <p class="ac-top"><span>${esc(m.t.name)} · ${esc(m.roundName)}</span>${foot(m)}</p>
    ${teamRow(m, 'a', big)}${teamRow(m, 'b', big)}
  </a>`;
}

const group = (title, list) => (list.length ? `<div class="ac-group"><h3>${title}</h3><div class="ac-list">${list.map((m) => card(m)).join('')}</div></div>` : '');

export function emptyActivity() {
  return `<div class="ac-empty"><h3>Матчей пока нет</h3><p>Как только начнётся турнир, здесь появятся идущие матчи, расписание и последние результаты.</p><a class="btn btn-ghost" href="/tournaments">Смотреть турниры</a></div>`;
}

/** sets: массив { live, next, done } из одного или двух турниров (идущий и последний завершённый). */
export function activityHtml(sets) {
  const live = sets.flatMap((s) => s.live), next = sets.flatMap((s) => s.next).sort((x, y) => new Date(x.startsAt) - new Date(y.startsAt));
  const done = sets.flatMap((s) => s.done).sort((x, y) => new Date(y.finishedAt || 0) - new Date(x.finishedAt || 0));
  const queue = [...live, ...next];
  const featured = queue[0] || done[0];
  if (!featured) return emptyActivity();
  const rest = featured === queue[0] ? queue.slice(1, 4) : [];
  const results = (featured === done[0] ? done.slice(1) : done).slice(0, 4);
  const title = featured.status === 'live' ? 'Идёт сейчас' : featured.status === 'finished' ? 'Последний результат' : 'Ближайший матч';
  return `<div class="ac-grid">
    <div class="ac-main"><h3>${title}</h3>${card(featured, true)}</div>
    <div class="ac-side">${group(live.length > 1 || next.length ? 'Далее в расписании' : '', rest)}${group('Последние результаты', results)}</div>
  </div>`;
}
