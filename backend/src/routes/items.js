/**
 * CERADRIVE ERP — Item Master Routes (Phase 1A)
 *
 * Thin route layer over the existing itemService — no business logic here.
 * CRUD + lookups + search picker. No DELETE route in 1A (toggle-active covers
 * deactivation). Manual item codes, dedupe, soft-delete all live in itemService.
 *
 * Auth: authenticate + roleGuard on every route (same style as suppliers.js).
 *   READ_ROLES  = ALL_ROLES
 *   WRITE_ROLES = [ADMIN, STORE_MANAGER, PURCHASE_OFFICER]  (copied verbatim from suppliers.js)
 * Routes: literal (/lookups, /search, /master) before /master/:id.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as itemService     from '../services/itemService.js';

const router = Router();

const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER, ROLES.PURCHASE_OFFICER];

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}

// ─── GET /lookups — dropdown sources (item types, categories, uoms, tax) ──────

router.get('/lookups',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await itemService.getItemLookups();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load item lookups.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /search — live search picker ─────────────────────────────────────────

router.get('/search',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, limit, purchase_only, sales_only } = req.query;
    const { data, error } = await itemService.searchItems({ search, limit, purchase_only, sales_only });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search items.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list with filters ──────────────────────────────────────────

router.get('/master',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, is_active, item_type_id, category_id, page, limit } = req.query;
    const { data, count, error } = await itemService.listItemMaster({
      search, is_active, item_type_id, category_id,
      page:  Number(page)  || 1,
      limit: Number(limit) || 20,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve items.', 500);
    return sendSuccess(res, data, 200, {
      page:  Number(page) || 1,
      limit: Number(limit) || 20,
      total: count ?? 0,
    });
  },
);

// ─── GET /master/:id — single item ────────────────────────────────────────────

router.get('/master/:id',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await itemService.getItemById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Item not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── 10G: GET /master/:id/vehicles — compatible vehicles + default ────────────
router.get('/master/:id/vehicles',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await itemService.getItemVehicles(req.params.id);
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load item vehicles.', 500);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — create (manual code; dedupe + DB constraints enforce) ─────

router.post('/master',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await itemService.createItem(req.body, req.user.id);
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
      const { data, error } = await itemService.updateItem(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/toggle-active ───────────────────────────────────────────

router.post('/master/:id/toggle-active',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await itemService.toggleItemActive(req.params.id, req.body.is_active, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
