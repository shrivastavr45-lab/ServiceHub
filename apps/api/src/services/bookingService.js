import { canTransition, MAX_NEGOTIATION_ROUNDS, formatPaise } from '@servicehub/shared';
import { notFound, forbidden, conflict, invalidTransition, badRequest } from '../lib/errors.js';
import { notify } from '../lib/notify.js';

/** Load a booking inside a transaction with a row lock; hides bookings the user is not a party to. */
export async function lockBooking(c, id, user) {
  const { rows } = await c.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  const b = rows[0];
  if (!b) throw notFound('Booking not found');
  if (user.role !== 'ADMIN' && b.customer_id !== user.id && b.provider_id !== user.id) throw notFound('Booking not found');
  return b;
}

export const partyOf = (b, user) => (b.customer_id === user.id ? 'CUSTOMER' : b.provider_id === user.id ? 'SERVICE_PROVIDER' : 'ADMIN');
export const otherParty = (b, user) => (b.customer_id === user.id ? b.provider_id : b.customer_id);

export function assertParty(b, user, role) {
  if (role === 'CUSTOMER' && b.customer_id !== user.id) throw forbidden('Only the customer of this booking can do this');
  if (role === 'SERVICE_PROVIDER' && b.provider_id !== user.id) throw forbidden('Only the provider of this booking can do this');
}

/** The ONLY place a booking status changes. Validates the transition and writes history. */
export async function transition(c, booking, to, user, { note = null, set = {} } = {}) {
  if (!canTransition(booking.status, to)) throw invalidTransition(booking.status, to);
  const cols = { status: to, ...set };
  const keys = Object.keys(cols);
  const sql = `UPDATE bookings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`;
  const { rows } = await c.query(sql, [booking.id, ...keys.map((k) => cols[k])]);
  await c.query(`INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)`,
    [booking.id, booking.status, to, user?.id ?? null, note]);
  return rows[0];
}

export async function getPendingOffer(c, bookingId) {
  return (await c.query(`SELECT * FROM price_offers WHERE booking_id = $1 AND status = 'PENDING'`, [bookingId])).rows[0];
}

/** Provider's first quotation: REQUESTED -> QUOTED. */
export async function quote(c, bookingId, user, amount, message) {
  const b = await lockBooking(c, bookingId, user);
  assertParty(b, user, 'SERVICE_PROVIDER');
  if (b.status !== 'REQUESTED') throw invalidTransition(b.status, 'QUOTED');
  await c.query(`INSERT INTO price_offers (booking_id, offered_by, offered_by_role, amount_paise, message) VALUES ($1,$2,'SERVICE_PROVIDER',$3,$4)`,
    [b.id, user.id, amount, message ?? null]);
  const nb = await transition(c, b, 'QUOTED', user, { note: `Quoted ${formatPaise(amount)}` });
  await notify(b.customer_id, 'QUOTATION_RECEIVED', 'New quotation', `${user.name} quoted ${formatPaise(amount)} for ${b.service_name}`, { booking_id: b.id }, c);
  return nb;
}

/** Counter-offer by whichever party did NOT make the pending offer. History is append-only. */
export async function counter(c, bookingId, user, amount, message) {
  const b = await lockBooking(c, bookingId, user);
  if (user.role === 'ADMIN') throw forbidden();
  if (!['QUOTED', 'NEGOTIATING'].includes(b.status)) throw invalidTransition(b.status, 'NEGOTIATING');
  const pending = await getPendingOffer(c, b.id);
  if (!pending) throw conflict('There is no pending offer to counter');
  if (pending.offered_by === user.id) throw conflict('Wait for the other party to respond to your offer', 'NOT_YOUR_TURN');
  const rounds = (await c.query('SELECT COUNT(*)::int AS n FROM price_offers WHERE booking_id = $1', [b.id])).rows[0].n;
  if (rounds >= MAX_NEGOTIATION_ROUNDS) throw conflict(`Negotiation limit of ${MAX_NEGOTIATION_ROUNDS} offers reached. Accept or cancel.`, 'NEGOTIATION_LIMIT');
  await c.query(`UPDATE price_offers SET status = 'SUPERSEDED', responded_at = now() WHERE id = $1`, [pending.id]);
  await c.query(`INSERT INTO price_offers (booking_id, offered_by, offered_by_role, amount_paise, message) VALUES ($1,$2,$3,$4,$5)`,
    [b.id, user.id, partyOf(b, user), amount, message ?? null]);
  const nb = await transition(c, b, 'NEGOTIATING', user, { note: `Counter-offer ${formatPaise(amount)}` });
  await notify(otherParty(b, user), 'NEGOTIATION_UPDATE', 'Counter-offer received', `${user.name} offered ${formatPaise(amount)} for ${b.service_name}`, { booking_id: b.id }, c);
  return nb;
}

