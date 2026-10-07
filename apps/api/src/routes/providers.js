import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { parse, ok, created, idParam, paginationSchema, pageMeta } from '../lib/http.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const me = [authenticate, requireRole('SERVICE_PROVIDER')];

// ---------------- Public search ----------------
const searchSchema = paginationSchema.extend({
  q: z.string().trim().max(60).optional(),
  category_id: z.coerce.number().int().optional(),
  category: z.string().trim().max(80).optional(), // slug
  service_id: z.coerce.number().int().optional(),
  city: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(10).optional(),
  min_price: z.coerce.number().int().min(0).optional(), // paise
  max_price: z.coerce.number().int().min(0).optional(),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  available_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['rating', 'price_asc', 'price_desc', 'experience']).default('rating'),
});

router.get('/', async (req, res) => {
  const f = parse(searchSchema, req.query);
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [`pp.verification_status = 'APPROVED'`];

  if (f.category_id) where.push(`s.category_id = ${p(f.category_id)}`);
  if (f.category) where.push(`c.slug = ${p(f.category)}`);
  if (f.service_id) where.push(`s.id = ${p(f.service_id)}`);
  if (f.q) { const t = p(f.q); where.push(`(s.name ILIKE '%' || ${t} || '%' OR c.name ILIKE '%' || ${t} || '%' OR u.name ILIKE '%' || ${t} || '%' OR pp.headline ILIKE '%' || ${t} || '%')`); }
  if (f.min_price != null) where.push(`ps.price_paise >= ${p(f.min_price)}`);
  if (f.max_price != null) where.push(`ps.price_paise <= ${p(f.max_price)}`);
  if (f.min_rating != null) where.push(`pp.rating_avg >= ${p(f.min_rating)}`);
  if (f.city) { const t = p(f.city); where.push(`(lower(pp.city) = lower(${t}) OR EXISTS (SELECT 1 FROM service_areas sa WHERE sa.provider_id = pp.user_id AND lower(sa.city) = lower(${t})))`); }
  if (f.pincode) where.push(`EXISTS (SELECT 1 FROM service_areas sa WHERE sa.provider_id = pp.user_id AND sa.pincode = ${p(f.pincode)})`);
  if (f.available_on) where.push(`EXISTS (SELECT 1 FROM availability a WHERE a.provider_id = pp.user_id AND a.weekday = EXTRACT(DOW FROM ${p(f.available_on)}::date))`);

  const from = `FROM provider_profiles pp
    JOIN users u ON u.id = pp.user_id AND u.status = 'ACTIVE'
    JOIN provider_services ps ON ps.provider_id = pp.user_id AND ps.is_active
    JOIN services s ON s.id = ps.service_id AND s.is_active
    JOIN categories c ON c.id = s.category_id AND c.is_active
    WHERE ${where.join(' AND ')}`;

  const total = (await query(`SELECT COUNT(DISTINCT pp.user_id) AS n ${from}`, params)).rows[0].n;
  const order = { rating: 'pp.rating_avg DESC, pp.rating_count DESC', price_asc: 'min_price_paise ASC', price_desc: 'min_price_paise DESC', experience: 'pp.experience_years DESC' }[f.sort];
  const { rows } = await query(`
    SELECT pp.user_id AS id, u.name, pp.headline, pp.city, pp.experience_years, pp.rating_avg, pp.rating_count,
      MIN(ps.price_paise) AS min_price_paise,
      json_agg(json_build_object('id', ps.id, 'service_id', s.id, 'name', s.name, 'category', c.name,
        'price_paise', ps.price_paise, 'price_unit', ps.price_unit) ORDER BY ps.price_paise) AS services
    ${from}
    GROUP BY pp.user_id, u.name, pp.headline, pp.city, pp.experience_years, pp.rating_avg, pp.rating_count
    ORDER BY ${order}, pp.user_id
    LIMIT ${p(f.limit)} OFFSET ${p((f.page - 1) * f.limit)}`, params);
  ok(res, rows, pageMeta(f.page, f.limit, total));
});

// ---------------- Provider self-management (/me/* must come before /:id) ----------------
router.get('/me/profile', ...me, async (req, res) => {
  const { rows } = await query(`SELECT pp.*, u.name, u.email, u.phone FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE pp.user_id = $1`, [req.user.id]);
  ok(res, rows[0]);
});

