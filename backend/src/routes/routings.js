/**
 * CERADRIVE ERP — Routing Master Routes  (UI: "Process Flow" / Routing Master)
 *
 * GET    /api/v1/routings/types            active routing_types (header picker source)
 * GET    /api/v1/routings/items            item_master live search (header item + step input/output picker)
 * GET    /api/v1/routings/process-types    active process_types (step process picker)
 * GET    /api/v1/routings/master           list with filters (status, routing_type_id, item_id)
 * GET    /api/v1/routings/master/:id        single routing (header + steps)
 * POST   /api/v1/routings/master           create (draft; header + steps)
 * PATCH  /api/v1/routings/master/:id        update draft header + steps (steps: { add, update, remove })
 *
 * Route order: literal routes (/types, /items, /process-types, /master) before /master/:id.
 * Auth: authenticate + roleGuard on every route.
 * Handlers inline (BOM / Customer / Machine precedent) — no controller file.
 * Header/steps transactional logic lives in routingService (BOM / PO pattern). CRUD only —
 * no lifecycle routes (activation / supersede deferred).
 *
 * Roles: only confirmed-existing roles used. WRITE limited to ADMIN + STORE_MANAGER (mirrors BOM).
 * A routing-owning role can be added once confirmed in constants/roles.js.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as routingService from '../services/routingService.js';

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

// ─── GET /types — active routing types ────────────────────────────────────────

router.get('/types',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await routingService.listRoutingTypes();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve routing types.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /items — item_master live search ─────────────────────────────────────

router.get('/items',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, limit } = req.query;
    const { data, error } = await routingService.searchRoutingItems({ search, limit });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search items.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /process-types — active process types ────────────────────────────────

router.get('/process-types',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await routingService.listProcessTypes();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve process types.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { status, routing_type_id, item_id, page, limit } = req.query;
    const { data, count, error } = await routingService.listRoutings({
      status, routing_type_id, item_id,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve routings.', 500);
    return sendSuccess(res, data, 200, {
      page:  Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
      total: count ?? 0,
    });
  },
);

// ─── GET /master/:id — single (header + steps) ────────────────────────────────

router.get('/master/:id',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await routingService.getRoutingById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Routing not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — create (draft) ────────────────────────────────────────────

router.post('/master',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingService.createRouting(req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── PATCH /master/:id — update draft header + steps ──────────────────────────

router.patch('/master/:id',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingService.updateDraftRouting(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/activate — draft → active ───────────────────────────────

router.post('/master/:id/activate',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingService.activateRouting(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/supersede — active → superseded (explicit retire) ────────

router.post('/master/:id/supersede',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingService.supersedeRouting(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/new-version — clone header + steps into a new draft ──────

router.post('/master/:id/new-version',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingService.createNewVersion(req.params.id, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
