import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config, isProd } from '../config.js';
import { query, withTransaction } from '../db.js';
import { parse, ok, created } from '../lib/http.js';
import { AppError, unauthorized, forbidden } from '../lib/errors.js';
import { authenticate, signAccessToken } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();
const COOKIE = 'sh_refresh';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const cookieOpts = () => ({
  httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', path: '/api/auth',
  maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
});
const clearOpts = () => { const { maxAge, ...rest } = cookieOpts(); return rest; };

async function issueRefresh(client, userId, familyId = crypto.randomUUID()) {
  const token = crypto.randomBytes(48).toString('base64url');
  await client.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
    [userId, familyId, sha256(token), String(config.REFRESH_TOKEN_TTL_DAYS)]);
  return token;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone ?? null });

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72)
    .regex(/[A-Za-z]/, 'Password needs a letter').regex(/[0-9]/, 'Password needs a number'),
  phone: z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, 'Invalid phone').optional(),
  role: z.enum(['CUSTOMER', 'SERVICE_PROVIDER']), // ADMIN can never self-register
  city: z.string().trim().max(100).optional(),
});

router.post('/register', async (req, res) => {
  const d = parse(registerSchema, req.body);
  const hash = await bcrypt.hash(d.password, config.BCRYPT_ROUNDS);
  const result = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (email, password_hash, role, name, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.email, hash, d.role, d.name, d.phone ?? null]);
    const user = rows[0];
    if (d.role === 'CUSTOMER') await c.query('INSERT INTO customer_profiles (user_id, city) VALUES ($1,$2)', [user.id, d.city ?? null]);
    else await c.query('INSERT INTO provider_profiles (user_id, city) VALUES ($1,$2)', [user.id, d.city ?? null]);
    const refresh = await issueRefresh(c, user.id);
    await audit(user, 'auth.register', 'user', user.id, { role: d.role }, req, c);
    return { user, refresh };
  }).catch((e) => {
    if (e.code === '23505') throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    throw e;
  });
  res.cookie(COOKIE, result.refresh, cookieOpts());
  created(res, { user: publicUser(result.user), accessToken: signAccessToken(result.user) });
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
// Compare against a dummy hash when the user is unknown so timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

router.post('/login', async (req, res) => {
  const d = parse(loginSchema, req.body);
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [d.email]);
  const user = rows[0];
  const valid = await bcrypt.compare(d.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) throw unauthorized('Invalid email or password');
  if (user.status !== 'ACTIVE') throw forbidden('Account is suspended');
  const refresh = await withTransaction((c) => issueRefresh(c, user.id));
  await audit(user, 'auth.login', 'user', user.id, {}, req);
  res.cookie(COOKIE, refresh, cookieOpts());
  ok(res, { user: publicUser(user), accessToken: signAccessToken(user) });
});

// Refresh-token rotation with reuse detection: a revoked token being replayed revokes the whole family.
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw unauthorized('No refresh token');
  const outcome = await withTransaction(async (c) => {
    const { rows } = await c.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
    const rt = rows[0];
    if (!rt) return { error: 'invalid' };
    if (rt.revoked_at) {
      await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [rt.family_id]);
      return { error: 'reuse' };
    }
    if (new Date(rt.expires_at) < new Date()) return { error: 'expired' };
    const u = (await c.query('SELECT * FROM users WHERE id = $1', [rt.user_id])).rows[0];
    if (!u || u.status !== 'ACTIVE') return { error: 'inactive' };
    await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [rt.id]);
    return { user: u, refresh: await issueRefresh(c, u.id, rt.family_id) };
  });
  if (outcome.error) {
    res.clearCookie(COOKIE, clearOpts());
    throw unauthorized('Session expired, please log in again');
  }
  res.cookie(COOKIE, outcome.refresh, cookieOpts());
  ok(res, { user: publicUser(outcome.user), accessToken: signAccessToken(outcome.user) });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
  res.clearCookie(COOKIE, clearOpts());
  res.status(204).end();
});

router.get('/me', authenticate, async (req, res) => {
  const { rows } = await query('SELECT id, email, name, role, phone FROM users WHERE id = $1', [req.user.id]);
  ok(res, { user: rows[0] });
});

export default router;
