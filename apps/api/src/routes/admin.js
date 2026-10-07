import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { parse, ok, idParam, paginationSchema, pageMeta, uuid } from '../lib/http.js';
import { notFound, forbidden, badRequest } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { refreshProviderRating } from './reviews.js';
import * as svc from '../services/bookingService.js';

const router = Router();
router.use(requireRole('ADMIN')); // every admin route is role-gated here, server-side

router.get('/dashboard', async (_req, res) => {
  const [counts, popular, recent, daily] = await Promise.all([
    query(`SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER') AS total_customers,
      (SELECT COUNT(*) FROM users WHERE role = 'SERVICE_PROVIDER') AS total_providers,
      (SELECT COUNT(*) FROM bookings) AS total_bookings,
      (SELECT COUNT(*) FROM bookings WHERE status = 'COMPLETED') AS completed_bookings,
      (SELECT COUNT(*) FROM bookings WHERE status = 'CANCELLED') AS cancelled_bookings,
      (SELECT COALESCE(SUM(agreed_price_paise),0) FROM bookings WHERE status = 'COMPLETED') AS revenue_paise,
      (SELECT COALESCE(SUM(platform_fee_paise),0) FROM bookings WHERE status = 'COMPLETED') AS platform_fees_paise,
      (SELECT COUNT(DISTINCT provider_id) FROM bookings WHERE created_at > now() - interval '30 days') AS active_providers,
      (SELECT COUNT(*) FROM disputes WHERE status = 'OPEN') AS open_disputes,
      (SELECT COUNT(*) FROM reports WHERE status = 'OPEN') AS open_reports`),
    query(`SELECT service_name, category_name, COUNT(*) AS bookings FROM bookings GROUP BY 1,2 ORDER BY bookings DESC LIMIT 5`),
    query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 10`),
    query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(b.id) AS bookings FROM generate_series(current_date - 13, current_date, '1 day') d
      LEFT JOIN bookings b ON b.created_at::date = d::date GROUP BY d ORDER BY d`),
  ]);
  ok(res, { ...counts.rows[0], popular_services: popular.rows, recent_activity: recent.rows, bookings_per_day: daily.rows });
});

