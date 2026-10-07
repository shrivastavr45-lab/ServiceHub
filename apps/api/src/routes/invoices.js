import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { parse, ok, created, idParam, paginationSchema, pageMeta, uuid } from '../lib/http.js';
import { notFound, conflict, forbidden, badRequest } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';
import { formatPaise } from '@servicehub/shared';
import * as svc from '../services/bookingService.js';

const router = Router();
const paise = z.number().int().min(0).max(100_000_000);

const invoiceSchema = z.object({
  booking_id: uuid,
  description: z.string().trim().max(1000).optional(),
  items: z.array(z.object({
    description: z.string().trim().min(1).max(200),
    quantity: z.number().positive().max(10000),
    unit_price_paise: paise,
  })).max(30).optional(),
  additional_charges_paise: paise.default(0),
  discount_paise: paise.default(0),
  tax_percent: z.number().min(0).max(100).default(0),
});

// Pure calculation: easy to unit test.
export function computeTotals(items, additional, discount, taxPercent) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.quantity * i.unit_price_paise), 0);
  const taxable = subtotal + additional - discount;
  if (taxable < 0) throw badRequest('Discount cannot exceed subtotal plus additional charges');
  const tax = Math.round((taxable * taxPercent) / 100);
  return { subtotal, tax, total: taxable + tax };
}

