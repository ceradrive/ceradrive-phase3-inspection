import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';

const router = Router();

const READ_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.PURCHASE_OFFICER,
  ROLES.WAREHOUSE_OPERATOR,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
];

const WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
];

const FIXED_SERIES = [
  'PO',
  'SO',
  'PR',
  'GRN',
  'WORK_ORDER',
  'QC',
  'FPA',
  'BOM',
];

const LABELS = {
  PO: 'Purchase Order',
  SO: 'Sales Order',
  PR: 'Purchase Requirement',
  GRN: 'Goods Receipt Note',
  WORK_ORDER: 'Work Order',
  QC: 'Quality Check',
  FPA: 'First Piece Approval',
  BOM: 'Bill of Materials',
};

const COLS = `
  id,
  series_code,
  document_type,
  prefix_template,
  pattern_template,
  suffix_template,
  number_width,
  current_number,
  reset_frequency,
  last_reset_at,
  is_active,
  is_default,
  financial_year_start_month,
  updated_by,
  updated_at
`;

const patchSchema = z.object({
  pattern_template: z.string().trim().min(1).max(255).optional(),
  suffix_template: z.string().trim().max(100).nullable().optional(),
  current_number: z.coerce.number().int().min(0).optional(),
  reset_frequency: z.enum(['YEARLY', 'NEVER']).optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  financial_year_start_month: z.coerce.number().int().min(1).max(12).optional(),
});

function buildPreview(row) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const fyStartMonth = Number(row.financial_year_start_month || 4);
  const fyStartYear = month >= fyStartMonth ? year : year - 1;
  const fyEndYear = fyStartYear + 1;

  let pattern = row.pattern_template || `${row.prefix_template || ''}${'#'.repeat(Number(row.number_width || 4))}`;
  const suffix = row.suffix_template || '';
  const next = Number(row.current_number || 0) + 1;

  const match = pattern.match(/#+/);
  const width = match ? match[0].length : Number(row.number_width || 4);
  const seq = String(next).padStart(width, '0');

  pattern = pattern
    .replaceAll('{YYYY}', String(year))
    .replaceAll('{YY}', String(year).slice(-2))
    .replaceAll('{FY}', `${String(fyStartYear).slice(-2)}${String(fyEndYear).slice(-2)}`)
    .replaceAll('{MM}', String(month).padStart(2, '0'))
    .replaceAll('{DD}', String(day).padStart(2, '0'));

  if (match) {
    pattern = pattern.replace(/#+/, seq);
  } else {
    pattern += seq;
  }

  return `${pattern}${suffix}`;
}

function decorate(row) {
  return {
    ...row,
    document_label: LABELS[row.series_code] || row.document_type || row.series_code,
    next_preview: buildPreview(row),
  };
}

function prefixFromPattern(pattern) {
  const idx = pattern.search(/#+/);
  if (idx === -1) return pattern;
  return pattern.slice(0, idx);
}

router.get('/', authenticate, roleGuard(READ_ROLES), async (_req, res) => {
  const { data, error } = await supabase
    .from('number_series')
    .select(COLS)
    .in('series_code', FIXED_SERIES);

  if (error) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load number series.', 500);
  }

  const rows = (data || [])
    .sort((a, b) => FIXED_SERIES.indexOf(a.series_code) - FIXED_SERIES.indexOf(b.series_code))
    .map(decorate);

  return sendSuccess(res, rows);
});

router.get('/:code', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();

  if (!FIXED_SERIES.includes(code)) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid fixed series code.', 400);
  }

  const { data, error } = await supabase
    .from('number_series')
    .select(COLS)
    .eq('series_code', code)
    .single();

  if (error || !data) {
    return sendError(res, ERROR_CODES.NOT_FOUND, 'Number series not found.', 404);
  }

  return sendSuccess(res, decorate(data));
});

router.patch('/:code', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();

  if (!FIXED_SERIES.includes(code)) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid fixed series code.', 400);
  }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(
      res,
      ERROR_CODES.VALIDATION_ERROR,
      'Validation failed.',
      400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    );
  }

  const patch = { ...parsed.data };

  if (patch.pattern_template !== undefined) {
    if (!/#+/.test(patch.pattern_template)) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Pattern must contain sequence placeholders like ### or ####.', 400);
    }

    const match = patch.pattern_template.match(/#+/);
    patch.number_width = match ? match[0].length : patch.number_width;
    patch.prefix_template = prefixFromPattern(patch.pattern_template);
  }

  if (patch.suffix_template === '') {
    patch.suffix_template = null;
  }

  patch.updated_by = req.user.id;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('number_series')
    .update(patch)
    .eq('series_code', code)
    .select(COLS)
    .single();

  if (error) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update number series.', 500);
  }

  return sendSuccess(res, decorate(data));
});

export default router;
