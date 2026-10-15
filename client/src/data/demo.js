// ДЕМО-ДАННЫЕ главной страницы. Когда появятся турниры в БД, замените ответом API
// (GET /api/tournaments/next и GET /api/winners?limit=3) — разметка менять не придётся.

/** Ближайшая суббота, 19:00 по времени пользователя (не меньше чем через 3 дня). */
function nextSaturday() {
  const d = new Date(); d.setHours(19, 0, 0, 0);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  if (d - Date.now() < 3 * 864e5) d.setDate(d.getDate() + 7);
  return d;
}

export const nextTournament = {
  name: 'VAL Open #4',
  startsAt: nextSaturday(),
  format: '5x5 · Single Elimination · BO1',
  fee: 1000,           // ₽ с команды; 0 = бесплатно
  prize: 50000,        // ₽
  slots: { taken: 18, total: 32 },
};

export const winners = [
  { tournament: 'VAL Open #3', date: '28 сентября 2026', place: 'Северный Ветер', roster: ['Shadow', 'Kvasir', 'Rimma', 'Vlad_K', 'Zeta'], prize: 40000 },
  { tournament: 'VAL Open #2', date: '31 августа 2026', place: 'Кремлёвские', roster: ['Mirage', 'Ghost', 'Lisa_P', 'Dron', 'Cobalt'], prize: 30000 },
  { tournament: 'VAL Cup: 2x2', date: '3 августа 2026', place: 'Дуэт Вологды', roster: ['Frost', 'Nika'], prize: 10000 },
];