router.get('/users', async (req, res) => {
  const f = parse(paginationSchema.extend({
    role: z.enum(['CUSTOMER', 'SERVICE_PROVIDER']).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    q: z.string().trim().max(100).optional(),
  }), req.query);
  const params = []; const where = [`u.role <> 'ADMIN'`];
  if (f.role) { params.push(f.role); where.push(`u.role = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`u.status = $${params.length}`); }
  if (f.q) { params.push(f.q); where.push(`(u.name ILIKE '%' || $${params.length} || '%' OR u.email ILIKE '%' || $${params.length} || '%')`); }
  const w = `WHERE ${where.join(' AND ')}`;
  const total = (await query(`SELECT COUNT(*) AS n FROM users u ${w}`, params)).rows[0].n;
  const { rows } = await query(`SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at,
      pp.verification_status, pp.rating_avg, pp.rating_count,
      (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id OR b.provider_id = u.id) AS bookings
    FROM users u LEFT JOIN provider_profiles pp ON pp.user_id = u.id ${w}
    ORDER BY u.created_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

router.patch('/users/:id/status', async (req, res) => {
  const id = idParam(req);
  const d = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().max(300).optional() }), req.body);
  await withTransaction(async (c) => {
    const u = (await c.query('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!u) throw notFound('User not found');
    if (u.role === 'ADMIN') throw forbidden('Admin accounts cannot be suspended here');
    await c.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [id, d.status]);
    if (d.status === 'SUSPENDED') await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(req.user, d.status === 'SUSPENDED' ? 'user.suspend' : 'user.activate', 'user', id, { reason: d.reason }, req, c);
    await notify(id, 'ACCOUNT_STATUS', d.status === 'SUSPENDED' ? 'Account suspended' : 'Account reactivated', d.reason ?? null, {}, c);
  });
  res.status(204).end();
});

router.patch('/providers/:id/verification', async (req, res) => {
  const id = idParam(req);
  const d = parse(z.object({ verification_status: z.enum(['PENDING', 'APPROVED', 'REJECTED']) }), req.body);
  const r = await query('UPDATE provider_profiles SET verification_status = $2 WHERE user_id = $1', [id, d.verification_status]);
  if (!r.rowCount) throw notFound('Provider not found');
  await audit(req.user, 'provider.verification', 'user', id, d, req);
  res.status(204).end();
});

router.get('/bookings', async (req, res) => {
  const f = parse(paginationSchema.extend({ status: z.string().optional() }), req.query);
  const params = []; let w = '';
  if (f.status) { params.push(f.status.split(',')); w = `WHERE b.status = ANY($1)`; }
  const total = (await query(`SELECT COUNT(*) AS n FROM bookings b ${w}`, params)).rows[0].n;
  const { rows } = await query(`SELECT b.id, b.status, b.service_name, b.agreed_price_paise, b.platform_fee_paise, b.created_at, b.scheduled_at,
      cu.name AS customer_name, pu.name AS provider_name
    FROM bookings b JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id
    ${w} ORDER BY b.created_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

// ---- Catalog (includes inactive items, unlike the public endpoints) ----
router.get('/categories', async (_req, res) => {
  ok(res, (await query(`SELECT c.*, (SELECT COUNT(*) FROM services s WHERE s.category_id = c.id) AS service_count FROM categories c ORDER BY c.name`)).rows);
});
router.get('/services', async (_req, res) => {
  ok(res, (await query(`SELECT s.*, c.name AS category_name FROM services s JOIN categories c ON c.id = s.category_id ORDER BY c.name, s.name`)).rows);
});

// ---- Disputes ----
router.post('/disputes/:id/resolve', async (req, res) => {
  const id = idParam(req);
  const d = parse(z.object({ resolution: z.string().trim().min(5).max(2000), booking_status: z.enum(['COMPLETED', 'CANCELLED']) }), req.body);
  const out = await withTransaction(async (c) => {
    const disp = (await c.query('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!disp) throw notFound('Dispute not found');
    if (disp.status !== 'OPEN') throw badRequest('Dispute is already resolved');
    const b = await svc.lockBooking(c, disp.booking_id, req.user);
    if (d.booking_status === 'CANCELLED') await svc.cancel(c, b, req.user, `Dispute resolved: ${d.resolution}`, true);
    else await svc.transition(c, b, 'COMPLETED', req.user, { note: `Dispute resolved: ${d.resolution}`, set: { completed_at: b.completed_at ?? new Date() } });
    const row = (await c.query(`UPDATE disputes SET status = 'RESOLVED', resolution = $2, resolved_booking_status = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 RETURNING *`,
      [id, d.resolution, d.booking_status, req.user.id])).rows[0];
    for (const uid of [b.customer_id, b.provider_id]) await notify(uid, 'DISPUTE_RESOLVED', 'Dispute resolved', d.resolution, { booking_id: b.id, dispute_id: id }, c);
    await audit(req.user, 'dispute.resolve', 'dispute', id, { booking_status: d.booking_status }, req, c);
    return row;
  });
  ok(res, out);
});

// ---- Reviews moderation ----
router.get('/reviews', async (req, res) => {
  const f = parse(paginationSchema, req.query);
  const total = (await query('SELECT COUNT(*) AS n FROM reviews')).rows[0].n;
  const { rows } = await query(`SELECT r.id, r.rating, r.comment, r.status, r.created_at, cu.name AS customer_name, pu.name AS provider_name
    FROM reviews r JOIN users cu ON cu.id = r.customer_id JOIN users pu ON pu.id = r.provider_id
    ORDER BY r.created_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});
router.patch('/reviews/:id', async (req, res) => {
  const id = idParam(req);
  const d = parse(z.object({ status: z.enum(['VISIBLE', 'HIDDEN']) }), req.body);
  await withTransaction(async (c) => {
    const r = (await c.query('UPDATE reviews SET status = $2 WHERE id = $1 RETURNING provider_id', [id, d.status])).rows[0];
    if (!r) throw notFound('Review not found');
    await refreshProviderRating(c, r.provider_id);
    await audit(req.user, `review.${d.status.toLowerCase()}`, 'review', id, {}, req, c);
  });
  res.status(204).end();
});

// ---- Reports ----
router.get('/reports', async (req, res) => {
  const f = parse(paginationSchema.extend({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional() }), req.query);
  const params = []; let w = '';
  if (f.status) { params.push(f.status); w = 'WHERE r.status = $1'; }
  const total = (await query(`SELECT COUNT(*) AS n FROM reports r ${w}`, params)).rows[0].n;
  const { rows } = await query(`SELECT r.*, ru.name AS reporter_name, tu.name AS reported_name, tu.role AS reported_role, tu.status AS reported_status
    FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN users tu ON tu.id = r.reported_user_id
    ${w} ORDER BY r.created_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});
router.patch('/reports/:id', async (req, res) => {
  const id = idParam(req);
  const d = parse(z.object({ status: z.enum(['RESOLVED', 'DISMISSED']) }), req.body);
  const r = await query(`UPDATE reports SET status = $2, resolved_by = $3 WHERE id = $1`, [id, d.status, req.user.id]);
  if (!r.rowCount) throw notFound('Report not found');
  await audit(req.user, `report.${d.status.toLowerCase()}`, 'report', id, {}, req);
  res.status(204).end();
});

// ---- Audit log + settings ----
router.get('/audit-logs', async (req, res) => {
  const f = parse(paginationSchema.extend({ action: z.string().trim().max(60).optional() }), req.query);
  const params = []; let w = '';
  if (f.action) { params.push(`${f.action}%`); w = 'WHERE a.action LIKE $1'; }
  const total = (await query(`SELECT COUNT(*) AS n FROM audit_logs a ${w}`, params)).rows[0].n;
  const { rows } = await query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip, a.created_at, u.name AS actor_name, u.role AS actor_role
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${w} ORDER BY a.id DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

router.get('/settings', async (_req, res) => {
  const rows = (await query('SELECT key, value FROM platform_settings')).rows;
  ok(res, Object.fromEntries(rows.map((r) => [r.key, r.value])));
});
router.put('/settings', async (req, res) => {
  const d = parse(z.object({ platform_fee_percent: z.number().min(0).max(50) }), req.body);
  await query(`INSERT INTO platform_settings (key, value) VALUES ('platform_fee_percent', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(d.platform_fee_percent)]);
  await audit(req.user, 'settings.update', 'settings', 'platform_fee_percent', d, req);
  ok(res, d);
});

export default router;