/** Accept the pending offer -> lock the agreed price and fee, move to ACCEPTED. */
export async function acceptOffer(c, bookingId, user) {
  const b = await lockBooking(c, bookingId, user);
  if (user.role === 'ADMIN') throw forbidden();
  if (!['QUOTED', 'NEGOTIATING'].includes(b.status)) throw invalidTransition(b.status, 'ACCEPTED');
  const pending = await getPendingOffer(c, b.id);
  if (!pending) throw conflict('There is no pending offer to accept');
  if (pending.offered_by === user.id) throw conflict('You cannot accept your own offer', 'NOT_YOUR_TURN');
  const feePct = parseFloat((await c.query(`SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'`)).rows[0]?.value ?? '0');
  const fee = Math.round((pending.amount_paise * feePct) / 100);
  await c.query(`UPDATE price_offers SET status = 'ACCEPTED', responded_at = now() WHERE id = $1`, [pending.id]);
  const nb = await transition(c, b, 'ACCEPTED', user, {
    note: `Accepted ${formatPaise(pending.amount_paise)}`,
    set: { agreed_price_paise: pending.amount_paise, platform_fee_percent: feePct, platform_fee_paise: fee },
  });
  await notify(otherParty(b, user), 'BOOKING_ACCEPTED', 'Price agreed', `${user.name} accepted ${formatPaise(pending.amount_paise)} for ${b.service_name}`, { booking_id: b.id }, c);
  return nb;
}

/** Customer rejects the quotation outright -> booking cancelled. */
export async function rejectOffer(c, bookingId, user, reason) {
  const b = await lockBooking(c, bookingId, user);
  if (!['QUOTED', 'NEGOTIATING'].includes(b.status)) throw invalidTransition(b.status, 'CANCELLED');
  const pending = await getPendingOffer(c, b.id);
  if (!pending) throw conflict('There is no pending offer to reject');
  if (pending.offered_by === user.id) throw conflict('You cannot reject your own offer; cancel the booking instead', 'NOT_YOUR_TURN');
  await c.query(`UPDATE price_offers SET status = 'REJECTED', responded_at = now() WHERE id = $1`, [pending.id]);
  return cancel(c, b, user, reason || 'Offer rejected', true);
}

/** Cancel a booking (either party, or admin). Pending offers are closed. */
export async function cancel(c, bookingOrId, user, reason, alreadyLocked = false) {
  const b = alreadyLocked ? bookingOrId : await lockBooking(c, bookingOrId, user);
  if (user.role !== 'ADMIN' && b.status === 'DISPUTED') throw forbidden('A disputed booking can only be resolved by an admin');
  await c.query(`UPDATE price_offers SET status = 'REJECTED', responded_at = now() WHERE booking_id = $1 AND status = 'PENDING'`, [b.id]);
  const nb = await transition(c, b, 'CANCELLED', user, { note: reason, set: { cancelled_reason: reason, cancelled_by: user.id } });
  const targets = [b.customer_id, b.provider_id].filter((id) => id !== user.id);
  for (const t of targets) await notify(t, 'BOOKING_CANCELLED', 'Booking cancelled', `${b.service_name}: ${reason}`, { booking_id: b.id }, c);
  return nb;
}

export async function schedule(c, bookingId, user, when) {
  const b = await lockBooking(c, bookingId, user);
  assertParty(b, user, 'SERVICE_PROVIDER');
  if (b.status !== 'ACCEPTED') throw invalidTransition(b.status, 'SCHEDULED');
  const at = when ?? b.preferred_at;
  if (!at) throw badRequest('scheduled_at is required');
  if (new Date(at) < new Date(Date.now() - 60_000)) throw badRequest('scheduled_at must be in the future');
  const clash = await c.query(`SELECT 1 FROM bookings WHERE provider_id = $1 AND id <> $2 AND status IN ('SCHEDULED','IN_PROGRESS')
    AND abs(extract(epoch FROM (scheduled_at - $3::timestamptz))) < 3600`, [b.provider_id, b.id, at]);
  if (clash.rowCount) throw conflict('You already have a job scheduled within an hour of this time', 'SCHEDULE_CLASH');
  const nb = await transition(c, b, 'SCHEDULED', user, { note: `Scheduled for ${new Date(at).toISOString()}`, set: { scheduled_at: at } });
  await notify(b.customer_id, 'BOOKING_SCHEDULED', 'Booking scheduled', `${b.service_name} is scheduled for ${new Date(at).toLocaleString('en-IN')}`, { booking_id: b.id }, c);
  return nb;
}

export async function start(c, bookingId, user) {
  const b = await lockBooking(c, bookingId, user);
  assertParty(b, user, 'SERVICE_PROVIDER');
  const nb = await transition(c, b, 'IN_PROGRESS', user, { note: 'Work started' });
  await notify(b.customer_id, 'JOB_STARTED', 'Work started', `${user.name} has started ${b.service_name}`, { booking_id: b.id }, c);
  return nb;
}

export async function complete(c, bookingId, user) {
  const b = await lockBooking(c, bookingId, user);
  assertParty(b, user, 'SERVICE_PROVIDER');
  const nb = await transition(c, b, 'COMPLETED', user, { note: 'Work completed', set: { completed_at: new Date() } });
  await notify(b.customer_id, 'JOB_COMPLETED', 'Job completed', `${b.service_name} was marked completed. You can now review it.`, { booking_id: b.id }, c);
  return nb;
}
