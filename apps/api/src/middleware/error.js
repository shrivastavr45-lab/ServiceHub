import { AppError } from '../lib/errors.js';
import { isProd, isTest } from '../config.js';

export const notFoundHandler = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.parse.failed') err = new AppError(400, 'BAD_JSON', 'Malformed JSON body');
  if (err.name === 'MulterError') err = new AppError(400, 'UPLOAD_ERROR', err.message);
  if (err.code === '23505') err = new AppError(409, 'CONFLICT', 'Resource already exists');
  if (err.code === '23503') err = new AppError(409, 'CONFLICT', 'Referenced resource is in use or missing');
  if (err.code === '23514') err = new AppError(422, 'CONSTRAINT_VIOLATION', 'Value violates a data constraint');
  if (err.code === '22P02') err = new AppError(400, 'BAD_REQUEST', 'Malformed identifier');

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (!isTest) console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: isProd ? 'Internal server error' : err.message } });
}
