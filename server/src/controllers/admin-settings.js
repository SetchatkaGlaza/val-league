import { withTx } from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { record } from '../services/audit.js';
import { normalizePatch, changedSettings, bannerActive, DEFAULTS, ratingPoints } from '../services/settings.js';
import { loadSettings, resetSettingsCache } from './settings.js';
import { resetRatingCache, ratingTotal } from './players.js';

/** GET /api/admin/settings — все настройки, значения по умолчанию и признак, виден ли баннер сейчас. Только админ. */
export async function get(_req, res) {
  const settings = await loadSettings(null);
  res.json({ settings, defaults: DEFAULTS, bannerVisible: bannerActive(settings) });
}

/** PATCH /api/admin/settings — частичное обновление. Каждое реальное изменение пишется в журнал в той же транзакции. */
export async function update(req, res) {
  const out = await withTx(async (db) => {
    // Блокируем строки настроек, чтобы два админа не затёрли друг друга: проверка идёт по свежим значениям
    await db.query('SELECT key FROM settings FOR UPDATE');
    const current = await loadSettings(db);
    const r = normalizePatch(req.body, current);
    if (!r.values) throw new HttpError(400, 'validation', r.field, [r.error]);
    const d = changedSettings(current, r.values);
    if (!d.changed) return { settings: current, changed: false };
    for (const [k, v] of Object.entries(r.values)) {
      if (current[k] === v) continue;
      await db.query(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2::jsonb, now(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [k, JSON.stringify(v), req.user.id]);
    }
    await record(db, req, { action: 'settings.update', objectType: 'setting', objectId: 'site', label: 'Настройки сайта', before: d.before, after: d.after });
    return { settings: { ...current, ...r.values }, changed: true, ratingChanged: Object.keys(d.after).some((k) => k.startsWith('rating')) };
  });
  resetSettingsCache();
  if (out.ratingChanged) resetRatingCache();
  res.json({ settings: out.settings, changed: out.changed, bannerVisible: bannerActive(out.settings) });
}

/**
 * POST /api/admin/settings/rating-recalc — пересчитать рейтинг по текущей формуле.
 * Рейтинг считается из результатов турниров и не хранится, поэтому «пересчёт» сбрасывает кэш и считает заново.
 * Так сайт сразу показывает актуальные очки, даже если результаты прошлых турниров правили вручную в базе.
 */
export async function recalc(req, res) {
  resetSettingsCache(); resetRatingCache();
  const settings = await loadSettings(null);
  const total = await ratingTotal();
  await withTx((db) => record(db, req, {
    action: 'settings.rating_recalc', objectType: 'setting', objectId: 'rating', label: 'Рейтинг игроков',
    meta: { players: total, participation: settings.ratingParticipation, place1: settings.ratingPlace1, place2: settings.ratingPlace2, place3: settings.ratingPlace3, matchWin: settings.ratingMatchWin },
  }));
  res.json({ players: total, points: ratingPoints(settings) });
}
