import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { parse, ok, created, idParam, paginationSchema, pageMeta, uuid } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { storage, sniffImage } from '../lib/storage.js';
import { notify } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import * as svc from '../services/bookingService.js';

const amount = z.number().int().positive().max(100_000_000); // paise
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ---------- helpers ----------
async function listFor(req, res, extraWhere = '', extraParams = []) {
  const f = parse(paginationSchema.extend({ status: z.string().optional() }), req.query);
  const u = req.user;
  const params = [];
  const where = [];
  if (u.role === 'CUSTOMER') { params.push(u.id); where.push(`b.customer_id = $${params.length}`); }
  else if (u.role === 'SERVICE_PROVIDER') { params.push(u.id); where.push(`b.provider_id = $${params.length}`); }
  if (f.status) { const sts = f.status.split(',').filter(Boolean); params.push(sts); where.push(`b.status = ANY($${params.length})`); }
  if (extraWhere) where.push(extraWhere);
  params.push(...extraParams);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT COUNT(*) AS n FROM bookings b ${w}`, params)).rows[0].n;
  params.push(f.limit, (f.page - 1) * f.limit);
  const { rows } = await query(`
    SELECT b.id, b.status, b.service_name, b.category_name, b.description, b.city, b.preferred_at, b.scheduled_at,
      b.agreed_price_paise, b.listed_price_paise, b.created_at, b.updated_at,
      b.customer_id, cu.name AS customer_name, b.provider_id, pu.name AS provider_name,
      (SELECT amount_paise FROM price_offers o WHERE o.booking_id = b.id AND o.status = 'PENDING') AS pending_offer_paise,
      (SELECT offered_by FROM price_offers o WHERE o.booking_id = b.id AND o.status = 'PENDING') AS pending_offer_by,
      i.id AS invoice_id, i.payment_status, (r.id IS NOT NULL) AS reviewed
    FROM bookings b JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id
    LEFT JOIN invoices i ON i.booking_id = b.id LEFT JOIN reviews r ON r.booking_id = b.id
    ${w} ORDER BY b.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
}

// ---------- /api/requests : customers create service requests; list = same as bookings ----------
export const requestsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

const requestSchema = z.object({
  provider_service_id: uuid,
  description: z.string().trim().min(10, 'Please describe the work (at least 10 characters)').max(2000),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  pincode: z.string().trim().regex(/^[0-9]{4,10}$/).optional().or(z.literal('').transform(() => undefined)),
  preferred_at: z.string().datetime({ offset: true }).optional().or(z.literal('').transform(() => undefined)),
});

