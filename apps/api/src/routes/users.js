import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { parse, ok } from '../lib/http.js';
import { unauthorized } from '../lib/errors.js';

const router = Router();

router.get('/me', async (req, res) => {
  const { rows } = await query('SELECT id, email, name, phone, role, created_at FROM users WHERE id = $1', [req.user.id]);
  let profile = null;
  if (req.user.role === 'CUSTOMER') profile = (await query('SELECT address, city, pincode FROM customer_profiles WHERE user_id = $1', [req.user.id])).rows[0];
  ok(res, { ...rows[0], profile });
});

const patchSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, 'Invalid phone').nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  pincode: z.string().trim().regex(/^[0-9]{4,10}$/, 'Invalid pincode').nullable().optional(),
});

router.patch('/me', async (req, res) => {
  const d = parse(patchSchema, req.body);
  await withTransaction(async (c) => {
    if (d.name !== undefined || d.phone !== undefined) {
      await c.query('UPDATE users SET name = COALESCE($2, name), phone = CASE WHEN $3 THEN $4 ELSE phone END, updated_at = now() WHERE id = $1',
        [req.user.id, d.name ?? null, d.phone !== undefined, d.phone ?? null]);
    }
    if (req.user.role === 'CUSTOMER' && ('address' in d || 'city' in d || 'pincode' in d)) {
      await c.query(`UPDATE customer_profiles SET
        address = CASE WHEN $2 THEN $3 ELSE address END,
        city = CASE WHEN $4 THEN $5 ELSE city END,
        pincode = CASE WHEN $6 THEN $7 ELSE pincode END WHERE user_id = $1`,
        [req.user.id, 'address' in d, d.address ?? null, 'city' in d, d.city ?? null, 'pincode' in d, d.pincode ?? null]);
    }
  });
  const { rows } = await query('SELECT id, email, name, phone, role FROM users WHERE id = $1', [req.user.id]);
  ok(res, rows[0]);
});

const pwSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(72).regex(/[A-Za-z]/).regex(/[0-9]/),
});
router.post('/me/password', async (req, res) => {
  const d = parse(pwSchema, req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(d.current_password, rows[0].password_hash))) throw unauthorized('Current password is incorrect');
  const hash = await bcrypt.hash(d.new_password, config.BCRYPT_ROUNDS);
  await withTransaction(async (c) => {
    await c.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, hash]);
    await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
  });
  res.status(204).end();
});

export default router;
