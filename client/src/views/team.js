import { $, $$, gsap, motion } from '../js/ui.js';
import { teams } from '../js/api.js';
import { getUser } from '../js/session.js';
import { squareLogo, LOGO_ERRORS } from '../js/image.js';
import { teamNameError, teamDescError } from '../js/validators.js';
import { ICON, esc } from './parts.js';
import { teamLogo, teamError, flash, longDate, plural } from './team-parts.js';
import { REG_STATUS } from './registration-parts.js';
import { dateShort } from './tournament-parts.js';

const skeleton = '<div class="tm-skel" aria-busy="true"><div class="sk sk-hero"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>';

const stateCard = (title, text, actions) => `
  <section class="stub tm-state"><h1>${title}</h1><p>${text}</p><div class="stub-actions">${actions}</div></section>`;

// ---------- Разметка блоков ----------
function hero(d) {
  const { team, members, viewer } = d;
  const main = members.filter((m) => m.role === 'main').length, sub = members.length - main;
  const badge = !viewer ? '' : viewer.isCaptain ? '<span class="tm-badge cap">Вы капитан</span>' : viewer.isMember ? '<span class="tm-badge">Вы в команде</span>' : '';
  return `
  <section class="tm-hero">
    ${teamLogo(team, 'xl')}
    <div class="tm-hero-t">
      <h1>${esc(team.name)}</h1>${badge}
      <p class="tm-desc">${team.description ? esc(team.description) : '<span class="muted">Описание пока не заполнено.</span>'}</p>
      <ul class="chips">
        <li>Основа: ${main} из ${team.limits.main}</li>
        <li>Запасные: ${sub} из ${team.limits.sub}</li>
        <li>Создана ${longDate(team.createdAt)}</li>
      </ul>
    </div>
    ${viewer && viewer.isMember && !viewer.isCaptain ? '<button type="button" class="btn btn-ghost btn-sm" data-act="leave">Покинуть команду</button>' : ''}
  </section>`;
}

function memberRow(m, isCaptainViewer, team) {
  const menu = isCaptainViewer && !m.isCaptain ? `
    <details class="mem-menu"><summary class="btn btn-ghost btn-sm" aria-label="Действия с игроком ${esc(m.nick)}">Действия</summary>
      <div class="mem-pop" role="menu">
        <button type="button" role="menuitem" data-act="role" data-id="${m.id}" data-role="${m.role === 'main' ? 'sub' : 'main'}">${m.role === 'main' ? 'Перевести в запас' : 'Перевести в основу'}</button>
        <button type="button" role="menuitem" data-act="captain" data-id="${m.id}" data-nick="${esc(m.nick)}">Сделать капитаном</button>
        <button type="button" role="menuitem" class="bad" data-act="kick" data-id="${m.id}" data-nick="${esc(m.nick)}">Исключить из команды</button>
      </div></details>` : '';
  return `
  <li class="mem">
    <div class="mem-av" aria-hidden="true">${esc([...m.nick][0].toUpperCase())}</div>
    <div class="mem-t"><b>${esc(m.nick)}</b>
      <span>${m.isCaptain ? '<i class="tm-badge cap">Капитан</i>' : ''}${m.steam ? `<i class="tm-badge steam" title="Steam подтверждён">${ICON.steam}Steam</i>` : ''}</span></div>
    ${menu}
  </li>`;
}

function roster(d) {
  const { team, members, viewer } = d, cap = !!viewer && viewer.isCaptain;
  const main = members.filter((m) => m.role === 'main'), sub = members.filter((m) => m.role === 'sub');
  const list = (arr, empty) => (arr.length ? `<ul class="mem-list">${arr.map((m) => memberRow(m, cap, team)).join('')}</ul>` : `<p class="tm-empty">${empty}</p>`);
  return `
  <section class="acc-card tm-wide">
    <h2>Состав</h2>
    <h3 class="tm-sub">Основа <span>${main.length} из ${team.limits.main}</span></h3>${list(main, 'В основе пока никого.')}
    <h3 class="tm-sub">Запасные <span>${sub.length} из ${team.limits.sub}</span></h3>${list(sub, 'Запасных пока нет.')}
  </section>`;
}

