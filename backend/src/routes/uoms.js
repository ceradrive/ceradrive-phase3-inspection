/**
 * CERADRIVE ERP — UOM Master Routes
 *
 * GET    /api/v1/uoms/search                 active UOM live search (picker)
 * GET    /api/v1/uoms/master                 list (search, is_active, pagination)
 * GET    /api/v1/uoms/master/:id             single UOM
 * POST   /api/v1/uoms/master                 create (manual code; dup -> 409)
 * PATCH  /api/v1/uoms/master/:id             update (uom_code read-only)
 * POST   /api/v1/uoms/master/:id/toggle-active   set is_active to the supplied value
 *
 * Route order: literal routes (/search, /master) before /master/:id.
 * Auth: authenticate + roleGuard on every route (per locked decision — not requirePermission).
 * READ = ALL_ROLES; WRITE = [ADMIN, STORE_MANAGER]. Handlers inline (Customer/Item precedent).
 * CRUD only — no delete, no import/export.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as uomService from '../services/uomService.js';

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

// ─── GET /search — active UOM picker ──────────────────────────────────────────

router.get('/search',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, limit } = req.query;
    const { data, error } = await uomService.searchUoms({ search, limit });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search UOMs.', 500);
    return sendSuccess(res, data);
  },
);


router.get('/conversions',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await uomService.listUomConversions();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve UOM conversions.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, is_active, page, limit } = req.query;
    const { data, count, error } = await uomService.listUoms({
      search, is_active,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve UOMs.', 500);
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
    const { data, error } = await uomService.getUomById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'UOM not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — create ────────────────────────────────────────────────────

router.post('/master',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await uomService.createUom(req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── PATCH /master/:id — update (uom_code read-only) ──────────────────────────

router.patch('/master/:id',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await uomService.updateUom(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/toggle-active — set is_active to supplied value ─────────

router.post('/master/:id/toggle-active',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await uomService.toggleUomActive(req.params.id, req.body.is_active, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
