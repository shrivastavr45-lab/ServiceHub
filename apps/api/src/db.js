import pg from 'pg';
import { config } from './config.js';

// Return BIGINT/NUMERIC as numbers where safe; counts are small.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const query = (text, params) => pool.query(text, params);

/** Run fn inside a transaction. fn receives a client; commit on success, rollback on throw. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