const profileSchema = z.object({
  headline: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  experience_years: z.number().int().min(0).max(70).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  city: z.string().trim().max(100).nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
});
router.put('/me/profile', ...me, async (req, res) => {
  const d = parse(profileSchema, req.body);
  const { rows } = await query(`UPDATE provider_profiles SET
    headline = CASE WHEN $2 THEN $3 ELSE headline END, bio = CASE WHEN $4 THEN $5 ELSE bio END,
    experience_years = COALESCE($6, experience_years), skills = COALESCE($7, skills),
    city = CASE WHEN $8 THEN $9 ELSE city END, gstin = CASE WHEN $10 THEN $11 ELSE gstin END
    WHERE user_id = $1 RETURNING *`,
    [req.user.id, 'headline' in d, d.headline ?? null, 'bio' in d, d.bio ?? null, d.experience_years ?? null, d.skills ?? null,
      'city' in d, d.city ?? null, 'gstin' in d, d.gstin ?? null]);
  ok(res, rows[0]);
});

router.get('/me/services', ...me, async (req, res) => {
  const { rows } = await query(`SELECT ps.id, ps.service_id, s.name, c.name AS category, ps.price_paise, ps.price_unit, ps.description, ps.is_active
    FROM provider_services ps JOIN services s ON s.id = ps.service_id JOIN categories c ON c.id = s.category_id
    WHERE ps.provider_id = $1 ORDER BY c.name, s.name`, [req.user.id]);
  ok(res, rows);
});