function invitePanel(d) {
  const { team, members } = d, total = team.limits.main + team.limits.sub, full = members.length >= total;
  const link = `${location.origin}/invite?token=${d.inviteToken}`;
  const pending = d.invites.length ? `
    <h3 class="tm-sub">Ждут ответа</h3>
    <ul class="mem-list">${d.invites.map((i) => `<li class="mem"><div class="mem-av" aria-hidden="true">${esc([...i.nick][0].toUpperCase())}</div><div class="mem-t"><b>${esc(i.nick)}</b><span>${longDate(i.createdAt)}</span></div><button type="button" class="btn btn-ghost btn-sm" data-act="revoke" data-id="${i.id}">Отозвать</button></li>`).join('')}</ul>` : '';
  return `
  <section class="acc-card">
    <h2>Пригласить игроков</h2>
    <p class="acc-sub">${full ? 'Состав заполнен: освободите место, чтобы приглашать.' : `Свободно мест: ${total - members.length}. Игрок сам принимает приглашение.`}</p>
    <form class="set-form" id="inviteForm" novalidate>
      <div class="field" data-field="nick"><label for="inviteNick">Ник игрока</label>
        <div class="control">${ICON.user}<input id="inviteNick" name="nick" type="text" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ник на сайте VAL" aria-describedby="nick-err" ${full ? 'disabled' : ''} /></div>
        <p class="err" id="nick-err" role="alert"></p></div>
      <button type="submit" class="btn btn-primary btn-sm" ${full ? 'disabled' : ''}><span class="label">Пригласить</span><span class="spinner" aria-hidden="true"></span></button>
    </form>
    <h3 class="tm-sub">Или отправьте ссылку</h3>
    <div class="link-box"><input id="inviteLink" type="text" readonly value="${esc(link)}" aria-label="Ссылка-приглашение" /></div>
    <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="copy">Копировать</button><button type="button" class="btn btn-ghost btn-sm" data-act="reset-link">Сбросить ссылку</button></div>
    <p class="hint-mut">Ссылкой может воспользоваться любой вошедший на сайт, пока в составе есть место. Если она попала не туда, сбросьте её.</p>
    ${pending}
  </section>`;
}

function settingsPanel(d) {
  const { team } = d;
  return `
  <section class="acc-card">
    <h2>Настройки команды</h2>
    <div class="logo-pick tm-logo-set">
      ${teamLogo(team, 'lg')}
      <div class="logo-pick-t">
        <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
        <div class="tg-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="logo-pick">${team.logo ? 'Заменить логотип' : 'Загрузить логотип'}</button>${team.logo ? '<button type="button" class="btn btn-ghost btn-sm" data-act="logo-remove">Убрать</button>' : ''}</div>
        <p class="err" id="logo-err" role="alert"></p>
      </div>
    </div>
    <form class="set-form" id="editForm" novalidate>
      <div class="field" data-field="name"><label for="editName">Название</label>
        <div class="control"><input id="editName" name="name" type="text" maxlength="24" autocomplete="off" spellcheck="false" value="${esc(team.name)}" aria-describedby="name-err" /></div>
        <p class="err" id="name-err" role="alert"></p></div>
      <div class="field" data-field="description"><label for="editDesc">Описание</label>
        <div class="control area"><textarea id="editDesc" name="description" rows="3" maxlength="300" aria-describedby="description-err">${esc(team.description)}</textarea></div>
        <p class="err" id="description-err" role="alert"></p></div>
      <button type="submit" class="btn btn-primary btn-sm"><span class="label">Сохранить</span><span class="spinner" aria-hidden="true"></span></button>
    </form>
  </section>`;
}

function tournaments(d) {
  const list = d.tournaments.length
    ? `<ul class="mem-list">${d.tournaments.map((t) => `<li class="mem"><a class="mem-link" href="/tournaments/${esc(t.slug)}"><span class="mem-t"><b>${esc(t.name)}</b><span>${dateShort(t.startsAt)}</span></span>
        <span class="mem-r"><span class="st st-${REG_STATUS[t.regStatus]?.[1] || 'soon'}">${REG_STATUS[t.regStatus]?.[0] || ''}</span></span></a></li>`).join('')}</ul>`
    : '<div class="acc-empty"><p>Команда пока не участвовала в турнирах.</p><span>Здесь появятся заявки и сыгранные турниры.</span></div>';
  return `<section class="acc-card"><h2>Турниры</h2>${list}</section>`;
}

