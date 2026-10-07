import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
}

export const PASSWORD = 'Passw0rd!x';
let n = 0;
export async function register(role, name = `User ${++n}`) {
  const email = `u${Date.now()}${++n}@test.dev`;
  const r = await api().post('/api/auth/register').send({ name, email, password: PASSWORD, role, city: 'New Delhi' });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return { id: r.body.data.user.id, email, token: r.body.data.accessToken, cookies: r.headers['set-cookie'] };
}
export const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

export async function makeAdmin() {
  const u = await register('CUSTOMER', 'Admin');
  await query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [u.id]);
  return u; // token role claim is stale but the API reads the role from the DB
}

/** Creates category+service via admin, and a provider offering it. */
export async function setupCatalog(admin, provider) {
  const cat = await api().post('/api/categories').set(auth(admin)).send({ name: `Cat ${Date.now()}` });
  const svc = await api().post('/api/services').set(auth(admin)).send({ category_id: cat.body.data.id, name: `Svc ${Date.now()}` });
  const ps = await api().post('/api/providers/me/services').set(auth(provider)).send({ service_id: svc.body.data.id, price_paise: 80000 });
  return { category: cat.body.data, service: svc.body.data, providerService: ps.body.data };
}

export const requestBody = (psId) => ({
  provider_service_id: psId, description: 'Please fix the issue at my home', address: '12 Test Street, Delhi', city: 'New Delhi',
});
