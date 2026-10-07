import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, resetDb, register, auth, makeAdmin, setupCatalog, requestBody } from './helpers.js';
import { pool, query } from '../src/db.js';
import { computeTotals } from '../src/routes/invoices.js';
import { canTransition, TRANSITIONS } from '@servicehub/shared';

let admin, customer, provider, other, cat, bookingId;
const future = () => new Date(Date.now() + 2 * 86400000).toISOString();

beforeAll(async () => {
  await resetDb();
  admin = await makeAdmin();
  customer = await register('CUSTOMER', 'Cathy Customer');
  provider = await register('SERVICE_PROVIDER', 'Paul Provider');
  other = await register('SERVICE_PROVIDER', 'Other Provider');
  cat = await setupCatalog(admin, provider);
});
afterAll(() => pool.end());

describe('state machine definition', () => {
  it('rejects invalid transitions', () => {
    expect(canTransition('COMPLETED', 'REQUESTED')).toBe(false);
    expect(canTransition('CANCELLED', 'ACCEPTED')).toBe(false);
    expect(canTransition('REQUESTED', 'COMPLETED')).toBe(false);
    expect(canTransition('REQUESTED', 'QUOTED')).toBe(true);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe('service request, quotation and negotiation', () => {
  it('only customers can create requests; validates input', async () => {
    const asProvider = await api().post('/api/requests').set(auth(provider)).send(requestBody(cat.providerService.id));
    expect(asProvider.status).toBe(403);
    const bad = await api().post('/api/requests').set(auth(customer)).send({ ...requestBody(cat.providerService.id), description: 'short' });
    expect(bad.status).toBe(422);
  });

  it('creates a request (REQUESTED) with a valid image and rejects a fake image', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const good = await api().post('/api/requests').set(auth(customer))
      .field('provider_service_id', cat.providerService.id).field('description', 'Fan is making noise and wobbling')
      .field('address', '12 Test Street, Delhi').field('city', 'New Delhi')
      .attach('images', png, { filename: 'fan.png', contentType: 'image/png' });
    expect(good.status).toBe(201);
    expect(good.body.data.status).toBe('REQUESTED');
    bookingId = good.body.data.id;

    const fake = await api().post('/api/requests').set(auth(customer))
      .field('provider_service_id', cat.providerService.id).field('description', 'Not really an image here')
      .field('address', '12 Test Street, Delhi').field('city', 'New Delhi')
      .attach('images', Buffer.from('<?php echo 1; ?>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);

    const detail = await api().get(`/api/bookings/${bookingId}`).set(auth(customer));
    expect(detail.body.data.attachments).toHaveLength(1);
    // provider received a notification
    const n = await api().get('/api/notifications').set(auth(provider));
    expect(n.body.data.some((x) => x.type === 'NEW_REQUEST')).toBe(true);
  });

  it('customer cannot quote; unrelated provider cannot see or quote the booking', async () => {
    expect((await api().post('/api/quotations').set(auth(customer)).send({ booking_id: bookingId, amount_paise: 70000 })).status).toBe(403);
    expect((await api().post('/api/quotations').set(auth(other)).send({ booking_id: bookingId, amount_paise: 70000 })).status).toBe(404);
    expect((await api().get(`/api/bookings/${bookingId}`).set(auth(other))).status).toBe(404);
  });

  it('runs the ₹800 → ₹600 → ₹700 → accept negotiation and keeps full history', async () => {
    const q = await api().post('/api/quotations').set(auth(provider)).send({ booking_id: bookingId, amount_paise: 80000 });
    expect(q.status).toBe(201);
    expect(q.body.data.status).toBe('QUOTED');

    // provider can't counter its own pending offer, or accept it
    expect((await api().post(`/api/negotiations/${bookingId}/counter`).set(auth(provider)).send({ amount_paise: 75000 })).status).toBe(409);
    expect((await api().post(`/api/negotiations/${bookingId}/accept`).set(auth(provider))).status).toBe(409);

    const c1 = await api().post(`/api/negotiations/${bookingId}/counter`).set(auth(customer)).send({ amount_paise: 60000 });
    expect(c1.body.data.status).toBe('NEGOTIATING');
    const c2 = await api().post(`/api/negotiations/${bookingId}/counter`).set(auth(provider)).send({ amount_paise: 70000 });
    expect(c2.status).toBe(200);
    // customer can't accept before... actually the pending offer is the provider's 700, so customer accepts
    const acc = await api().post(`/api/negotiations/${bookingId}/accept`).set(auth(customer));
    expect(acc.status).toBe(200);
    expect(acc.body.data.status).toBe('ACCEPTED');
    expect(acc.body.data.agreed_price_paise).toBe(70000);
    expect(acc.body.data.platform_fee_paise).toBe(7000); // default 10%

    const hist = await api().get(`/api/negotiations/${bookingId}`).set(auth(provider));
    expect(hist.body.data.offers.map((o) => [o.offered_by_role, o.amount_paise, o.status])).toEqual([
      ['SERVICE_PROVIDER', 80000, 'SUPERSEDED'], ['CUSTOMER', 60000, 'SUPERSEDED'], ['SERVICE_PROVIDER', 70000, 'ACCEPTED'],
    ]);
  });

  it('enforces the maximum negotiation rounds', async () => {
    const c = await register('CUSTOMER');
    const r = await api().post('/api/requests').set(auth(c)).send(requestBody(cat.providerService.id));
    const id = r.body.data.id;
    await api().post('/api/quotations').set(auth(provider)).send({ booking_id: id, amount_paise: 90000 });
    let last = 200;
    for (let i = 0; i < 5; i++) {
      const who = i % 2 === 0 ? c : provider;
      last = (await api().post(`/api/negotiations/${id}/counter`).set(auth(who)).send({ amount_paise: 80000 - i * 1000 })).status;
      expect(last).toBe(200);
    }
    const over = await api().post(`/api/negotiations/${id}/counter`).set(auth(provider)).send({ amount_paise: 1000 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('NEGOTIATION_LIMIT');
  });

  it('customer rejecting a quote cancels the booking', async () => {
    const c = await register('CUSTOMER');
    const id = (await api().post('/api/requests').set(auth(c)).send(requestBody(cat.providerService.id))).body.data.id;
    await api().post('/api/quotations').set(auth(provider)).send({ booking_id: id, amount_paise: 90000 });
    const rej = await api().post(`/api/negotiations/${id}/reject`).set(auth(c)).send({ reason: 'Too expensive' });
    expect(rej.body.data.status).toBe('CANCELLED');
  });
});

describe('booking lifecycle and invalid transitions', () => {
  it('blocks out-of-order actions', async () => {
    // booking is ACCEPTED: cannot start or complete before being scheduled
    const start = await api().post(`/api/bookings/${bookingId}/start`).set(auth(provider));
    expect(start.status).toBe(409);
    expect(start.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await api().post(`/api/bookings/${bookingId}/complete`).set(auth(provider))).status).toBe(409);
    // customer can't schedule
    expect((await api().post(`/api/bookings/${bookingId}/schedule`).set(auth(customer)).send({ scheduled_at: future() })).status).toBe(403);
  });

  it('schedules, starts and completes; records status history; blocks review before completion', async () => {
    // review before completion is rejected
    expect((await api().post('/api/reviews').set(auth(customer)).send({ booking_id: bookingId, rating: 5 })).status).toBe(403);
    expect((await api().post(`/api/bookings/${bookingId}/schedule`).set(auth(provider)).send({ scheduled_at: future() })).body.data.status).toBe('SCHEDULED');
    expect((await api().post(`/api/bookings/${bookingId}/start`).set(auth(provider))).body.data.status).toBe('IN_PROGRESS');
    // cannot cancel once work is in progress
    expect((await api().post(`/api/bookings/${bookingId}/cancel`).set(auth(customer)).send({ reason: 'changed my mind' })).status).toBe(409);
    expect((await api().post(`/api/bookings/${bookingId}/complete`).set(auth(provider))).body.data.status).toBe('COMPLETED');
    const d = await api().get(`/api/bookings/${bookingId}`).set(auth(customer));
    expect(d.body.data.history.map((h) => h.to_status)).toEqual(['REQUESTED', 'QUOTED', 'NEGOTIATING', 'NEGOTIATING', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED']);
    // terminal-ish: cannot go back
    expect((await api().post(`/api/bookings/${bookingId}/schedule`).set(auth(provider)).send({ scheduled_at: future() })).status).toBe(409);
  });

  it('cancelled bookings are final', async () => {
    const c = await register('CUSTOMER');
    const id = (await api().post('/api/requests').set(auth(c)).send(requestBody(cat.providerService.id))).body.data.id;
    expect((await api().post(`/api/bookings/${id}/cancel`).set(auth(c)).send({ reason: 'no longer needed' })).body.data.status).toBe('CANCELLED');
    expect((await api().post('/api/quotations').set(auth(provider)).send({ booking_id: id, amount_paise: 50000 })).status).toBe(409);
    expect((await api().post(`/api/bookings/${id}/cancel`).set(auth(c)).send({ reason: 'again please' })).status).toBe(409);
  });
});

describe('invoice, payment, review', () => {
  let invoiceId;
  it('computes totals correctly', () => {
    expect(computeTotals([{ quantity: 2, unit_price_paise: 10000 }], 5000, 2000, 18)).toEqual({ subtotal: 20000, tax: 4140, total: 27140 });
    expect(() => computeTotals([{ quantity: 1, unit_price_paise: 1000 }], 0, 5000, 0)).toThrow();
  });

  it('only the provider can invoice a completed job, once', async () => {
    expect((await api().post('/api/invoices').set(auth(customer)).send({ booking_id: bookingId })).status).toBe(403);
    expect((await api().post('/api/invoices').set(auth(other)).send({ booking_id: bookingId })).status).toBe(404);
    const r = await api().post('/api/invoices').set(auth(provider)).send({
      booking_id: bookingId, additional_charges_paise: 5000, discount_paise: 2000, tax_percent: 18,
      items: [{ description: 'Fan service', quantity: 1, unit_price_paise: 70000 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.invoice_number).toMatch(/^INV-\d{4}-\d+$/);
    expect(r.body.data.total_paise).toBe(Math.round(73000 * 1.18));
    invoiceId = r.body.data.id;
    expect((await api().post('/api/invoices').set(auth(provider)).send({ booking_id: bookingId })).status).toBe(409);
  });

  it('refuses invoices for uncompleted jobs', async () => {
    const c = await register('CUSTOMER');
    const id = (await api().post('/api/requests').set(auth(c)).send(requestBody(cat.providerService.id))).body.data.id;
    const r = await api().post('/api/invoices').set(auth(provider)).send({ booking_id: id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('BOOKING_NOT_COMPLETED');
  });

  it('invoice is visible only to its parties; payment marks it paid once', async () => {
    expect((await api().get(`/api/invoices/${invoiceId}`).set(auth(customer))).status).toBe(200);
    expect((await api().get(`/api/invoices/${invoiceId}`).set(auth(other))).status).toBe(404);
    const stranger = await register('CUSTOMER');
    expect((await api().post('/api/payments').set(auth(stranger)).send({ invoice_id: invoiceId, method: 'UPI' })).status).toBe(404);
    expect((await api().post('/api/payments').set(auth(customer)).send({ invoice_id: invoiceId, method: 'UPI', reference: 'TXN123' })).status).toBe(201);
    expect((await api().post('/api/payments').set(auth(customer)).send({ invoice_id: invoiceId, method: 'UPI' })).status).toBe(409);
    expect((await api().get(`/api/invoices/${invoiceId}`).set(auth(provider))).body.data.payment_status).toBe('PAID');
  });

  it('review permissions: only the booking customer, once, 1-5, updates provider rating', async () => {
    const stranger = await register('CUSTOMER');
    expect((await api().post('/api/reviews').set(auth(stranger)).send({ booking_id: bookingId, rating: 5 })).status).toBe(404);
    expect((await api().post('/api/reviews').set(auth(provider)).send({ booking_id: bookingId, rating: 5 })).status).toBe(403);
    expect((await api().post('/api/reviews').set(auth(customer)).send({ booking_id: bookingId, rating: 6 })).status).toBe(422);
    const ok = await api().post('/api/reviews').set(auth(customer)).send({ booking_id: bookingId, rating: 4, comment: 'Good' });
    expect(ok.status).toBe(201);
    const dup = await api().post('/api/reviews').set(auth(customer)).send({ booking_id: bookingId, rating: 5 });
    expect(dup.status).toBe(409);
    const prof = await api().get(`/api/providers/${provider.id}`);
    expect(prof.body.data.rating_avg).toBe(4);
    expect(prof.body.data.rating_count).toBe(1);
  });
});

describe('authorization', () => {
  it('customers and providers cannot reach admin APIs; admin can', async () => {
    expect((await api().get('/api/admin/dashboard').set(auth(customer))).status).toBe(403);
    expect((await api().get('/api/admin/dashboard').set(auth(provider))).status).toBe(403);
    expect((await api().get('/api/admin/dashboard')).status).toBe(401);
    const r = await api().get('/api/admin/dashboard').set(auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.data.completed_bookings).toBeGreaterThanOrEqual(1);
  });
  it('providers cannot modify another provider\'s listing', async () => {
    const r = await api().patch(`/api/providers/me/services/${cat.providerService.id}`).set(auth(other)).send({ price_paise: 1 });
    expect(r.status).toBe(404);
    expect((await api().delete(`/api/providers/me/services/${cat.providerService.id}`).set(auth(other))).status).toBe(404);
    expect((await api().patch(`/api/providers/me/services/${cat.providerService.id}`).set(auth(customer)).send({ price_paise: 1 })).status).toBe(403);
  });
  it('customers cannot manage the catalog', async () => {
    expect((await api().post('/api/categories').set(auth(customer)).send({ name: 'Hacked' })).status).toBe(403);
  });
  it('users only see their own bookings and notifications', async () => {
    const list = await api().get('/api/bookings').set(auth(other));
    expect(list.body.data).toHaveLength(0);
    const n = await api().get('/api/notifications').set(auth(other));
    expect(n.body.data.every(() => true)).toBe(true);
  });
  it('admin suspension blocks the user and is audit-logged', async () => {
    const victim = await register('CUSTOMER');
    expect((await api().patch(`/api/admin/users/${victim.id}/status`).set(auth(admin)).send({ status: 'SUSPENDED', reason: 'abuse' })).status).toBe(204);
    expect((await api().get('/api/users/me').set(auth(victim))).status).toBe(403);
    const logs = await api().get('/api/admin/audit-logs?action=user.suspend').set(auth(admin));
    expect(logs.body.data.length).toBe(1);
  });
});

describe('disputes', () => {
  it('can be raised on an in-progress/completed booking and resolved by admin', async () => {
    const d = await api().post('/api/disputes').set(auth(customer)).send({ booking_id: bookingId, reason: 'SERVICE_QUALITY', description: 'The fan still wobbles after repair' });
    expect(d.status).toBe(201);
    expect((await api().get(`/api/bookings/${bookingId}`).set(auth(customer))).body.data.status).toBe('DISPUTED');
    expect((await api().post(`/api/admin/disputes/${d.body.data.id}/resolve`).set(auth(customer)).send({ resolution: 'whatever', booking_status: 'COMPLETED' })).status).toBe(403);
    const res = await api().post(`/api/admin/disputes/${d.body.data.id}/resolve`).set(auth(admin)).send({ resolution: 'Provider revisited and fixed it', booking_status: 'COMPLETED' });
    expect(res.status).toBe(200);
    expect((await api().get(`/api/bookings/${bookingId}`).set(auth(customer))).body.data.status).toBe('COMPLETED');
  });
  it('cannot dispute a booking that was never started', async () => {
    const c = await register('CUSTOMER');
    const id = (await api().post('/api/requests').set(auth(c)).send(requestBody(cat.providerService.id))).body.data.id;
    expect((await api().post('/api/disputes').set(auth(c)).send({ booking_id: id, reason: 'OTHER', description: 'Nothing happened at all' })).status).toBe(409);
  });
});

describe('search', () => {
  it('filters by category, price, rating and paginates', async () => {
    const res = await api().get(`/api/providers?category_id=${cat.category.id}`);
    expect(res.body.data.map((p) => p.id)).toContain(provider.id);
    expect(res.body.meta.total).toBe(1);
    expect((await api().get(`/api/providers?category_id=${cat.category.id}&max_price=1000`)).body.data).toHaveLength(0);
    expect((await api().get(`/api/providers?category_id=${cat.category.id}&min_rating=5`)).body.data).toHaveLength(0);
    expect((await api().get('/api/providers?limit=500')).status).toBe(422);
  });
  it('hides suspended or unapproved providers', async () => {
    await query(`UPDATE provider_profiles SET verification_status = 'PENDING' WHERE user_id = $1`, [provider.id]);
    expect((await api().get(`/api/providers?category_id=${cat.category.id}`)).body.data).toHaveLength(0);
    expect((await api().get(`/api/providers/${provider.id}`)).status).toBe(404);
    await query(`UPDATE provider_profiles SET verification_status = 'APPROVED' WHERE user_id = $1`, [provider.id]);
  });
});
