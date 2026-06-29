/**
 * CERADRIVE ERP — Routing Template Master Routes (T1)
 *
 * GET    /api/v1/routing-templates/process-types   active process_types (step picker)
 * GET    /api/v1/routing-templates/master          list (filters: search, is_active)
 * GET    /api/v1/routing-templates/master/:id      single template (header + steps)
 * POST   /api/v1/routing-templates/master          create (header + steps)
 * PATCH  /api/v1/routing-templates/master/:id      update header + steps ({ add, update, remove })
 * POST   /api/v1/routing-templates/master/:id/toggle-active
 * POST   /api/v1/routing-templates/master/:id/copy clone to a new template (new code)
 *
 * Route order: literal routes (/process-types, /master) before /master/:id; :id/<action> after.
 * Auth: authenticate + roleGuard on every route. WRITE limited to existing WRITE_ROLES.
 * Handlers inline (BOM / routing precedent). CRUD + copy + toggle only — no composer,
 * no routing_headers/steps writes, no lifecycle/versioning.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as routingTemplateService from '../services/routingTemplateService.js';

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

// ─── GET /process-types — active process types (step picker) ──────────────────

router.get('/process-types',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await routingTemplateService.listTemplateProcessTypes();
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve process types.', 500);
    return sendSuccess(res, data);
  },
);

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master',
  authenticate, roleGuard(READ_ROLES),
  async (req, res) => {
    const { search, is_active, page, limit } = req.query;
    const isActive = is_active === undefined ? undefined : is_active === 'true';
    const { data, count, error } = await routingTemplateService.listTemplates({
      search, isActive,
      page:  Number(page)  || 1,
      limit: Number(limit) || 50,
    });
    if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve routing templates.', 500);
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
    const { data, error } = await routingTemplateService.getTemplateById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Routing template not found.', 404);
    return sendSuccess(res, data);
  },
);

// ─── POST /master — create ────────────────────────────────────────────────────

router.post('/master',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingTemplateService.createTemplate(req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── PATCH /master/:id — update header + steps ────────────────────────────────

router.patch('/master/:id',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingTemplateService.updateTemplate(req.params.id, req.body, req.user.id);
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
      const { is_active } = req.body;
      const { data, error } = await routingTemplateService.toggleTemplateActive(req.params.id, is_active === true, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

// ─── POST /master/:id/copy — clone to a new template ──────────────────────────

router.post('/master/:id/copy',
  authenticate, roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await routingTemplateService.copyTemplate(req.params.id, req.body, req.user.id);
      if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
      return sendSuccess(res, data, 201);
    } catch (err) {
      return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
    }
  },
);

export default router;
