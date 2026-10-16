import { z } from 'zod';

/** Ожидаемая ошибка запроса: глобальный обработчик превращает её в { code, field } с нужным статусом. */
export class HttpError extends Error {
  constructor(status, code, field, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
    this.details = details;
  }
}

/** Express 4 не ловит ошибки async-обработчиков сам — оборачиваем. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Проверка тела/параметров по схеме zod; при ошибке — 400 с именем первого плохого поля. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  throw new HttpError(400, 'validation', String(r.error.issues[0]?.path?.[0] ?? ''));
}

export const uuid = z.string().uuid();
