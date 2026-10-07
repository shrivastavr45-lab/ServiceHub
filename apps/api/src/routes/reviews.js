import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { parse, ok, created, paginationSchema, pageMeta, uuid } from '../lib/http.js';
import { notFound, forbidden, conflict } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

const router = Router();

/** Recompute the denormalised rating from visible reviews (called inside the same transaction). */
export async function refreshProviderRating(c, providerId) {
  await c.query(`UPDATE provider_profiles SET
    rating_avg = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE provider_id = $1 AND status = 'VISIBLE'), 0),
    rating_count = (SELECT COUNT(*) FROM reviews WHERE provider_id = $1 AND status = 'VISIBLE') WHERE user_id = $1`, [providerId]);
}

router.post('/', authenticate, requireRole('CUSTOMER'), async (req, res) => {
  const d = parse(z.object({ booking_id: uuid, rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }), req.body);
  const review = await withTransaction(async (c) => {
    const b = (await c.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [d.booking_id])).rows[0];
    if (!b || b.customer_id !== req.user.id) throw notFound('Booking not found');
    if (b.status !== 'COMPLETED') throw forbidden('You can only review a completed booking');
    if ((await c.query('SELECT 1 FROM reviews WHERE booking_id = $1', [b.id])).rowCount) throw conflict('You have already reviewed this booking', 'ALREADY_REVIEWED');
    const r = (await c.query(`INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.id, req.user.id, b.provider_id, d.rating, d.comment ?? null])).rows[0];
    await refreshProviderRating(c, b.provider_id);
    await notify(b.provider_id, 'NEW_REVIEW', 'New review', `${req.user.name} rated you ${d.rating}/5`, { booking_id: b.id, review_id: r.id }, c);
    return r;
  });
  created(res, review);
});

// Public: reviews for a provider.
router.get('/', async (req, res) => {
  const f = parse(paginationSchema.extend({ provider_id: uuid }), req.query);
  const total = (await query(`SELECT COUNT(*) AS n FROM reviews WHERE provider_id = $1 AND status = 'VISIBLE'`, [f.provider_id])).rows[0].n;
  const { rows } = await query(`SELECT r.id, r.rating, r.comment, r.created_at, split_part(u.name, ' ', 1) AS customer_name
    FROM reviews r JOIN users u ON u.id = r.customer_id WHERE r.provider_id = $1 AND r.status = 'VISIBLE'
    ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [f.provider_id, f.limit, (f.page - 1) * f.limit]);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

// Reviews I wrote (customer) or received (provider).
router.get('/mine', authenticate, async (req, res) => {
  const col = req.user.role === 'SERVICE_PROVIDER' ? 'r.provider_id' : 'r.customer_id';
  const { rows } = await query(`SELECT r.id, r.booking_id, r.rating, r.comment, r.status, r.created_at, b.service_name,
      cu.name AS customer_name, pu.name AS provider_name
    FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN users cu ON cu.id = r.customer_id JOIN users pu ON pu.id = r.provider_id
    WHERE ${col} = $1 ${req.user.role === 'SERVICE_PROVIDER' ? `AND r.status = 'VISIBLE'` : ''} ORDER BY r.created_at DESC LIMIT 100`, [req.user.id]);
  ok(res, rows);
});

export default router;
