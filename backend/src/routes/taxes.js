/**
 * CERADRIVE ERP — Tax Master Routes.
 * Simple editable tax master (NOT GST compliance). Table: tax_master (id, tax_name, tax_percent, …).
 * REGISTER: import taxRoutes from './taxes.js'; router.use('/taxes', taxRoutes);
 * Base: /api/v1/taxes
 * WRITE_ROLES pending PM confirm — defaulted to ADMIN + STORE_MANAGER.
 */
import { Router }           from 'express';
import { z }                from 'zod';
import { supabase }         from '../config/supabase.js';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';

const router = Router();
const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

const COLS = 'id, tax_code, tax_name, tax_percent, tax_type, is_active, notes, created_at, updated_at';

const codeRegex = /^[A-Z0-9_-]+$/;

function sanitizeOrSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[,%_()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCode(v) {
  return String(v || '').trim().toUpperCase();
}


const createSchema = z.object({
  tax_code: z.string().min(1, 'Tax code is required.').max(40).transform(normalizeCode).refine(v => codeRegex.test(v), 'Tax code can contain only A-Z, 0-9, underscore and hyphen.'),
  tax_name:    z.string().min(1, 'Tax name is required.').max(80),
  tax_percent: z.coerce.number().min(0, 'Tax % must be ≥ 0.').max(100, 'Tax % must be ≤ 100.'),
  is_active:   z.boolean().optional(),
  notes:     z.string().nullish(),
});
const updateSchema = z.object({
  tax_code: z.string().min(1).max(40).transform(normalizeCode).refine(v => codeRegex.test(v), 'Tax code can contain only A-Z, 0-9, underscore and hyphen.').optional(),
  tax_name:    z.string().min(1).max(80).optional(),
  tax_percent: z.coerce.number().min(0).max(100).optional(),
  is_active:   z.boolean().optional(),
  notes:     z.string().nullish(),
});

function vErr(res, parsed) {
  return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400,
    parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
}
async function codeTaken(code, excludeId) {
  let q = supabase.from('tax_master').select('id').eq('tax_code', normalizeCode(code));
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return Boolean(data && data.length);
}

async function nameTaken(name, excludeId) {
  let q = supabase.from('tax_master').select('id').ilike('tax_name', name.trim());
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return Boolean(data && data.length);
}

// GET /api/v1/taxes  (list + optional ?search= by name, ?is_active=)
router.get('/', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { search, is_active } = req.query;
  let q = supabase.from('tax_master').select(COLS).order('tax_percent', { ascending: true });
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`tax_code.ilike.%${safeSearch}%,tax_name.ilike.%${safeSearch}%`);
  if (is_active === 'true' || is_active === 'false') q = q.eq('is_active', is_active === 'true');
  const { data, error } = await q;
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load taxes.', 500);
  return sendSuccess(res, data ?? []);
});

// GET /api/v1/taxes/:id
router.get('/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await supabase.from('tax_master').select(COLS).eq('id', req.params.id).single();
  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Tax not found.', 404);
  return sendSuccess(res, data);
});

// POST /api/v1/taxes
router.post('/', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  if (await codeTaken(parsed.data.tax_code, null))
    return sendError(res, ERROR_CODES.CONFLICT, `Tax code '${parsed.data.tax_code}' already exists.`, 409);
  if (await nameTaken(parsed.data.tax_name, null))
    return sendError(res, ERROR_CODES.CONFLICT, `Tax '${parsed.data.tax_name.trim()}' already exists.`, 409);
  const { data, error } = await supabase.from('tax_master').insert({
    tax_code: parsed.data.tax_code, tax_name: parsed.data.tax_name.trim(), tax_percent: parsed.data.tax_percent,
    tax_type: 'CUSTOM', is_active: parsed.data.is_active ?? true, notes: parsed.data.notes ?? null,
  }).select(COLS).single();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create tax.', 500);
  return sendSuccess(res, data, 201);
});

// PUT /api/v1/taxes/:id
async function updateTax(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  const { id } = req.params;
  const { data: existing } = await supabase.from('tax_master').select('id').eq('id', id).single();
  if (!existing) return sendError(res, ERROR_CODES.NOT_FOUND, 'Tax not found.', 404);
  if (parsed.data.tax_name && await nameTaken(parsed.data.tax_name, id))
    return sendError(res, ERROR_CODES.CONFLICT, `Tax '${parsed.data.tax_name.trim()}' already exists.`, 409);
  const patch = { updated_at: new Date().toISOString() };
  if (parsed.data.tax_code    !== undefined) patch.tax_code    = parsed.data.tax_code;
  if (parsed.data.tax_name    !== undefined) patch.tax_name    = parsed.data.tax_name.trim();
  if (parsed.data.tax_percent !== undefined) patch.tax_percent = parsed.data.tax_percent;
  if (parsed.data.is_active   !== undefined) patch.is_active   = parsed.data.is_active;
  if (parsed.data.notes     !== undefined) patch.notes     = parsed.data.notes ?? null;
  const { data, error } = await supabase.from('tax_master').update(patch).eq('id', id).select(COLS).single();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update tax.', 500);
  return sendSuccess(res, data);
}

router.put('/:id', authenticate, roleGuard(WRITE_ROLES), updateTax);
router.patch('/:id', authenticate, roleGuard(WRITE_ROLES), updateTax);

// DELETE /api/v1/taxes/:id
router.delete('/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { id } = req.params;
  const { data: existing } = await supabase.from('tax_master').select('id').eq('id', id).single();
  if (!existing) return sendError(res, ERROR_CODES.NOT_FOUND, 'Tax not found.', 404);
  const { data, error } = await supabase.from('tax_master').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to deactivate tax.', 500);
  return sendSuccess(res, { ...data, deleted: false, is_active: false });
});

export default router;
