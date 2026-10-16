import { $ } from '../js/ui.js';
import { esc } from './parts.js';

// Общее для страницы сетки, страницы матча, админки и кабинета.

export const whenShort = (iso) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Статус матча: [подпись, css-класс .st-…] */
export const MATCH_STATUS = {
  pending: ['Ждёт соперника', 'draft'],
  ready: ['Готов к игре', 'soon'],
  live: ['Идёт', 'live'],
  finished: ['Сыгран', 'done'],
};
export const matchBadge = (m) => {
  const [label, cls] = m.bye ? ['Проход без игры', 'draft'] : MATCH_STATUS[m.status];
  return `<span class="st st-${cls}">${label}</span>`;
};

/** Как закончился матч без игры: «Тех. поражение» / «Неявка» (пусто, если матч сыгран обычным образом). */
export const forfeitLabel = (m) => (m.forfeit ? (m.forfeitReason === 'noshow' ? 'Неявка' : 'Тех. поражение') : '');

/** Название команды в матче; пустое место — «Ожидается» (или «—» в проходе без игры). */
export const sideName = (m, s) => (m[s] ? esc(m[s].name) : m.bye ? 'нет соперника' : 'ожидается');

/** Победитель финала (если сыгран). */
export function champion(data) {
  const final = data.rounds[data.rounds.length - 1]?.matches[0];
  return final && final.winner ? final[final.winner] : null;
}

function teamRow(m, s) {
  const t = m[s], score = s === 'a' ? m.scoreA : m.scoreB;
  if (!t) return `<div class="bk-t tbd"><span class="bk-seed"></span><span class="bk-n">${m.bye ? '—' : 'Ожидается'}</span><b class="bk-s"></b></div>`;
  const state = m.bye ? '' : m.winner === s ? ' win' : m.winner ? ' lose' : '';
  return `<div class="bk-t${state}"><span class="bk-seed" title="Номер посева">${t.seed ?? ''}</span><span class="bk-n" title="${esc(t.name)}">${esc(t.name)}</span><b class="bk-s">${m.bye ? '' : score ?? ''}</b></div>`;
}

/** Карточка матча. Матч с проходом без игры страницы не имеет, поэтому это не ссылка. */
export function matchCard(m) {
  const foot = m.bye ? 'Проход без игры'
    : m.status === 'live' ? '<span class="bk-live">Идёт</span>'
      : m.status === 'finished' ? forfeitLabel(m)
        : m.startsAt ? whenShort(m.startsAt) : '';
  const label = `${m.a ? m.a.name : 'ожидается'} — ${m.b ? m.b.name : 'ожидается'}`;
  const cls = `bk-m${m.status === 'live' ? ' live' : ''}${m.bye ? ' bye' : ''}`;
  const inner = `${teamRow(m, 'a')}${teamRow(m, 'b')}${foot ? `<div class="bk-foot">${foot}</div>` : ''}`;
  return m.bye
    ? `<div class="${cls}" aria-label="${esc(label)}">${inner}</div>`
    : `<a class="${cls}" href="/matches/${esc(m.id)}" aria-label="Матч: ${esc(label)}">${inner}</a>`;
}

/**
 * Сетка колонками-раундами. Линии между матчами рисует CSS (см. bracket.css):
 * в каждой колонке места делят высоту поровну, поэтому пары раунда выстраиваются строго напротив своего следующего матча.
 */
export function bracketHtml(data) {
  const cols = data.rounds.map((r, i) => `
    <div class="bk-col${i === data.rounds.length - 1 ? ' final' : ''}" data-round="${r.round}">
      <h3 class="bk-h">${esc(r.name)}</h3>
      <div class="bk-slots">${r.matches.map((m) => `<div class="bk-slot">${matchCard(m)}</div>`).join('')}</div>
    </div>`).join('');
  return `<div class="bk-scroll" tabindex="0" role="region" aria-label="Турнирная сетка"><div class="bk">${cols}</div></div>`;
}

/** Быстрый переход к раунду (на телефоне сетка шире экрана). */
export const jumpHtml = (data) => (data.rounds.length > 2
  ? `<nav class="bk-jump" aria-label="Перейти к раунду">${data.rounds.map((r) => `<button type="button" class="bk-chip" data-jump="${r.round}">${esc(r.name)}</button>`).join('')}</nav>`
  : '');

/** Подключает кнопки быстрого перехода; работает и после перерисовки сетки (делегирование на root). */
export function bindJump(root) {
  const onClick = (e) => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    const sc = $('.bk-scroll', root), col = $(`.bk-col[data-round="${b.dataset.jump}"]`, root);
    if (!sc || !col) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    sc.scrollTo({ left: Math.max(col.offsetLeft - 8, 0), behavior: smooth ? 'smooth' : 'auto' });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

/** Копирование в буфер с запасным вариантом для старых браузеров. */
export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const i = document.createElement('textarea'); i.value = text; i.style.position = 'fixed'; i.style.opacity = '0';
    document.body.appendChild(i); i.select();
    try { document.execCommand('copy'); } catch { /* текст можно выделить вручную */ }
    i.remove();
  }
  const old = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => { btn.textContent = old; }, 1800);
}

/** Тихое автообновление: пока страница открыта и вкладка активна, раз в sec секунд зовёт tick. */
export function poll(tick, sec) {
  const timer = setInterval(() => { if (!document.hidden) tick(); }, sec * 1000);
  return () => clearInterval(timer);
}

/** Только http(s)-ссылки (демо матча): страховка на случай, если в базе окажется что-то иное. */
export const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

/** Ник из строки состава заявки (сервер хранит объекты { nick, … }). */
export const nickOf = (p) => (typeof p === 'string' ? p : p?.nick || '');
