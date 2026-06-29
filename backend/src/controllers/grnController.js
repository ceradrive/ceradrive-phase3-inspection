/**
 * CERADRIVE ERP — GRN Controller
 *
 * HTTP handlers for GRN endpoints.
 * Phase 9A: Read handlers only.
 * Phase 9D/9E: Write handlers added.
 */

import { sendSuccess, sendError, ERROR_CODES, httpForCode, normalizePagination } from '../utils/response.js';
import * as grnService from '../services/grnService.js';
import * as inventoryPostingService from '../services/inventoryPostingService.js';
import { createGRNSchema, updateGRNSchema } from '../validators/grnValidator.js';

// Reject non-UUID :id params (e.g. /grns/new) with a clean 400 instead of letting
// a Postgres uuid cast error bubble up as a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Phase 9A — Read Handlers ─────────────────────────────────────────────────

/**
 * GET /api/v1/grns
 * List GRNs with filters and pagination.
 */
export async function listGRNs(req, res) {
  const {
    status,
    is_direct_grn,
    supplier_id,
    warehouse_id,
    po_id,
    date_from,
    date_to,
    page  = 1,
    limit = 20,
  } = req.query;

  const pagination = normalizePagination({ page, limit }, { defaultLimit: 20, maxLimit: 100 });

  const { data, count, error } = await grnService.listGRNs({
    status,
    is_direct_grn,
    supplier_id,
    warehouse_id,
    po_id,
    date_from,
    date_to,
    page:  pagination.page,
    limit: pagination.limit,
  });

  if (error) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve GRNs.', 500);
  }

  return sendSuccess(res, data, 200, {
    page:  pagination.page,
    limit: pagination.limit,
    total: count ?? 0,
  });
}

/**
 * GET /api/v1/grns/:id
 * Get full GRN detail.
 */
export async function getGRN(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid GRN id.', 400);

  const { data, error } = await grnService.getGRNById(id);

  if (error) {
    if (error.message?.includes('not found')) {
      return sendError(res, ERROR_CODES.NOT_FOUND, 'GRN not found.', 404);
    }
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve GRN.', 500);
  }

  return sendSuccess(res, data);
}

/**
 * GET /api/v1/grns/:id/lines
 * Get GRN line detail from v_grn_line_detail view.
 */
export async function getGRNLines(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid GRN id.', 400);

  const { data, error } = await grnService.getGRNLineDetail(id);

  if (error) {
    if (error.message?.includes('not found')) {
      return sendError(res, ERROR_CODES.NOT_FOUND, 'GRN not found.', 404);
    }
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve GRN lines.', 500);
  }

  return sendSuccess(res, data);
}

// ─── Phase 9E — Inventory Posting Handlers ───────────────────────────────────

/**
 * POST /api/v1/grns/:id/post
 * Post a draft GRN to inventory (atomic, idempotent). Result status in body.
 */
export async function postGRN(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid GRN id.', 400);
  const { data, error } = await inventoryPostingService.postGRN(id, req.user.id);
  if (error) {
    return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  }
  return sendSuccess(res, data, 200);
}

/**
 * POST /api/v1/grns/:id/cancel
 * Cancel a posted GRN (reversal). Negative stock is hard-blocked.
 */
export async function cancelGRN(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid GRN id.', 400);
  const reason = req.body?.reason ?? null;

  // GRNDRAFTCANCEL — branch by current status (same endpoint).
  const { data: existing, error: loadErr } = await grnService.getGRNById(id);
  if (loadErr || !existing) {
    return sendError(res, ERROR_CODES.NOT_FOUND, 'GRN not found.', 404);
  }

  // Draft -> soft discard (status only, no inventory, reason optional).
  if (existing.status === 'draft') {
    const { data, error } = await grnService.cancelDraftGRN(id, req.user.id, reason);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
    return sendSuccess(res, data, 200);
  }

  // Posted -> reversal via fn_cancel_grn, reason mandatory.
  if (existing.status === 'posted') {
    if (!reason || String(reason).trim().length < 1) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'A reason is required to cancel a posted GRN.', 400, [{ field: 'reason' }]);
    }
    const { data, error } = await inventoryPostingService.cancelGRN(id, req.user.id, String(reason).trim());
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
    return sendSuccess(res, data, 200);
  }

  return sendError(res, 'CONFLICT', `GRN is ${existing.status}; only a draft (discard) or posted (reversal) GRN can be cancelled.`, 409);
}

// ─── Phase 9G — Draft Create ──────────────────────────────────────────────────


export async function createGRN(req, res) {
  const parsed = createGRNSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
  }
  const { data, error } = await grnService.createGRN(parsed.data, req.user.id);
  if (error) {
    return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  }
  return sendSuccess(res, data, 201);
}

// ─── GRN1-DRAFT-EDIT — Draft Update Handler ───────────────────────────────────

/**
 * PATCH /api/v1/grns/:id
 * Update a draft GRN's line received_qty + unit_rate only. Draft-only
 * (enforced by grnStatusGuard at the route and re-checked in the service).
 */
export async function updateGRN(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid GRN id.', 400);

  const parsed = updateGRNSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
  }

  const { data, error } = await grnService.updateGRN(id, parsed.data, req.user.id);
  if (error) {
    return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  }
  return sendSuccess(res, data, 200);
}
