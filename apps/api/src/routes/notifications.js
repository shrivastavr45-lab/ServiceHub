import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { parse, ok, idParam, paginationSchema, pageMeta } from '../lib/http.js';
import { notFound } from '../lib/errors.js';

const router = Router();

router.get('/', async (req, res) => {
  const f = parse(paginationSchema.extend({ unread: z.enum(['true', 'false']).optional() }), req.query);
  const unreadOnly = f.unread === 'true' ? 'AND read_at IS NULL' : '';
  const total = (await query(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 ${unreadOnly}`, [req.user.id])).rows[0].n;
  const { rows } = await query(`SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = $1 ${unreadOnly}
    ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [req.user.id, f.limit, (f.page - 1) * f.limit]);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});
router.get('/unread-count', async (req, res) => {
  ok(res, { count: (await query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n });
});
router.post('/read-all', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.status(204).end();
});
router.post('/:id/read', async (req, res) => {
  const r = await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [idParam(req), req.user.id]);
  if (!r.rowCount) throw notFound('Notification not found');
  res.status(204).end();
});
export default router;
