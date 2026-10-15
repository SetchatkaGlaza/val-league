/**
 * Готовит логотип к загрузке: обрезает по центру до квадрата и уменьшает до 256×256.
 * Так файл весит десятки КБ, а лишние метаданные (EXIF, геометки) не уходят на сервер.
 * Возвращает Blob: webp, а в браузерах без кодирования webp — png (тип смотрите в blob.type).
 */
export async function squareLogo(file, size = 256) {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('type');
  if (file.size > 10 * 1024 * 1024) throw new Error('size');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('decode'); }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (!blob) throw new Error('decode');
  return blob;
}

export const LOGO_ERRORS = {
  type: 'Подойдёт PNG, JPG, WebP или GIF.',
  size: 'Файл слишком большой — выберите картинку до 10 МБ.',
  decode: 'Не удалось прочитать картинку. Попробуйте другой файл.',
};
