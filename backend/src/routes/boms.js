/**
 * CERADRIVE ERP — BOM Routes
 *
 * GET    /api/v1/boms/types                active BOM types (mandatory picker source)
 * GET    /api/v1/boms/items                item_master live search (parent + component picker)
 * GET    /api/v1/boms/uoms                 active uom_master list (line UOM picker)
 * GET    /api/v1/boms/master               list with filters
 * GET    /api/v1/boms/master/:id           single BOM (header + lines)
 * POST   /api/v1/boms/master               create (draft; header + lines)
 * PATCH  /api/v1/boms/master/:id           update header + lines (lines: { add, update, remove })
 *
 * Route order: literal routes (/types, /items, /uoms, /master) before /master/:id.
 * Auth: authenticate + roleGuard on every route.
 * Handlers inline (Customer/Machine precedent) — a controller would exceed the approved 6-file scope.
 * Header/lines transactional logic lives in bomService (PO pattern). CRUD only — no lifecycle routes.
 *
 * Roles: only confirmed-existing roles used. WRITE limited to ADMIN + STORE_MANAGER (mirrors
 * Customer/Machine). A BOM-owning role (e.g. PLANNER) can be added once confirmed in constants/roles.js.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as bomService from '../services/bomService.js';

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

// ─── GET /types — active BOM types ────────────────────────────────────────────

router.get('/types',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await bomService.listBomTypes();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve BOM types.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /items — item_master live search ─────────────────────────────────────

router.get('/items',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, limit } = req.query;
    const { data, error } = await bomService.searchBomItems({ search, limit });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search items.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /uoms — active UOM list ──────────────────────────────────────────────

router.get('/uoms',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await bomService.listBomUoms();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve UOMs.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { status, bom_type_id, page, limit } = req.query;
    const { data, count, error } = await bomService.listBoms({
      status, bom_type_id,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve BOMs.', 500);
    return sendSuccess(res, data, 200, {
      page:  Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
      total: count ?? 0,
    });
  },
);

// ─── GET /master/:id — single (header + lines) ────────────────────────────────

router.get('/master/:id',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await bomService.getBomById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'BOM not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — create (draft) ────────────────────────────────────────────

router.post('/master',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await bomService.createBom(req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── PATCH /master/:id — update header + lines ────────────────────────────────

router.patch('/master/:id',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await bomService.updateDraftBom(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