function dangerZone(d) {
  return `
  <section class="acc-card acc-wide danger">
    <h2>Удаление команды</h2>
    <p class="acc-sub">Состав, приглашения и логотип будут удалены без возможности восстановления. Если нужно просто уступить место, передайте капитанство в списке состава.</p>
    <button type="button" class="btn btn-danger btn-sm" id="delOpen">Удалить команду</button>
    <form class="del-panel" id="delForm" hidden novalidate>
      <label for="delName">Для подтверждения введите название команды: <b>${esc(d.team.name)}</b></label>
      <div class="control"><input id="delName" type="text" autocomplete="off" spellcheck="false" /></div>
      <div class="tg-actions"><button type="submit" class="btn btn-danger btn-sm" id="delGo" disabled><span class="label">Удалить навсегда</span><span class="spinner" aria-hidden="true"></span></button>
      <button type="button" class="btn btn-ghost btn-sm" id="delCancel">Отмена</button></div>
    </form>
  </section>`;
}

function page(d, note) {
  const cap = !!d.viewer && d.viewer.isCaptain;
  return `
    ${note ? `<div class="banner ok" role="status">${esc(note)}</div>` : ''}
    ${hero(d)}
    <div class="acc-grid">
      ${roster(d)}
      ${cap ? invitePanel(d) : ''}
      ${cap ? settingsPanel(d) : ''}
      ${tournaments(d)}
      ${cap ? dangerZone(d) : ''}
    </div>`;
}

