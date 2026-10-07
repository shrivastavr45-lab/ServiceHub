import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { parse, ok, created, idParam, paginationSchema, pageMeta, uuid } from '../lib/http.js';
import { notFound, conflict, forbidden } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import * as svc from '../services/bookingService.js';

const router = Router();
const DISPUTE_WINDOW_DAYS = 14;

router.post('/', requireRole('CUSTOMER', 'SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(z.object({
    booking_id: uuid,
    reason: z.enum(['WORK_INCOMPLETE', 'WRONG_PRICE', 'PAYMENT_ISSUE', 'SERVICE_QUALITY', 'CANCELLATION', 'OTHER']),
    description: z.string().trim().min(10).max(2000),
  }), req.body);
  const dispute = await withTransaction(async (c) => {
    const b = await svc.lockBooking(c, d.booking_id, req.user);
    if (b.status === 'COMPLETED' && b.completed_at && Date.now() - new Date(b.completed_at) > DISPUTE_WINDOW_DAYS * 86400_000)
      throw conflict(`Disputes can only be raised within ${DISPUTE_WINDOW_DAYS} days of completion`, 'DISPUTE_WINDOW_CLOSED');
    await svc.transition(c, b, 'DISPUTED', req.user, { note: `Dispute raised: ${d.reason}` }); // throws on invalid state
    const row = (await c.query(`INSERT INTO disputes (booking_id, raised_by, reason, description) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.id, req.user.id, d.reason, d.description])).rows[0];
    await notify(svc.otherParty(b, req.user), 'DISPUTE_RAISED', 'Dispute raised', `A dispute was raised on ${b.service_name}`, { booking_id: b.id, dispute_id: row.id }, c);
    await audit(req.user, 'dispute.create', 'dispute', row.id, { booking_id: b.id }, req, c);
    return row;
  });
  created(res, dispute);
});

router.get('/', async (req, res) => {
  const f = parse(paginationSchema.extend({ status: z.enum(['OPEN', 'RESOLVED']).optional() }), req.query);
  const params = [];
  const where = [];
  if (req.user.role !== 'ADMIN') { params.push(req.user.id); where.push(`(b.customer_id = $1 OR b.provider_id = $1)`); }
  if (f.status) { params.push(f.status); where.push(`d.status = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT COUNT(*) AS n FROM disputes d JOIN bookings b ON b.id = d.booking_id ${w}`, params)).rows[0].n;
  const { rows } = await query(`SELECT d.*, b.service_name, cu.name AS customer_name, pu.name AS provider_name, ru.name AS raised_by_name
    FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id JOIN users ru ON ru.id = d.raised_by
    ${w} ORDER BY d.created_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(`SELECT d.*, b.customer_id, b.provider_id, b.service_name FROM disputes d JOIN bookings b ON b.id = d.booking_id WHERE d.id = $1`, [idParam(req)]);
  const d = rows[0];
  if (!d || (req.user.role !== 'ADMIN' && d.customer_id !== req.user.id && d.provider_id !== req.user.id)) throw notFound('Dispute not found');
  ok(res, d);
});

export default router;

// ---------- Reports of users ----------
export const reportsRouter = Router();
reportsRouter.post('/', requireRole('CUSTOMER', 'SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(z.object({ reported_user_id: uuid, reason: z.string().trim().min(3).max(100), details: z.string().trim().max(2000).optional() }), req.body);
  if (d.reported_user_id === req.user.id) throw forbidden('You cannot report yourself');
  const target = (await query('SELECT id, role FROM users WHERE id = $1', [d.reported_user_id])).rows[0];
  if (!target || target.role === 'ADMIN') throw notFound('User not found');
  const { rows } = await query(`INSERT INTO reports (reporter_id, reported_user_id, reason, details) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, d.reported_user_id, d.reason, d.details ?? null]);
  created(res, rows[0]);
});
