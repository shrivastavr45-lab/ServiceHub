import { query } from '../db.js';

/**
 * In-app notification. Written with the same client/transaction as the triggering event,
 * so an event and its notification commit or roll back together.
 * Channel dispatchers (email/SMS/push) can later consume this table.
 */
export async function notify(userId, type, title, body = null, data = {}, client = null) {
  const q = client ? client.query.bind(client) : query;
  await q(`INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)`,
    [userId, type, title, body, JSON.stringify(data)]);
}
