/** Текущий пользователь на клиенте. «Запомнить меня» — localStorage, иначе только эта вкладка.
 *  Настоящая сессия — httpOnly-cookie на сервере; здесь лишь копия профиля для интерфейса. */
const K = 'val:user';
const read = (s) => { try { return JSON.parse(s.getItem(K)); } catch { return null; } };
export const getUser = () => read(localStorage) || read(sessionStorage);
export function setUser(user, remember = false) {
  clearUser();
  try { (remember ? localStorage : sessionStorage).setItem(K, JSON.stringify(user)); } catch { /* хранилище недоступно */ }
}
export function clearUser() { try { localStorage.removeItem(K); sessionStorage.removeItem(K); } catch { /* ignore */ } }
/** Обновляет поля профиля там же, где он хранится. */
export function patchUser(patch) {
  const u = getUser(); if (!u) return null;
  const store = read(localStorage) ? localStorage : sessionStorage;
  const next = { ...u, ...patch };
  try { store.setItem(K, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
