import { query } from '../db/index.js';
import { mergeSettings, publicSettings } from '../services/settings.js';

// Настройки читаются часто (баннер на каждой странице), поэтому держим их в памяти полминуты; после сохранения кэш сбрасывается.
let cache = { at: 0, value: null };
export const resetSettingsCache = () => { cache = { at: 0, value: null }; };

/** Все настройки с учётом значений по умолчанию. db — транзакция (если нужно читать в ней), иначе общий пул. */
export async function loadSettings(db = null) {
  if (!db && cache.value && Date.now() - cache.at < 30_000) return cache.value;
  const { rows } = await (db ?? { query }).query('SELECT key, value FROM settings');
  const value = mergeSettings(rows);
  if (!db) cache = { at: Date.now(), value };
  return value;
}

/** GET /api/settings — публичная часть: контакты, соцсети, баннер. */
export async function getPublic(_req, res) {
  res.set('Cache-Control', 'public, max-age=30');
  res.json(publicSettings(await loadSettings()));
}
