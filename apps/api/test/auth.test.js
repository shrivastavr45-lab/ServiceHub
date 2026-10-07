import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, resetDb, register, auth, PASSWORD } from './helpers.js';
import { pool, query } from '../src/db.js';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('registration & login', () => {
  it('registers a customer, hashes the password, returns token + refresh cookie', async () => {
    const email = 'alice@test.dev';
    const r = await api().post('/api/auth/register').send({ name: 'Alice', email, password: PASSWORD, role: 'CUSTOMER' });
    expect(r.status).toBe(201);
    expect(r.body.data.accessToken).toBeTruthy();
    expect(r.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    const { rows } = await query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    expect(rows[0].password_hash.startsWith('$2')).toBe(true);
  });
  it('rejects duplicate email, weak password and self-registering as ADMIN', async () => {
    const dup = await api().post('/api/auth/register').send({ name: 'Alice', email: 'ALICE@test.dev', password: PASSWORD, role: 'CUSTOMER' });
    expect(dup.status).toBe(409);
    const weak = await api().post('/api/auth/register').send({ name: 'Bob', email: 'bob@test.dev', password: 'short', role: 'CUSTOMER' });
    expect(weak.status).toBe(422);
    const adm = await api().post('/api/auth/register').send({ name: 'Eve', email: 'eve@test.dev', password: PASSWORD, role: 'ADMIN' });
    expect(adm.status).toBe(422);
  });
  it('logs in with correct credentials and rejects wrong ones identically', async () => {
    const ok = await api().post('/api/auth/login').send({ email: 'alice@test.dev', password: PASSWORD });
    expect(ok.status).toBe(200);
    const bad = await api().post('/api/auth/login').send({ email: 'alice@test.dev', password: 'wrongpass1' });
    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'wrongpass1' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });
  it('requires a valid token on protected routes', async () => {
    expect((await api().get('/api/bookings')).status).toBe(401);
    expect((await api().get('/api/bookings').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });
});

describe('refresh tokens', () => {
  it('rotates on refresh, detects reuse and revokes the family; logout revokes', async () => {
    const u = await register('CUSTOMER');
    const first = u.cookies[0].split(';')[0];
    const r1 = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(r1.status).toBe(200);
    const second = r1.headers['set-cookie'][0].split(';')[0];
    // replay the OLD token -> reuse detected
    expect((await api().post('/api/auth/refresh').set('Cookie', first)).status).toBe(401);
    // the family is revoked, so the newer token is dead too
    expect((await api().post('/api/auth/refresh').set('Cookie', second)).status).toBe(401);

    const v = await register('CUSTOMER');
    const c = v.cookies[0].split(';')[0];
    await api().post('/api/auth/logout').set('Cookie', c);
    expect((await api().post('/api/auth/refresh').set('Cookie', c)).status).toBe(401);
  });
});

describe('suspended accounts', () => {
  it('cannot use an existing token or log in', async () => {
    const u = await register('CUSTOMER');
    await query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [u.id]);
    expect((await api().get('/api/users/me').set(auth(u))).status).toBe(403);
    expect((await api().post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(403);
  });
});
