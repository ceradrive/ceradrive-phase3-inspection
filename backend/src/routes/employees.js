/**
 * CERADRIVE ERP — Employee / Worker Master Routes.
 *
 * UI label: Employee Master
 * DB table: worker_master
 * Base: /api/v1/employees
 *
 * Simple worker master with salary/shift/OT fields. This is NOT full payroll.
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
  'worker_code',
  'worker_name',
  'department',
  'designation',
  'phone',
  'monthly_salary',
  'shift_start_time',
  'shift_end_time',
  'standard_hours_per_day',
  'ot_eligible',
  'skill_category_id',
  'is_active',
  'notes',
  'created_at',
  'updated_at',
].join(', ');

const codeRegex = /^[A-Z0-9_-]+$/;

function normalizeCode(v) {
  return String(v || '').trim().toUpperCase();
}

const baseSchema = {
  worker_code: z.string()
    .min(1, 'Employee code is required.')
    .max(40, 'Employee code is too long.')
    .transform(normalizeCode)
    .refine(v => codeRegex.test(v), 'Employee code can contain only A-Z, 0-9, underscore and hyphen.'),
  worker_name: z.string().min(1, 'Employee name is required.').max(120),
  department: z.string().max(120).nullish(),
  designation: z.string().max(120).nullish(),
  phone: z.string().max(30).nullish(),
  monthly_salary: z.coerce.number().min(0, 'Monthly salary cannot be negative.').optional(),
  shift_start_time: z.string().min(1).optional(),
  shift_end_time: z.string().min(1).optional(),
  standard_hours_per_day: z.coerce.number().min(0.01).max(24).optional(),
  ot_eligible: z.boolean().optional(),
  skill_category_id: z.string().uuid().nullish(),
  is_active: z.boolean().optional(),
  notes: z.string().nullish(),
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object({
  ...baseSchema,
  worker_code: baseSchema.worker_code.optional(),
  worker_name: baseSchema.worker_name.optional(),
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
  let q = supabase.from('worker_master').select('id').eq('worker_code', normalizeCode(code));
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
  if (out.worker_code) out.worker_code = normalizeCode(out.worker_code);
  if (out.monthly_salary === undefined) out.monthly_salary = 0;
  if (out.shift_start_time === undefined) out.shift_start_time = '09:00';
  if (out.shift_end_time === undefined) out.shift_end_time = '17:30';
  if (out.standard_hours_per_day === undefined) out.standard_hours_per_day = 8;
  if (out.ot_eligible === undefined) out.ot_eligible = true;
  if (out.is_active === undefined) out.is_active = true;
  return out;
}

// GET /api/v1/employees
router.get('/', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { search, is_active } = req.query;

  let q = supabase
    .from('worker_master')
    .select(COLS)
    .order('is_active', { ascending: false })
    .order('worker_code', { ascending: true });

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    q = q.or(`worker_code.ilike.%${safeSearch}%,worker_name.ilike.%${safeSearch}%,department.ilike.%${safeSearch}%,designation.ilike.%${safeSearch}%`);
  }

  if (is_active === 'true' || is_active === 'false') {
    q = q.eq('is_active', is_active === 'true');
  }

  const { data, error } = await q;
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load employees.', 500);
  return sendSuccess(res, data ?? []);
});

// GET /api/v1/employees/:id
router.get('/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('worker_master')
    .select(COLS)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Employee not found.', 404);
  return sendSuccess(res, data);
});

// POST /api/v1/employees
router.post('/', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);

  const d = cleanPayload(parsed.data);
  if (await codeTaken(d.worker_code, null)) {
    return sendError(res, ERROR_CODES.CONFLICT, `Employee code '${d.worker_code}' already exists.`, 409);
  }

  const { data, error } = await supabase
    .from('worker_master')
    .insert(d)
    .select(COLS)
    .single();

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create employee.', 500);
  return sendSuccess(res, data, 201);
});

async function updateEmployee(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);

  const { id } = req.params;
  const { data: existing } = await supabase
    .from('worker_master')
    .select('id')
    .eq('id', id)
    .single();

  if (!existing) return sendError(res, ERROR_CODES.NOT_FOUND, 'Employee not found.', 404);

  const d = cleanPayload(parsed.data);
  delete d.created_at;
  d.updated_at = new Date().toISOString();

  if (d.worker_code && await codeTaken(d.worker_code, id)) {
    return sendError(res, ERROR_CODES.CONFLICT, `Employee code '${d.worker_code}' already exists.`, 409);
  }

  const { data, error } = await supabase
    .from('worker_master')
    .update(d)
    .eq('id', id)
    .select(COLS)
    .single();

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update employee.', 500);
  return sendSuccess(res, data);
}

router.patch('/:id', authenticate, roleGuard(WRITE_ROLES), updateEmployee);
router.put('/:id', authenticate, roleGuard(WRITE_ROLES), updateEmployee);

// DELETE /api/v1/employees/:id
// Safe delete: deactivate employee/worker.
router.delete('/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('worker_master')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select(COLS)
    .single();

  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Employee not found or failed to deactivate.', 404);
  return sendSuccess(res, { ...data, deleted: false, is_active: false });
});

export default router;
