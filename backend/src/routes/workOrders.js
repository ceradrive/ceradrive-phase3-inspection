/**
 * CERADRIVE ERP — Work Order Routes (WO-B1)
 *
 * GET   /api/v1/work-orders/items              item_master live search (picker)
 * GET   /api/v1/work-orders/routings?item_id=  routing_headers for an item (picker)
 * GET   /api/v1/work-orders/boms?item_id=       bom_headers for an item (picker)
 * GET   /api/v1/work-orders/sku-plans?item_id=  sku_planning_header for an item (picker)
 * GET   /api/v1/work-orders/warehouses          active warehouses (picker)
 * GET   /api/v1/work-orders/master              list with filters (status, item_id, wo_date)
 * GET   /api/v1/work-orders/master/:id          single work order (header)
 * POST  /api/v1/work-orders/master              create (draft)
 * PATCH /api/v1/work-orders/master/:id          update (draft only)
 *
 * Route order: literal routes before /master/:id.
 * Auth: authenticate + requirePermission (PERM-1) on every route — NO role-name literals.
 * Handlers inline (BOM/Customer/Machine precedent). Draft CRUD only — no release/cancel/
 * complete/production-log routes in this batch.
 */

import { Router }               from 'express';
import { authenticate }         from '../middleware/authenticate.js';
import { requirePermission }    from '../middleware/requirePermission.js';
import { MODULES, WORK_ORDER_ACTIONS } from '../constants/permissions.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as woService from '../services/woService.js';

const router = Router();

const VIEW = requirePermission(MODULES.WORK_ORDER, WORK_ORDER_ACTIONS.VIEW);
const ADD  = requirePermission(MODULES.WORK_ORDER, WORK_ORDER_ACTIONS.ADD);
const EDIT = requirePermission(MODULES.WORK_ORDER, WORK_ORDER_ACTIONS.EDIT);
const RELEASE = requirePermission(MODULES.WORK_ORDER, WORK_ORDER_ACTIONS.RELEASE);

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

router.get('/items',
  authenticate, VIEW,
  async (req, res) => {
    const { search, limit } = req.query;
    const { data, error } = await woService.searchItems({ search, limit });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search items.', 500);
    return sendSuccess(res, data);
  },
);

router.get('/routings',
  authenticate, VIEW,
  async (req, res) => {
    const { data, error } = await woService.listRoutingsForItem(req.query.item_id);
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve routings.', 500);
    return sendSuccess(res, data);
  },
);

router.get('/boms',
  authenticate, VIEW,
  async (req, res) => {
    const { data, error } = await woService.listBomsForItem(req.query.item_id);
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve BOMs.', 500);
    return sendSuccess(res, data);
  },
);

router.get('/sku-plans',
  authenticate, VIEW,
  async (req, res) => {
    const { data, error } = await woService.listSkuPlansForItem(req.query.item_id);
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve SKU plans.', 500);
    return sendSuccess(res, data);
  },
);

router.get('/warehouses',
  authenticate, VIEW,
  async (req, res) => {
    const { data, error } = await woService.listWarehouses();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve warehouses.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master',
  authenticate, VIEW,
  async (req, res) => {
    const { status, item_id, wo_date, page, limit } = req.query;
    const { data, count, error } = await woService.listWorkOrders({
      status, item_id, wo_date,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve work orders.', 500);
    return sendSuccess(res, data, 200, {
      page:  Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
      total: count ?? 0,
    });
  },
);

// ─── GET /master/:id — single ─────────────────────────────────────────────────

router.get('/master/:id',
  authenticate, VIEW,
  async (req, res) => {
    const { data, error } = await woService.getWorkOrderById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Work order not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — manual create disabled ────────────────────────────────────

router.post('/master',
  authenticate, ADD,
  async (req, res) => {
    return sendError(
      res,
      ERROR_CODES.VALIDATION_ERROR,
      'Manual work order creation is disabled. Generate work orders from PPO.',
      400,
    );
  },
);

// ─── PATCH /master/:id — update (draft only) ──────────────────────────────────

router.patch('/master/:id',
  authenticate, EDIT,
  async (req, res) => {
    try {
      const { data, error } = await woService.updateDraftWorkOrder(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/release — release draft (snapshot steps + components) ───

router.post('/master/:id/release',
  authenticate, RELEASE,
  async (req, res) => {
    try {
      const { data, error } = await woService.releaseWorkOrder(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/complete — released → completed ─────────────────────────

router.post('/master/:id/complete',
  authenticate, RELEASE,
  async (req, res) => {
    try {
      const { data, error } = await woService.completeWorkOrder(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/close — completed → closed ──────────────────────────────

router.post('/master/:id/close',
  authenticate, RELEASE,
  async (req, res) => {
    try {
      const { data, error } = await woService.closeWorkOrder(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/cancel — draft|released → cancelled ─────────────────────

router.post('/master/:id/cancel',
  authenticate, RELEASE,
  async (req, res) => {
    try {
      const { data, error } = await woService.cancelWorkOrder(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