router.post('/', requireRole('SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(invoiceSchema, req.body);
  const inv = await withTransaction(async (c) => {
    const b = await svc.lockBooking(c, d.booking_id, req.user);
    svc.assertParty(b, req.user, 'SERVICE_PROVIDER');
    if (b.status !== 'COMPLETED') throw conflict('An invoice can only be generated for a completed job', 'BOOKING_NOT_COMPLETED');
    if ((await c.query('SELECT 1 FROM invoices WHERE booking_id = $1', [b.id])).rowCount) throw conflict('Invoice already exists for this booking', 'INVOICE_EXISTS');
    const items = d.items?.length ? d.items : [{ description: b.service_name, quantity: 1, unit_price_paise: b.agreed_price_paise }];
    const { subtotal, tax, total } = computeTotals(items, d.additional_charges_paise, d.discount_paise, d.tax_percent);
    const cust = (await c.query(`SELECT u.name, u.email, u.phone, cp.address, cp.city, cp.pincode FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.id = $1`, [b.customer_id])).rows[0];
    const prov = (await c.query(`SELECT u.name, u.email, u.phone, pp.city, pp.gstin FROM users u JOIN provider_profiles pp ON pp.user_id = u.id WHERE u.id = $1`, [b.provider_id])).rows[0];
    const seq = (await c.query(`SELECT nextval('invoice_number_seq') AS n`)).rows[0].n;
    const number = `INV-${new Date().getFullYear()}-${seq}`;
    const row = (await c.query(`INSERT INTO invoices (booking_id, invoice_number, customer_snapshot, provider_snapshot, service_name, description,
      subtotal_paise, additional_charges_paise, discount_paise, tax_percent, tax_paise, total_paise)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.id, number, JSON.stringify({ ...cust, address: cust.address || b.address, city: cust.city || b.city }), JSON.stringify(prov),
        b.service_name, d.description ?? b.description, subtotal, d.additional_charges_paise, d.discount_paise, d.tax_percent, tax, total])).rows[0];
    for (const i of items) await c.query(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_paise, amount_paise) VALUES ($1,$2,$3,$4,$5)`,
      [row.id, i.description, i.quantity, i.unit_price_paise, Math.round(i.quantity * i.unit_price_paise)]);
    await notify(b.customer_id, 'INVOICE_CREATED', 'Invoice ready', `${number} for ${formatPaise(total)}`, { booking_id: b.id, invoice_id: row.id }, c);
    return row;
  });
  created(res, inv);
});

router.get('/', async (req, res) => {
  const f = parse(paginationSchema, req.query);
  const col = req.user.role === 'CUSTOMER' ? 'b.customer_id' : req.user.role === 'SERVICE_PROVIDER' ? 'b.provider_id' : null;
  const where = col ? `WHERE ${col} = $1` : '';
  const params = col ? [req.user.id] : [];
  const total = (await query(`SELECT COUNT(*) AS n FROM invoices i JOIN bookings b ON b.id = i.booking_id ${where}`, params)).rows[0].n;
  const { rows } = await query(`SELECT i.id, i.invoice_number, i.booking_id, i.service_name, i.total_paise, i.payment_status, i.issued_at,
      cu.name AS customer_name, pu.name AS provider_name
    FROM invoices i JOIN bookings b ON b.id = i.booking_id JOIN users cu ON cu.id = b.customer_id JOIN users pu ON pu.id = b.provider_id
    ${where} ORDER BY i.issued_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  const inv = (await query(`SELECT i.*, b.customer_id, b.provider_id FROM invoices i JOIN bookings b ON b.id = i.booking_id WHERE i.id = $1`, [id])).rows[0];
  if (!inv || (req.user.role !== 'ADMIN' && inv.customer_id !== req.user.id && inv.provider_id !== req.user.id)) throw notFound('Invoice not found');
  const items = (await query('SELECT description, quantity, unit_price_paise, amount_paise FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [id])).rows;
  const payments = (await query('SELECT id, amount_paise, method, status, reference, paid_at FROM payments WHERE invoice_id = $1 ORDER BY created_at', [id])).rows;
  ok(res, { ...inv, items, payments });
});

export default router;

// ---------- Payments: record-only (no gateway yet) ----------
export const paymentsRouter = Router();

paymentsRouter.post('/', requireRole('CUSTOMER', 'SERVICE_PROVIDER'), async (req, res) => {
  const d = parse(z.object({
    invoice_id: uuid, method: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER']), reference: z.string().trim().max(100).optional(),
  }), req.body);
  const p = await withTransaction(async (c) => {
    const inv = (await c.query(`SELECT i.*, b.customer_id, b.provider_id FROM invoices i JOIN bookings b ON b.id = i.booking_id WHERE i.id = $1 FOR UPDATE OF i`, [d.invoice_id])).rows[0];
    if (!inv || (inv.customer_id !== req.user.id && inv.provider_id !== req.user.id)) throw notFound('Invoice not found');
    if (inv.payment_status === 'PAID') throw conflict('Invoice is already paid', 'ALREADY_PAID');
    if (inv.total_paise <= 0) throw badRequest('Nothing to pay on a zero-value invoice');
    const pay = (await c.query(`INSERT INTO payments (booking_id, invoice_id, amount_paise, method, status, reference, recorded_by)
      VALUES ($1,$2,$3,$4,'PAID',$5,$6) RETURNING *`, [inv.booking_id, inv.id, inv.total_paise, d.method, d.reference ?? null, req.user.id])).rows[0];
    await c.query(`UPDATE invoices SET payment_status = 'PAID' WHERE id = $1`, [inv.id]);
    const other = inv.customer_id === req.user.id ? inv.provider_id : inv.customer_id;
    await notify(other, 'PAYMENT_UPDATE', 'Payment recorded', `${inv.invoice_number} marked paid via ${d.method} (${formatPaise(inv.total_paise)})`, { invoice_id: inv.id, booking_id: inv.booking_id }, c);
    return pay;
  });
  created(res, p);
});

paymentsRouter.get('/', async (req, res) => {
  const f = parse(paginationSchema, req.query);
  const col = req.user.role === 'CUSTOMER' ? 'b.customer_id' : req.user.role === 'SERVICE_PROVIDER' ? 'b.provider_id' : null;
  const where = col ? `WHERE ${col} = $1` : '';
  const params = col ? [req.user.id] : [];
  const total = (await query(`SELECT COUNT(*) AS n FROM payments p JOIN bookings b ON b.id = p.booking_id ${where}`, params)).rows[0].n;
  const { rows } = await query(`SELECT p.id, p.amount_paise, p.method, p.status, p.reference, p.paid_at, i.invoice_number, p.invoice_id, b.service_name
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN bookings b ON b.id = p.booking_id
    ${where} ORDER BY p.created_at DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});
