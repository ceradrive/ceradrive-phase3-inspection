/**
 * CERADRIVE ERP — Purchase Bill Controller (PB-1)
 * HTTP handlers for Purchase Bill endpoints.
 * PB-1: create draft from posted GRN + read (get/list).
 * No approve, no cancel, no payment (later phases).
 */

import { sendSuccess, sendError, ERROR_CODES, httpForCode, normalizePagination } from '../utils/response.js';
import * as purchaseBillService from '../services/purchaseBillService.js';
import { createBillSchema } from '../validators/purchaseBillValidator.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/purchase-bills
 * List Purchase Bills. Filters: supplier_id, grn_id, status + pagination.
 */
export async function listBills(req, res) {
  const { supplier_id, grn_id, status, page = 1, limit = 20 } = req.query;
  const pagination = normalizePagination({ page, limit }, { defaultLimit: 20, maxLimit: 100 });

  const { data, count, error } = await purchaseBillService.listPurchaseBills({
    supplier_id,
    grn_id,
    status,
    page:  pagination.page,
    limit: pagination.limit,
  });

  if (error) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve Purchase Bills.', 500);
  }

  return sendSuccess(res, data, 200, {
    page:  pagination.page,
    limit: pagination.limit,
    total: count ?? 0,
  });
}

/**
 * GET /api/v1/purchase-bills/:id
 * Get full Purchase Bill detail (header + lines).
 */
export async function getBill(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid Purchase Bill id.', 400);

  const { data, error } = await purchaseBillService.getBillById(id);
  if (error) {
    if (error.code === 'NOT_FOUND' || error.message?.includes('not found')) {
      return sendError(res, ERROR_CODES.NOT_FOUND, 'Purchase Bill not found.', 404);
    }
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve Purchase Bill.', 500);
  }

  return sendSuccess(res, data);
}

/**
 * POST /api/v1/purchase-bills
 * Create a DRAFT Purchase Bill from a posted GRN. Body: { grn_id }.
 */
export async function createBill(req, res) {
  const parsed = createBillSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
  }

  const { data, error } = await purchaseBillService.createBillFromGRN(parsed.data.grn_id, req.user.id);
  if (error) {
    return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  }

  return sendSuccess(res, data, 201);
}

/**
 * POST /api/v1/purchase-bills/:id/approve
 * PB-3 status-only approval: draft -> approved. No AP ledger / inventory mutation.
 */
export async function approveBill(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Invalid Purchase Bill id.', 400);

  const { data, error } = await purchaseBillService.approveBill(id, req.user?.id ?? null);
  if (error) {
    return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  }

  return sendSuccess(res, data, 200);
}

