import { query } from '../db.js';

/** Append an audit record. Pass a transaction client to make it atomic with the action. */
export async function audit(actor, action, entityType, entityId, metadata = {}, req = null, client = null) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor?.id ?? null, action, entityType, entityId ? String(entityId) : null, JSON.stringify(metadata), req?.ip ?? null],
  );
}
