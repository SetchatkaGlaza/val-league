const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/** «Северный Ветер» → «severnyy-veter». Для адреса страницы команды. */
export function slugify(name) {
  const s = [...String(name).toLowerCase()].map((ch) => TR[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  return s || 'team';
}

// Адреса, которые заняты самим сайтом (/teams/new и т. п.).
export const RESERVED_SLUGS = ['new', 'create', 'edit', 'admin'];
