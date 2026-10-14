/** Почта, на которую отправлено письмо подтверждения (живёт только в этой вкладке). */
const K = 'val:pending-email';
export const savePending = (email, sentAt = Date.now()) => {
  try { sessionStorage.setItem(K, JSON.stringify({ email, sentAt })); } catch { /* хранилище недоступно */ }
};
export const readPending = () => {
  try { return JSON.parse(sessionStorage.getItem(K)) || null; } catch { return null; }
};
