import { auth } from '../js/api.js';
import { getUser, setUser, patchUser } from '../js/session.js';
import { safeNext } from '../js/validators.js';

/** Сюда сервер возвращает игрока после Steam. Сессия (cookie) уже выдана; здесь только подтягиваем профиль в интерфейс и идём дальше. */
export default {
  layout: 'auth',
  title: 'Вход через Steam',
  description: 'Завершаем вход через Steam.',
  render: () => `
    <div class="done" aria-busy="true">
      <div class="ok-icon pending"><span class="spinner spinner-lg"></span></div>
      <h2>Завершаем вход через Steam…</h2>
      <p>Это займёт пару секунд.</p>
    </div>`,

  mount(root, { navigate, query }) {
    let alive = true;
    const next = safeNext(query.get('next'), '/account');
    const linked = query.get('linked') === '1';
    auth.me()
      .then(({ user }) => {
        if (!alive) return;
        // Привязка: профиль уже хранится там, где его хранили («запомнить меня» не трогаем). Вход: только эта вкладка, как у входа без «запомнить меня».
        if (linked && getUser()) patchUser(user); else setUser(user, false);
        navigate(linked ? `${next}${next.includes('?') ? '&' : '?'}steam=linked` : next, { replace: true });
      })
      .catch(() => { if (alive) navigate(`${linked ? '/account' : '/login'}?error=steam_failed`, { replace: true }); });
    return () => { alive = false; };
  },
};
