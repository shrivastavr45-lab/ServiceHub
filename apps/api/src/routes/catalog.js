import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { parse, ok, created, idParam } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const intId = (req) => parse(z.coerce.number().int().positive(), req.params.id);
const admin = [authenticate, requireRole('ADMIN')];

// ---------- Categories (mounted at /api/categories) ----------
const router = Router();

// Public: active categories with their active services nested.
router.get('/', async (_req, res) => {
  const { rows } = await query(`
    SELECT c.id, c.name, c.slug, c.description, c.icon,
      COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description)
        ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL), '[]') AS services
    FROM categories c LEFT JOIN services s ON s.category_id = c.id AND s.is_active
    WHERE c.is_active GROUP BY c.id ORDER BY c.name`);
  ok(res, rows);
});

const catSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.string().trim().max(10).nullable().optional(),
  is_active: z.boolean().optional(),
});

router.post('/', ...admin, async (req, res) => {
  const d = parse(catSchema, req.body);
  const { rows } = await query(`INSERT INTO categories (name, slug, description, icon) VALUES ($1,$2,$3,$4) RETURNING *`,
    [d.name, slugify(d.name), d.description ?? null, d.icon ?? null]);
  await audit(req.user, 'category.create', 'category', rows[0].id, { name: d.name }, req);
  created(res, rows[0]);
});

router.patch('/:id', ...admin, async (req, res) => {
  const id = intId(req);
  const d = parse(catSchema.partial(), req.body);
  const { rows } = await query(`UPDATE categories SET name = COALESCE($2, name), description = COALESCE($3, description),
    icon = COALESCE($4, icon), is_active = COALESCE($5, is_active) WHERE id = $1 RETURNING *`,
    [id, d.name ?? null, d.description ?? null, d.icon ?? null, d.is_active ?? null]);
  if (!rows[0]) throw notFound('Category not found');
  await audit(req.user, 'category.update', 'category', id, d, req);
  ok(res, rows[0]);
});

// Soft delete: old bookings keep their snapshots and providers keep their listings' history.
router.delete('/:id', ...admin, async (req, res) => {
  const id = intId(req);
  const r = await query('UPDATE categories SET is_active = false WHERE id = $1', [id]);
  if (!r.rowCount) throw notFound('Category not found');
  await audit(req.user, 'category.deactivate', 'category', id, {}, req);
  res.status(204).end();
});

export default router;

// ---------- Services (mounted at /api/services) ----------
export const servicesRouter = Router();

servicesRouter.get('/', async (req, res) => {
  const q = parse(z.object({ category_id: z.coerce.number().int().optional(), q: z.string().trim().max(60).optional() }), req.query);
  const { rows } = await query(`SELECT s.id, s.name, s.slug, s.description, s.category_id, c.name AS category_name
    FROM services s JOIN categories c ON c.id = s.category_id
    WHERE s.is_active AND c.is_active AND ($1::int IS NULL OR s.category_id = $1) AND ($2::text IS NULL OR s.name ILIKE '%' || $2 || '%')
    ORDER BY c.name, s.name`, [q.category_id ?? null, q.q ?? null]);
  ok(res, rows);
});

const svcSchema = z.object({
  category_id: z.number().int().positive(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
});

servicesRouter.post('/', ...admin, async (req, res) => {
  const d = parse(svcSchema, req.body);
  const { rows } = await query(`INSERT INTO services (category_id, name, slug, description) VALUES ($1,$2,$3,$4) RETURNING *`,
    [d.category_id, d.name, `${slugify(d.name)}-${d.category_id}`, d.description ?? null]);
  await audit(req.user, 'service.create', 'service', rows[0].id, { name: d.name }, req);
  created(res, rows[0]);
});

servicesRouter.patch('/:id', ...admin, async (req, res) => {
  const id = intId(req);
  const d = parse(svcSchema.partial(), req.body);
  const { rows } = await query(`UPDATE services SET category_id = COALESCE($2, category_id), name = COALESCE($3, name),
    description = COALESCE($4, description), is_active = COALESCE($5, is_active) WHERE id = $1 RETURNING *`,
    [id, d.category_id ?? null, d.name ?? null, d.description ?? null, d.is_active ?? null]);
  if (!rows[0]) throw notFound('Service not found');
  await audit(req.user, 'service.update', 'service', id, d, req);
  ok(res, rows[0]);
});

servicesRouter.delete('/:id', ...admin, async (req, res) => {
  const id = intId(req);
  const r = await query('UPDATE services SET is_active = false WHERE id = $1', [id]);
  if (!r.rowCount) throw notFound('Service not found');
  await audit(req.user, 'service.deactivate', 'service', id, {}, req);
  res.status(204).end();
});
