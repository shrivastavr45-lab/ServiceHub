import { z } from 'zod';
import { AppError } from './errors.js';

/** Validate data with a zod schema; returns parsed data or throws a 422. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ok = (res, data, meta) => res.json(meta ? { data, meta } : { data });
export const created = (res, data) => res.status(201).json({ data });
export const pageMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });

export const uuid = z.string().uuid();
export const idParam = (req, name = 'id') => parse(uuid, req.params[name]);
