/**
 * CERADRIVE ERP — Purchase Order Controller
 * Phase 9A: Read handlers.
 * Phase 9B: Write handlers added.
 */

import { sendSuccess, sendError, ERROR_CODES, httpForCode, normalizePagination } from '../utils/response.js';
import * as purchaseService     from '../services/purchaseService.js';
import { PO_STATUS }            from '../constants/statuses.js';
import {
  createPOSchema,
  updateDraftPOSchema,
  updateApprovedPOSchema,
  closePOSchema,
  cancelPOSchema,
} from '../validators/poValidator.js';

// ─── Phase 9A — Read Handlers ─────────────────────────────────────────────────

export async function listPurchaseOrders(req, res) {
  const {
    status, supplier_id, date_from, date_to,
    derived_receipt_status, page = 1, limit = 20,
  } = req.query;

  const pagination = normalizePagination({ page, limit }, { defaultLimit: 20, maxLimit: 100 });

  const { data, count, error } = await purchaseService.listPurchaseOrders({
    status, supplier_id, date_from, date_to,
    derived_receipt_status,
    page: pagination.page,
    limit: pagination.limit,
  });

  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve Purchase Orders.', 500);

  return sendSuccess(res, data, 200, {
    page:  pagination.page,
    limit: pagination.limit,
    total: count ?? 0,
  });
}

export async function getPurchaseOrder(req, res) {
  const { data, error } = await purchaseService.getPurchaseOrderById(req.params.id);
  if (error) return sendError(res, ERROR_CODES.NOT_FOUND, 'Purchase Order not found.', 404);
  return sendSuccess(res, data);
}

export async function getPOReceiptStatus(req, res) {
  const { data, error } = await purchaseService.getPOReceiptStatus(req.params.id);
  if (error) return sendError(res, ERROR_CODES.NOT_FOUND, 'Purchase Order not found.', 404);
  return sendSuccess(res, data);
}

// ─── Phase 9B — Write Handlers ────────────────────────────────────────────────

export async function createPurchaseOrder(req, res) {
  const parsed = createPOSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR,
      'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    );
  }

  const { data, error } = await purchaseService.createPurchaseOrder(
    parsed.data, req.user.id
  );
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data, 201);
}

export async function updatePurchaseOrder(req, res) {
  const currentStatus = req.purchaseOrder?.status;

  // Route to correct schema based on current status
  if (currentStatus === PO_STATUS.APPROVED) {
    const parsed = updateApprovedPOSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR,
        'Validation failed.', 400,
        parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      );
    }
    const { data, error } = await purchaseService.updateApprovedPO(req.params.id, parsed.data);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
    return sendSuccess(res, data);
  }

  if (currentStatus === PO_STATUS.CLOSED || currentStatus === PO_STATUS.CANCELLED) {
    return sendError(res, ERROR_CODES.FORBIDDEN,
      'Closed and Cancelled Purchase Orders cannot be edited.', 403);
  }

  // Draft — full edit
  const parsed = updateDraftPOSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR,
      'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    );
  }
  const { data, error } = await purchaseService.updateDraftPO(req.params.id, parsed.data);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
}

export async function approvePurchaseOrder(req, res) {
  // ALR-04 enforced inside service — throws CONFLICT if no lines
  const { data, error } = await purchaseService.approvePurchaseOrder(req.params.id, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
}


export async function createGRNFromPurchaseOrder(req, res) {
  const { data, error } = await purchaseService.createGRNFromPurchaseOrder(
    req.params.id,
    req.body,
    req.user.id
  );

  if (error) {
    return sendError(
      res,
      error.code ?? ERROR_CODES.INTERNAL_ERROR,
      error.message ?? 'Failed to create GRN from Purchase Order.',
      error.status ?? httpForCode(error.code)
    );
  }

  return sendSuccess(res, data, 201);
}



export async function postDraftGRNForPurchaseOrder(req, res) {
  const { data, error } = await purchaseService.postDraftGRNForPurchaseOrder(
    req.params.id,
    req.user.id
  );

  if (error) {
    return sendError(
      res,
      error.code ?? ERROR_CODES.INTERNAL_ERROR,
      error.message ?? 'Failed to post GRN.',
      error.status ?? httpForCode(error.code)
    );
  }

  return sendSuccess(res, data);
}


export async function closePurchaseOrder(req, res) {
  const parsed = closePOSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR,
      'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    );
  }
  // POSHORTCLOSE: pass reason + acting user through to the service.
  const { data, error } = await purchaseService.closePurchaseOrder(
    req.params.id, parsed.data.confirm_short_close, parsed.data.reason ?? null, req.user.id
  );
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
}

export async function cancelPurchaseOrder(req, res) {
  const parsed = cancelPOSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR,
      'Validation failed.', 400,
      parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    );
  }
  const { data, error } = await purchaseService.cancelPurchaseOrder(
    req.params.id, req.user.id, parsed.data.cancellation_reason
  );
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
}
