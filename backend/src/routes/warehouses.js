/**
 * CERADRIVE ERP — Warehouse Routes
 *
 * GET    /api/v1/warehouses                    list (search, is_active, warehouse_type_id, page, limit)
 * GET    /api/v1/warehouses/types              warehouse_types lookup for dropdowns
 * GET    /api/v1/warehouses/:id                single warehouse
 * POST   /api/v1/warehouses                    create
 * PATCH  /api/v1/warehouses/:id                update name / type / notes
 * POST   /api/v1/warehouses/:id/toggle-active  activate / deactivate
 *
 * Route order: /types before /:id — prevents Express swallowing 'types' as an :id param.
 * Auth: authenticate + roleGuard on every route.
 * Write roles: Admin, Store Manager.
 * Toggle-active role: Admin, Store Manager.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as warehouseService from '../services/warehouseService.js';

const router = Router();

const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}

// ─── GET / — list ─────────────────────────────────────────────────────────────

router.get('/',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, is_active, warehouse_type_id, page, limit } = req.query;
    const { data, count, error } = await warehouseService.listWarehouses({
      search, is_active, warehouse_type_id,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve warehouses.', 500);
    return sendSuccess(res, data, 200, {
      page:  Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
      total: count ?? 0,
    });
  },
);

// ─── GET /types — lookup (MUST be before /:id) ────────────────────────────────

router.get('/types',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await warehouseService.listWarehouseTypes();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve warehouse types.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /:id — single ────────────────────────────────────────────────────────

router.get('/:id',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await warehouseService.getWarehouseById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Warehouse not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST / — create ──────────────────────────────────────────────────────────

router.post('/',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await warehouseService.createWarehouse(req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── PATCH /:id — update ──────────────────────────────────────────────────────

router.patch('/:id',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await warehouseService.updateWarehouse(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /:id/toggle-active ──────────────────────────────────────────────────

router.post('/:id/toggle-active',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await warehouseService.toggleWarehouseActive(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
