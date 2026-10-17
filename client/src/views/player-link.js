import { esc } from './parts.js';

/** Ник игрока ссылкой на его публичный профиль (/players/<ник>). */
export const playerLink = (nick) => `<a class="plain" href="/players/${encodeURIComponent(nick)}">${esc(nick)}</a>`;
