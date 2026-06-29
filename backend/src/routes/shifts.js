/**
 * CERADRIVE ERP — Shift Master Routes.
 *
 * DB table: shift_master
 * Base: /api/v1/shifts
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
  'shift_code',
  'shift_name',
  'start_time',
  'end_time',
  'crosses_midnight',
  'working_days',
  'is_active',
  'notes',
  'created_at',
  'updated_at',
].join(', ');

const codeRegex = /^[A-Z0-9_-]+$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function normalizeCode(v) {
  return String(v || '').trim().toUpperCase();
}

function cleanTime(v) {
  const s = String(v || '').trim();
  if (!s) return s;
  return s.length === 5 ? `${s}:00` : s;
}

const baseSchema = {
  shift_code: z.string()
    .min(1, 'Shift code is required.')
    .max(40, 'Shift code is too long.')
    .transform(normalizeCode)
    .refine(v => codeRegex.test(v), 'Shift code can contain only A-Z, 0-9, underscore and hyphen.'),
  shift_name: z.string().min(1, 'Shift name is required.').max(120),
  start_time: z.string().min(1, 'Start time is required.').transform(cleanTime)
    .refine(v => timeRegex.test(v), 'Start time must be HH:MM.'),
  end_time: z.string().min(1, 'End time is required.').transform(cleanTime)
    .refine(v => timeRegex.test(v), 'End time must be HH:MM.'),
  crosses_midnight: z.boolean().optional(),
  working_days: z.string().max(80).nullish(),
  is_active: z.boolean().optional(),
  notes: z.string().nullish(),
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object({
  ...baseSchema,
  shift_code: baseSchema.shift_code.optional(),
  shift_name: baseSchema.shift_name.optional(),
  start_time: baseSchema.start_time.optional(),
  end_time: baseSchema.end_time.optional(),
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

async function codeTaken(code, excludeId) {
  let q = supabase.from('shift_master').select('id').eq('shift_code', normalizeCode(code));
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return Boolean(data && data.length);
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
  if (out.shift_code) out.shift_code = normalizeCode(out.shift_code);
  if (out.start_time) out.start_time = cleanTime(out.start_time);
  if (out.end_time) out.end_time = cleanTime(out.end_time);
  if (out.crosses_midnight === undefined) out.crosses_midnight = false;
  if (out.working_days === undefined) out.working_days = 'MON-SAT';
  if (out.is_active === undefined) out.is_active = true;
  return out;
}

// GET /api/v1/shifts
router.get('/', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { search, is_active } = req.query;

  let q = supabase
    .from('shift_master')
    .select(COLS)
    .order('is_active', { ascending: false })
    .order('shift_code', { ascending: true });

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    q = q.or(`shift_code.ilike.%${safeSearch}%,shift_name.ilike.%${safeSearch}%,working_days.ilike.%${safeSearch}%`);
  }

  if (is_active === 'true' || is_active === 'false') {
    q = q.eq('is_active', is_active === 'true');
  }

  const { data, error } = await q;
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load shifts.', 500);
  return sendSuccess(res, data ?? []);
});

// GET /api/v1/shifts/:id
router.get('/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('shift_master')
    .select(COLS)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Shift not found.', 404);
  return sendSuccess(res, data);
});

// POST /api/v1/shifts
router.post('/', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);

  const d = cleanPayload(parsed.data);
  if (await codeTaken(d.shift_code, null)) {
    return sendError(res, ERROR_CODES.CONFLICT, `Shift code '${d.shift_code}' already exists.`, 409);
  }

  const { data, error } = await supabase
    .from('shift_master')
    .insert(d)
    .select(COLS)
    .single();

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create shift.', 500);
  return sendSuccess(res, data, 201);
});

async function updateShift(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);

  const { id } = req.params;
  const { data: existing } = await supabase
    .from('shift_master')
    .select('id')
    .eq('id', id)
    .single();

  if (!existing) return sendError(res, ERROR_CODES.NOT_FOUND, 'Shift not found.', 404);

  const d = cleanPayload(parsed.data);
  d.updated_at = new Date().toISOString();

  if (d.shift_code && await codeTaken(d.shift_code, id)) {
    return sendError(res, ERROR_CODES.CONFLICT, `Shift code '${d.shift_code}' already exists.`, 409);
  }

  const { data, error } = await supabase
    .from('shift_master')
    .update(d)
    .eq('id', id)
    .select(COLS)
    .single();

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update shift.', 500);
  return sendSuccess(res, data);
}

router.patch('/:id', authenticate, roleGuard(WRITE_ROLES), updateShift);
router.put('/:id', authenticate, roleGuard(WRITE_ROLES), updateShift);

// DELETE /api/v1/shifts/:id
// Safe delete: deactivate shift.
router.delete('/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('shift_master')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select(COLS)
    .single();

  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Shift not found or failed to deactivate.', 404);
  return sendSuccess(res, { ...data, deleted: false, is_active: false });
});

export default router;
