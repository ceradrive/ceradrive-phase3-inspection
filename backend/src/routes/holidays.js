/**
 * CERADRIVE ERP — Holiday Master Routes.
 *
 * DB table: holiday_master
 * Base: /api/v1/holidays
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

const COLS = [
  'id',
  'holiday_date',
  'holiday_name',
  'holiday_type',
  'is_paid',
  'is_active',
  'notes',
  'created_at',
  'updated_at',
].join(', ');

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const typeValues = ['GENERAL', 'FESTIVAL', 'NATIONAL', 'WEEKLY_OFF', 'COMPANY', 'OTHER'];

const createSchema = z.object({
  holiday_date: z.string().min(1, 'Holiday date is required.').refine(v => dateRegex.test(v), 'Holiday date must be YYYY-MM-DD.'),
  holiday_name: z.string().min(1, 'Holiday name is required.').max(150),
  holiday_type: z.enum(typeValues).optional(),
  is_paid: z.boolean().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().nullish(),
});

const updateSchema = createSchema.partial().extend({
  holiday_date: z.string().min(1).refine(v => dateRegex.test(v), 'Holiday date must be YYYY-MM-DD.').optional(),
});

function vErr(res, parsed) {
  return sendError(
    res,
    ERROR_CODES.VALIDATION_ERROR,
    'Validation failed.',
    400,
    parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
  );
}

function sanitizeOrSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[,%_()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPayload(d) {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    if (typeof v === 'string') out[k] = v.trim() || null;
    else out[k] = v;
  }
  if (out.holiday_type === undefined || out.holiday_type === null) out.holiday_type = 'GENERAL';
  if (out.is_paid === undefined) out.is_paid = true;
  if (out.is_active === undefined) out.is_active = true;
  return out;
}

async function dateTaken(date, excludeId) {
  let q = supabase.from('holiday_master').select('id').eq('holiday_date', date);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return Boolean(data && data.length);
}

// GET /api/v1/holidays
router.get('/', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { search, year, is_active } = req.query;

  let q = supabase
    .from('holiday_master')
    .select(COLS)
    .order('holiday_date', { ascending: true });

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    q = q.or(`holiday_name.ilike.%${safeSearch}%,holiday_type.ilike.%${safeSearch}%,notes.ilike.%${safeSearch}%`);
  }

  if (year) {
    q = q.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
  }

  if (is_active === 'true' || is_active === 'false') {
    q = q.eq('is_active', is_active === 'true');
  }

  const { data, error } = await q;
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load holidays.', 500);
  return sendSuccess(res, data ?? []);
});

// GET /api/v1/holidays/:id
router.get('/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('holiday_master')
    .select(COLS)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Holiday not found.', 404);
  return sendSuccess(res, data);
});

// POST /api/v1/holidays
router.post('/', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);

  const d = cleanPayload(parsed.data);
  if (await dateTaken(d.holiday_date, null)) {
    return sendError(res, ERROR_CODES.CONFLICT, `Holiday already exists for ${d.holiday_date}.`, 409);
  }

  const { data, error } = await supabase
    .from('holiday_master')
    .insert(d)
    .select(COLS)
    .single();

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create holiday.', 500);
  return sendSuccess(res, data, 201);
});

async function updateHoliday(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);

  const { id } = req.params;
  const { data: existing } = await supabase
    .from('holiday_master')
    .select('id')
    .eq('id', id)
    .single();

  if (!existing) return sendError(res, ERROR_CODES.NOT_FOUND, 'Holiday not found.', 404);

  const d = cleanPayload(parsed.data);
  d.updated_at = new Date().toISOString();

  if (d.holiday_date && await dateTaken(d.holiday_date, id)) {
    return sendError(res, ERROR_CODES.CONFLICT, `Holiday already exists for ${d.holiday_date}.`, 409);
  }

  const { data, error } = await supabase
    .from('holiday_master')
    .update(d)
    .eq('id', id)
    .select(COLS)
    .single();

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update holiday.', 500);
  return sendSuccess(res, data);
}

router.patch('/:id', authenticate, roleGuard(WRITE_ROLES), updateHoliday);
router.put('/:id', authenticate, roleGuard(WRITE_ROLES), updateHoliday);

// DELETE /api/v1/holidays/:id
// Safe delete: deactivate holiday.
router.delete('/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('holiday_master')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select(COLS)
    .single();

  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Holiday not found or failed to deactivate.', 404);
  return sendSuccess(res, { ...data, deleted: false, is_active: false });
});

export default router;