requestsRouter.post('/', requireRole('CUSTOMER'), upload.array('images', 5), async (req, res) => {
  const d = parse(requestSchema, req.body);
  if (d.preferred_at && new Date(d.preferred_at) < new Date()) throw badRequest('Preferred time must be in the future');
  // Validate files by content before touching the DB.
  const files = (req.files || []).map((f) => {
    const kind = sniffImage(f.buffer);
    if (!kind) throw badRequest(`"${f.originalname}" is not a valid JPEG, PNG or WebP image`);
    return { buf: f.buffer, kind, name: f.originalname.slice(0, 120) };
  });
  const ps = (await query(`SELECT ps.id, ps.provider_id, ps.price_paise, s.name AS service_name, c.name AS category_name
    FROM provider_services ps JOIN services s ON s.id = ps.service_id JOIN categories c ON c.id = s.category_id
    JOIN provider_profiles pp ON pp.user_id = ps.provider_id JOIN users u ON u.id = ps.provider_id
    WHERE ps.id = $1 AND ps.is_active AND s.is_active AND pp.verification_status = 'APPROVED' AND u.status = 'ACTIVE'`, [d.provider_service_id])).rows[0];
  if (!ps) throw notFound('This service is not available');
  if (ps.provider_id === req.user.id) throw badRequest('You cannot book yourself');

  const keys = [];
  try {
    for (const f of files) keys.push({ key: await storage.save(f.buf, f.kind.ext), f });
    const booking = await withTransaction(async (c) => {
      const b = (await c.query(`INSERT INTO bookings (customer_id, provider_id, provider_service_id, service_name, category_name, listed_price_paise,
        description, address, city, pincode, preferred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.user.id, ps.provider_id, ps.id, ps.service_name, ps.category_name, ps.price_paise, d.description, d.address, d.city, d.pincode ?? null, d.preferred_at ?? null])).rows[0];
      for (const k of keys) await c.query(`INSERT INTO booking_attachments (booking_id, file_key, original_name, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5)`,
        [b.id, k.key, k.f.name, k.f.kind.mime, k.f.buf.length]);
      await c.query(`INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES ($1,NULL,'REQUESTED',$2,'Service requested')`, [b.id, req.user.id]);
      await notify(ps.provider_id, 'NEW_REQUEST', 'New service request', `${req.user.name} requested ${ps.service_name}`, { booking_id: b.id }, c);
      return b;
    });
    created(res, booking);
  } catch (e) {
    await Promise.all(keys.map((k) => storage.remove(k.key))); // don't leave orphan files
    throw e;
  }
});

requestsRouter.get('/', (req, res) => listFor(req, res));

// ---------- /api/quotations ----------
export const quotationsRouter = Router();
quotationsRouter.post('/', requireRole('SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(z.object({ booking_id: uuid, amount_paise: amount, message: z.string().trim().max(500).optional() }), req.body);
  const b = await withTransaction((c) => svc.quote(c, d.booking_id, req.user, d.amount_paise, d.message));
  created(res, b);
});

// ---------- /api/negotiations (history + counter/accept/reject) ----------
export const negotiationsRouter = Router();
negotiationsRouter.get('/:bookingId', async (req, res) => {
  const id = idParam(req, 'bookingId');
  const b = (await query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0];
  if (!b || (req.user.role !== 'ADMIN' && b.customer_id !== req.user.id && b.provider_id !== req.user.id)) throw notFound('Booking not found');
  const offers = (await query(`SELECT o.*, u.name AS offered_by_name FROM price_offers o JOIN users u ON u.id = o.offered_by WHERE booking_id = $1 ORDER BY created_at, id`, [id])).rows;
  ok(res, { booking_id: id, status: b.status, agreed_price_paise: b.agreed_price_paise, offers });
});
negotiationsRouter.post('/:bookingId/counter', requireRole('CUSTOMER', 'SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(z.object({ amount_paise: amount, message: z.string().trim().max(500).optional() }), req.body);
  ok(res, await withTransaction((c) => svc.counter(c, idParam(req, 'bookingId'), req.user, d.amount_paise, d.message)));
});
negotiationsRouter.post('/:bookingId/accept', requireRole('CUSTOMER', 'SERVICE_PROVIDER'), async (req, res) => {
  ok(res, await withTransaction((c) => svc.acceptOffer(c, idParam(req, 'bookingId'), req.user)));
});
negotiationsRouter.post('/:bookingId/reject', requireRole('CUSTOMER', 'SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(reasonSchema.partial(), req.body);
  ok(res, await withTransaction((c) => svc.rejectOffer(c, idParam(req, 'bookingId'), req.user, d.reason)));
});

// ---------- /api/bookings ----------
const router = Router();
router.get('/', (req, res) => listFor(req, res));

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  const b = (await query(`SELECT b.*, cu.name AS customer_name, cu.phone AS customer_phone, pu.name AS provider_name, pu.phone AS provider_phone
    FROM bookings b JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id WHERE b.id = $1`, [id])).rows[0];
  if (!b || (req.user.role !== 'ADMIN' && b.customer_id !== req.user.id && b.provider_id !== req.user.id)) throw notFound('Booking not found');
  // Contact numbers are only revealed once a price is agreed.
  if (!b.agreed_price_paise && req.user.role !== 'ADMIN') { b.customer_phone = null; b.provider_phone = null; }
  const [offers, history, atts, invoice, review, dispute] = await Promise.all([
    query(`SELECT o.id, o.offered_by, o.offered_by_role, o.amount_paise, o.message, o.status, o.created_at, u.name AS offered_by_name
      FROM price_offers o JOIN users u ON u.id = o.offered_by WHERE o.booking_id = $1 ORDER BY o.created_at, o.id`, [id]),
    query(`SELECT h.from_status, h.to_status, h.note, h.created_at, u.name AS changed_by_name FROM booking_status_history h
      LEFT JOIN users u ON u.id = h.changed_by WHERE h.booking_id = $1 ORDER BY h.id`, [id]),
    query('SELECT id, file_key, original_name, mime_type FROM booking_attachments WHERE booking_id = $1', [id]),
    query('SELECT id, invoice_number, total_paise, payment_status FROM invoices WHERE booking_id = $1', [id]),
    query('SELECT id, rating, comment, created_at FROM reviews WHERE booking_id = $1', [id]),
    query('SELECT id, reason, description, status, resolution, created_at FROM disputes WHERE booking_id = $1 ORDER BY created_at DESC', [id]),
  ]);
  ok(res, {
    ...b, offers: offers.rows, history: history.rows,
    attachments: atts.rows.map((a) => ({ id: a.id, name: a.original_name, mime_type: a.mime_type, url: storage.url(a.file_key) })),
    invoice: invoice.rows[0] ?? null, review: review.rows[0] ?? null, disputes: dispute.rows,
  });
});

const tx = (fn) => async (req, res) => ok(res, await withTransaction((c) => fn(c, req)));
router.post('/:id/reject', requireRole('SERVICE_PROVIDER'), async (req, res) => {
  // Provider declines a fresh request (REQUESTED -> CANCELLED).
  const d = parse(reasonSchema.partial(), req.body);
  ok(res, await withTransaction(async (c) => {
    const b = await svc.lockBooking(c, idParam(req), req.user);
    svc.assertParty(b, req.user, 'SERVICE_PROVIDER');
    if (b.status !== 'REQUESTED') throw badRequest('Only new requests can be declined; use cancel instead');
    return svc.cancel(c, b, req.user, d.reason || 'Declined by provider', true);
  }));
});
router.post('/:id/cancel', requireRole('CUSTOMER', 'SERVICE_PROVIDER', 'ADMIN'), async (req, res) => {
  const d = parse(reasonSchema, req.body);
  ok(res, await withTransaction(async (c) => {
    const b = await svc.lockBooking(c, idParam(req), req.user);
    const r = await svc.cancel(c, b, req.user, d.reason, true);
    if (req.user.role === 'ADMIN') await audit(req.user, 'booking.cancel', 'booking', b.id, { reason: d.reason }, req, c);
    return r;
  }));
});
router.post('/:id/schedule', requireRole('SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(z.object({ scheduled_at: z.string().datetime({ offset: true }).optional() }), req.body);
  ok(res, await withTransaction((c) => svc.schedule(c, idParam(req), req.user, d.scheduled_at)));
});
router.post('/:id/start', requireRole('SERVICE_PROVIDER'), tx((c, req) => svc.start(c, idParam(req), req.user)));
router.post('/:id/complete', requireRole('SERVICE_PROVIDER'), tx((c, req) => svc.complete(c, idParam(req), req.user)));

export default router;