const psSchema = z.object({
  service_id: z.number().int().positive(),
  price_paise: z.number().int().positive().max(100_000_000),
  price_unit: z.enum(['FIXED', 'PER_HOUR', 'PER_UNIT']).default('FIXED'),
  description: z.string().trim().max(500).nullable().optional(),
});
router.post('/me/services', ...me, async (req, res) => {
  const d = parse(psSchema, req.body);
  const svc = (await query('SELECT id FROM services s WHERE id = $1 AND is_active', [d.service_id])).rows[0];
  if (!svc) throw notFound('Service not found');
  const { rows } = await query(`INSERT INTO provider_services (provider_id, service_id, price_paise, price_unit, description)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.user.id, d.service_id, d.price_paise, d.price_unit, d.description ?? null])
    .catch((e) => { if (e.code === '23505') throw conflict('You already offer this service'); throw e; });
  created(res, rows[0]);
});

router.patch('/me/services/:id', ...me, async (req, res) => {
  const id = idParam(req);
  const d = parse(psSchema.omit({ service_id: true }).partial().extend({ is_active: z.boolean().optional() }), req.body);
  // The provider_id predicate is the ownership check: another provider's row simply isn't found.
  const { rows } = await query(`UPDATE provider_services SET price_paise = COALESCE($3, price_paise), price_unit = COALESCE($4, price_unit),
    description = COALESCE($5, description), is_active = COALESCE($6, is_active) WHERE id = $1 AND provider_id = $2 RETURNING *`,
    [id, req.user.id, d.price_paise ?? null, d.price_unit ?? null, d.description ?? null, d.is_active ?? null]);
  if (!rows[0]) throw notFound('Service listing not found');
  ok(res, rows[0]);
});

router.delete('/me/services/:id', ...me, async (req, res) => {
  const r = await query('DELETE FROM provider_services WHERE id = $1 AND provider_id = $2', [idParam(req), req.user.id]);
  if (!r.rowCount) throw notFound('Service listing not found');
  res.status(204).end();
});

router.get('/me/areas', ...me, async (req, res) => {
  ok(res, (await query('SELECT id, city, pincode FROM service_areas WHERE provider_id = $1 ORDER BY city', [req.user.id])).rows);
});
router.put('/me/areas', ...me, async (req, res) => {
  const d = parse(z.object({ areas: z.array(z.object({
    city: z.string().trim().min(2).max(100), pincode: z.string().trim().regex(/^[0-9]{4,10}$/).nullable().optional(),
  })).max(50) }), req.body);
  await withTransaction(async (c) => {
    await c.query('DELETE FROM service_areas WHERE provider_id = $1', [req.user.id]);
    for (const a of d.areas) {
      await c.query(`INSERT INTO service_areas (provider_id, city, pincode) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [req.user.id, a.city, a.pincode ?? null]);
    }
  });
  ok(res, (await query('SELECT id, city, pincode FROM service_areas WHERE provider_id = $1 ORDER BY city', [req.user.id])).rows);
});

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
router.get('/me/availability', ...me, async (req, res) => {
  ok(res, (await query(`SELECT id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
    FROM availability WHERE provider_id = $1 ORDER BY weekday, start_time`, [req.user.id])).rows);
});
router.put('/me/availability', ...me, async (req, res) => {
  const d = parse(z.object({ slots: z.array(z.object({
    weekday: z.number().int().min(0).max(6), start_time: z.string().regex(timeRe), end_time: z.string().regex(timeRe),
  })).max(70) }), req.body);
  for (const s of d.slots) if (s.end_time <= s.start_time) throw badRequest('end_time must be after start_time');
  await withTransaction(async (c) => {
    await c.query('DELETE FROM availability WHERE provider_id = $1', [req.user.id]);
    for (const s of d.slots) await c.query('INSERT INTO availability (provider_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [req.user.id, s.weekday, s.start_time, s.end_time]);
  });
  ok(res, (await query(`SELECT id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
    FROM availability WHERE provider_id = $1 ORDER BY weekday, start_time`, [req.user.id])).rows);
});

router.get('/me/earnings', ...me, async (req, res) => {
  const totals = (await query(`
    SELECT COUNT(*) FILTER (WHERE b.status = 'COMPLETED') AS completed_jobs,
      COALESCE(SUM(i.total_paise) FILTER (WHERE b.status = 'COMPLETED'), 0) AS invoiced_paise,
      COALESCE(SUM(i.total_paise) FILTER (WHERE i.payment_status = 'PAID'), 0) AS paid_paise,
      COALESCE(SUM(i.total_paise) FILTER (WHERE b.status = 'COMPLETED' AND i.payment_status = 'UNPAID'), 0) AS unpaid_paise,
      COALESCE(SUM(b.platform_fee_paise) FILTER (WHERE b.status = 'COMPLETED'), 0) AS platform_fees_paise
    FROM bookings b LEFT JOIN invoices i ON i.booking_id = b.id WHERE b.provider_id = $1`, [req.user.id])).rows[0];
  const monthly = (await query(`
    SELECT to_char(date_trunc('month', b.completed_at), 'YYYY-MM') AS month, COUNT(*) AS jobs,
      COALESCE(SUM(i.total_paise), 0) AS invoiced_paise
    FROM bookings b LEFT JOIN invoices i ON i.booking_id = b.id
    WHERE b.provider_id = $1 AND b.status = 'COMPLETED' AND b.completed_at IS NOT NULL
    GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [req.user.id])).rows;
  ok(res, { ...totals, net_paise: totals.invoiced_paise - totals.platform_fees_paise, monthly });
});

// Public: one listed service with its provider (used by the request form).
router.get('/services/:id', async (req, res) => {
  const { rows } = await query(`SELECT ps.id, ps.price_paise, ps.price_unit, s.name AS service_name, c.name AS category_name,
      pp.user_id AS provider_id, u.name AS provider_name, pp.city AS provider_city
    FROM provider_services ps JOIN services s ON s.id = ps.service_id JOIN categories c ON c.id = s.category_id
    JOIN provider_profiles pp ON pp.user_id = ps.provider_id JOIN users u ON u.id = pp.user_id
    WHERE ps.id = $1 AND ps.is_active AND s.is_active AND pp.verification_status = 'APPROVED' AND u.status = 'ACTIVE'`, [idParam(req)]);
  if (!rows[0]) throw notFound('Service not found');
  ok(res, rows[0]);
});

// ---------------- Public provider profile ----------------
router.get('/:id', async (req, res) => {
  const id = idParam(req);
  const prof = (await query(`SELECT pp.user_id AS id, u.name, pp.headline, pp.bio, pp.experience_years, pp.skills, pp.city,
      pp.rating_avg, pp.rating_count, u.created_at AS member_since
    FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
    WHERE pp.user_id = $1 AND u.status = 'ACTIVE' AND pp.verification_status = 'APPROVED'`, [id])).rows[0];
  if (!prof) throw notFound('Provider not found');
  const [services, areas, availability, reviews] = await Promise.all([
    query(`SELECT ps.id, s.id AS service_id, s.name, c.name AS category, ps.price_paise, ps.price_unit, ps.description
      FROM provider_services ps JOIN services s ON s.id = ps.service_id JOIN categories c ON c.id = s.category_id
      WHERE ps.provider_id = $1 AND ps.is_active AND s.is_active ORDER BY c.name, s.name`, [id]),
    query('SELECT city, pincode FROM service_areas WHERE provider_id = $1 ORDER BY city', [id]),
    query(`SELECT weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time FROM availability WHERE provider_id = $1 ORDER BY weekday, start_time`, [id]),
    query(`SELECT r.id, r.rating, r.comment, r.created_at, split_part(u.name, ' ', 1) AS customer_name
      FROM reviews r JOIN users u ON u.id = r.customer_id WHERE r.provider_id = $1 AND r.status = 'VISIBLE' ORDER BY r.created_at DESC LIMIT 20`, [id]),
  ]);
  ok(res, { ...prof, services: services.rows, areas: areas.rows, availability: availability.rows, reviews: reviews.rows });
});

export default router;
