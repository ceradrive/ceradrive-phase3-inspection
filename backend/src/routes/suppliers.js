/**
 * CERADRIVE ERP — Supplier Routes
 *
 * GET    /api/v1/suppliers                    live search (Create PO dropdown)
 * GET    /api/v1/suppliers/master             list with filters
 * GET    /api/v1/suppliers/master/:id         single supplier
 * POST   /api/v1/suppliers/master             create (mandatory: code + name only)
 * PATCH  /api/v1/suppliers/master/:id         update any field
 * POST   /api/v1/suppliers/master/:id/toggle-active
 *
 * Route order: /master before /:id — prevents Express swallowing 'master' as :id.
 * Auth: authenticate + roleGuard on every route.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as supplierService from '../services/supplierService.js';

const router = Router();

const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER, ROLES.PURCHASE_OFFICER];
const ADMIN_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}

// ─── GET / — live search for Create PO dropdown ───────────────────────────────

router.get('/',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, limit } = req.query;
    const { data, error } = await supplierService.searchSuppliers({ search, limit });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search suppliers.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, is_active, page, limit } = req.query;
    const { data, count, error } = await supplierService.listSuppliers({
      search, is_active,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve suppliers.', 500);
    return sendSuccess(res, data, 200, {
      page:  Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
      total: count ?? 0,
    });
  },
);

// ─── GET /master/:id — single ─────────────────────────────────────────────────

router.get('/master/:id',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await supplierService.getSupplierById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Supplier not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — create ────────────────────────────────────────────────────

router.post('/master',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await supplierService.createSupplier(req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── PATCH /master/:id — update ───────────────────────────────────────────────

router.patch('/master/:id',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await supplierService.updateSupplier(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/toggle-active ──────────────────────────────────────────

router.post('/master/:id/toggle-active',
  authenticate, roleGuard(ADMIN_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await supplierService.toggleSupplierActive(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
