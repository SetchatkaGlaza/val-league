import { $, gsap, motion } from '../js/ui.js';
import { players } from '../js/api.js';
import { esc } from './parts.js';
import { dateShort } from './tournament-parts.js';
import { plural } from './team-parts.js';
import { outcome } from './team-history.js';

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

const row = (h) => {
  const t = h.tournament, [text, cls] = outcome(h);
  const format = `${t.teamSize}×${t.teamSize} · ${String(t.matchFormat).toUpperCase()}`;
  const team = h.team.slug ? `<a class="plain" href="/teams/${esc(h.team.slug)}">${esc(h.team.name)}</a>` : esc(h.team.name);
  const rec = h.record ? `<span class="th-rec" title="Победы и поражения команды в сетке">${h.record.wins}–${h.record.losses}</span>` : '';
  return `
  <li class="th-row">
    <a class="th-t" href="/tournaments/${esc(t.slug)}"><b>${esc(t.name)}</b><span>${dateShort(t.startsAt)} · ${format}</span></a>
    <span class="th-res th-${cls}">${esc(text)}</span>
    <p class="th-roster">В составе команды ${team}</p>
    <span class="th-x">${rec}${h.hasBracket ? `<a class="plain" href="/tournaments/${esc(t.slug)}/bracket">Сетка</a>` : ''}</span>
  </li>`;
};

/** Содержимое страницы игрока. d — ответ GET /api/players/:nick. */
export function playerHtml(d) {
  const { player, stats, history, rating } = d;
  const ratingChip = rating ? `<li><a class="plain" href="/rating" title="Как считаются очки — на странице рейтинга">Рейтинг: <b>№${rating.rank}</b> из ${rating.total} · ${rating.points} ${plural(rating.points, 'очко', 'очка', 'очков')}</a></li>` : '';
  const chips = [
    `${stats.tournaments} ${plural(stats.tournaments, 'турнир', 'турнира', 'турниров')}`,
    stats.titles ? `${stats.titles} ${plural(stats.titles, 'победа', 'победы', 'побед')} в турнирах` : '',
    stats.podiums ? `${stats.podiums} ${plural(stats.podiums, 'призовое место', 'призовых места', 'призовых мест')}` : '',
    stats.matchWins + stats.matchLosses ? `Матчи команд: ${stats.matchWins}–${stats.matchLosses}` : '',
  ].filter(Boolean);
  return `
  <section class="tm-hero pl-hero">
    <div class="pl-av" aria-hidden="true">${esc([...player.nick][0].toUpperCase())}</div>
    <div class="tm-hero-t"><h1>${esc(player.nick)}</h1>
      ${chips.length || ratingChip ? `<ul class="chips">${ratingChip}${chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>
  <section class="acc-card tm-wide"><h2>Участие в турнирах</h2>
    ${history.length
      ? `<ul class="th-list">${history.map(row).join('')}</ul>`
      : '<div class="acc-empty"><p>Игрок пока не участвовал в завершённых турнирах.</p><span>Здесь появятся места и результаты по каждому турниру.</span></div>'}
  </section>`;
}

const stateCard = (title, text, actions) => `
  <section class="stub tm-state"><h1>${title}</h1><p>${text}</p><div class="stub-actions">${actions}</div></section>`;

export default {
  layout: 'doc',
  title: 'Игрок',
  description: 'Профиль игрока VOLOGDA AMATEUR LEAGUE: участие и результаты в турнирах.',

  render: () => `
    <main class="acc tm">
      <a href="/" class="back">На главную</a>
      <div id="plBody"><div class="tm-skel" aria-busy="true"><div class="sk sk-hero"></div><div class="sk sk-card"></div></div></div>
    </main>`,

  mount(root, { params }) {
    const nick = safeDecode(params.nick || '');
    const body = $('#plBody', root);
    let alive = true;
    const load = async () => {
      try {
        const d = await players.get(nick);
        if (!alive) return;
        body.innerHTML = playerHtml(d);
        document.title = `${d.player.nick} — VOLOGDA AMATEUR LEAGUE`;
        if (motion) gsap.from(body.querySelectorAll('.tm-hero, .acc-card'), { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
      } catch (e) {
        if (!alive) return;
        body.innerHTML = e.code === 'not_found'
          ? stateCard('Игрок не найден', 'Возможно, он сменил ник или удалил аккаунт.', '<a href="/" class="btn btn-primary">На главную</a>')
          : stateCard('Не удалось загрузить', 'Попробуйте обновить страницу.', '<button type="button" class="btn btn-primary" data-act="retry">Повторить</button>');
      }
    };
    root.addEventListener('click', (e) => { if (e.target.closest('[data-act="retry"]')) { body.innerHTML = '<p class="th-note">Загружаем…</p>'; load(); } });
    load();
    return () => { alive = false; };
  },
};