// ---------- Страница ----------
export default {
  layout: 'doc',
  title: 'Команда',
  description: 'Команда VOLOGDA AMATEUR LEAGUE: состав, капитан и история турниров.',

  render: () => `
    <main class="acc tm">
      <a href="${getUser() ? '/account' : '/'}" class="back">${ICON.back}${getUser() ? 'Личный кабинет' : 'На главную'}</a>
      <div id="tmBody">${skeleton}</div>
      <p class="tm-toast" id="toast" role="status" hidden></p>
    </main>`,

  mount(root, { navigate, params }) {
    const slug = params.slug;
    const body = $('#tmBody', root), toast = $('#toast', root);
    let alive = true, data = null, toastTimer = 0, note = flash.take();

    const say = (text, ok = false) => {
      clearTimeout(toastTimer);
      toast.textContent = text; toast.className = 'tm-toast' + (ok ? ' ok' : ' bad'); toast.hidden = !text;
      if (text) toastTimer = setTimeout(() => { toast.hidden = true; }, ok ? 3000 : 6000);
    };
    const busy = (btn, v) => { if (btn) { btn.disabled = v; btn.classList.toggle('loading', v); } };

    const paint = (animate) => {
      body.innerHTML = page(data, note); note = null;
      document.title = `${data.team.name} — VOLOGDA AMATEUR LEAGUE`;
      if (animate && motion) gsap.from($$('.tm-hero, .acc-card', body), { y: 22, opacity: 0, duration: .6, stagger: .08, ease: 'power3.out', clearProps: 'transform,opacity' });
    };

    const load = async (first = false) => {
      try {
        const d = await teams.get(slug);
        if (!alive) return false;
        data = d; paint(first); return true;
      } catch (e) {
        if (!alive) return false;
        if (first) {
          body.innerHTML = e.code === 'not_found'
            ? stateCard('Команда не найдена', 'Возможно, её удалили или в адресе опечатка.', '<a href="/" class="btn btn-primary">На главную</a>')
            : stateCard('Не удалось загрузить', teamError(e, 'Попробуйте обновить страницу.'), '<button type="button" class="btn btn-primary" data-act="retry">Повторить</button>');
        } else say(teamError(e));
        return false;
      }
    };

    /** Выполняет действие и перерисовывает страницу свежими данными. */
    const run = async (btn, fn, okText) => {
      busy(btn, true);
      try { await fn(); } catch (e) { if (alive) { busy(btn, false); say(teamError(e)); } return false; }
      if (!alive) return true;
      await load();
      if (okText) say(okText, true);
      return true;
    };

    // ----- клики -----
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act], #delOpen, #delCancel'); if (!btn || btn.disabled) return;
      const act = btn.dataset.act || btn.id, id = btn.dataset.id, nick = btn.dataset.nick;
      switch (act) {
        case 'retry': body.innerHTML = skeleton; load(true); break;
        case 'leave':
          if (confirm(`Покинуть команду «${data.team.name}»?`)) {
            busy(btn, true);
            try { await teams.kick(slug, getUser().id); navigate('/account'); } catch (err) { busy(btn, false); say(teamError(err)); }
          }
          break;
        case 'kick': if (confirm(`Исключить ${nick} из команды?`)) run(btn, () => teams.kick(slug, id), `${nick} исключён из команды.`); break;
        case 'captain': if (confirm(`Передать капитанство игроку ${nick}? Вы останетесь в команде обычным игроком.`)) run(btn, () => teams.makeCaptain(slug, id), `Новый капитан: ${nick}.`); break;
        case 'role': run(btn, () => teams.setRole(slug, id, btn.dataset.role)); break;
        case 'revoke': run(btn, () => teams.revokeInvite(slug, id), 'Приглашение отозвано.'); break;
        case 'reset-link': if (confirm('Старая ссылка перестанет работать. Сбросить?')) run(btn, () => teams.resetLink(slug), 'Новая ссылка готова.'); break;
        case 'copy': {
          const input = $('#inviteLink', root);
          let ok = false;
          try { await navigator.clipboard.writeText(input.value); ok = true; } catch { input.select(); try { ok = document.execCommand('copy'); } catch { /* ничего */ } }
          say(ok ? 'Ссылка скопирована.' : 'Не удалось скопировать — выделите ссылку и скопируйте вручную.', ok);
          break;
        }
        case 'logo-pick': $('#logoFile', root).click(); break;
        case 'logo-remove': run(btn, () => teams.removeLogo(slug), 'Логотип убран.'); break;
        case 'delOpen': btn.hidden = true; $('#delForm', root).hidden = false; $('#delName', root).focus(); break;
        case 'delCancel': { const f = $('#delForm', root); f.hidden = true; $('#delOpen', root).hidden = false; $('#delName', root).value = ''; $('#delGo', root).disabled = true; break; }
        default:
      }
    });

    // ----- закрываем меню игрока кликом снаружи -----
    const closeMenus = (e) => $$('.mem-menu[open]', root).forEach((m) => { if (!m.contains(e.target)) m.removeAttribute('open'); });
    document.addEventListener('click', closeMenus);

    root.addEventListener('input', (e) => {
      if (e.target.id === 'delName') $('#delGo', root).disabled = e.target.value.trim().toLowerCase() !== data.team.name.toLowerCase();
      const field = e.target.closest('.field'); if (field) { field.classList.remove('invalid'); const er = $('.err', field); if (er) er.textContent = ''; }
    });

    // ----- загрузка логотипа -----
    root.addEventListener('change', async (e) => {
      if (e.target.id !== 'logoFile' || !e.target.files[0]) return;
      const f = e.target.files[0], err = $('#logo-err', root); err.textContent = '';
      let blob;
      try { blob = await squareLogo(f); } catch (x) { err.textContent = LOGO_ERRORS[x.message] || LOGO_ERRORS.decode; return; }
      say('Загружаем логотип…', true);
      run(null, () => teams.setLogo(slug, blob), 'Логотип обновлён.');
    });

    // ----- формы -----
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target, btn = $('button[type=submit]', form);
      const setErr = (name, msg) => { $(`[data-field="${name}"]`, form).classList.toggle('invalid', !!msg); $(`#${name}-err`, form).textContent = msg; return !msg; };

      if (form.id === 'inviteForm') {
        const nick = form.nick.value.trim();
        if (!setErr('nick', nick ? '' : 'Введите ник игрока')) { form.nick.focus(); return; }
        busy(btn, true);
        try { await teams.invite(slug, nick); if (!alive) return; await load(); say(`Приглашение отправлено: ${nick}.`, true); }
        catch (err) { if (!alive) return; busy(btn, false); if (err.field === 'nick') setErr('nick', teamError(err)); else say(teamError(err)); }
      }

      if (form.id === 'editForm') {
        const rules = { name: teamNameError, description: teamDescError };
        const bad = Object.keys(rules).filter((n) => !setErr(n, rules[n](form[n].value)));
        if (bad.length) { form[bad[0]].focus(); return; }
        busy(btn, true);
        try { await teams.update(slug, { name: form.name.value.trim().replace(/\s+/g, ' '), description: form.description.value.trim() }); if (!alive) return; await load(); say('Изменения сохранены.', true); }
        catch (err) { if (!alive) return; busy(btn, false); if (err.field === 'name') setErr('name', teamError(err)); else say(teamError(err)); }
      }

      if (form.id === 'delForm') {
        const go = $('#delGo', form); if (go.disabled) return;
        busy(go, true);
        try { await teams.remove(slug); navigate('/account'); }
        catch (err) { if (alive) { busy(go, false); say(teamError(err)); } }
      }
    });

    load(true);
    return () => { alive = false; clearTimeout(toastTimer); document.removeEventListener('click', closeMenus); };
  },
};
