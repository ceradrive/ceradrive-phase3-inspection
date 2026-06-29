/**
 * CERADRIVE ERP — Internal Production Plan Routes (P-3E.2)
 *
 * POST   /api/v1/internal-production-plans            create from selected internal items
 * GET    /api/v1/internal-production-plans            list (status filter + pagination)
 * GET    /api/v1/internal-production-plans/:id        single plan (header + lines)
 * POST   /api/v1/internal-production-plans/:id/cancel cancel (DRAFT or APPROVED only)
 *
 * Route order: static/literal segments before /:id. authenticate + roleGuard on every
 * route. create / list / get / cancel ONLY — approval (recipe/routing resolution) and
 * downstream manufacturing-order generation are NOT here.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as service from '../services/internalProductionPlanService.js';

const router = Router();

const READ_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
];

const WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
];

function httpForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}

// ─── POST / — create from selected internal items ─────────────────────────────
router.post('/',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.createPlanFromSelected(req.body?.items, req.user.id, req.body?.notes);
    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to create internal production plan.',
        error.status || httpForCode(error.code)
      );
    }
    return sendSuccess(res, data, 201);
  }
);

// ─── GET / — list (status filter + pagination) ────────────────────────────────
router.get('/',
  authenticate,
  roleGuard(READ_ROLES),
  async (req, res) => {
    const { status, page, limit } = req.query;
    const { data, count, error } = await service.listPlans({
      status,
      page: Number(page) || 1,
      limit: Number(limit) || 50,
    });
    if (error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load internal production plans.', 500);
    }
    return sendSuccess(res, data, 200, {
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 50, 200),
      total: count ?? 0,
    });
  }
);

// ─── POST /:id/cancel — cancel (DRAFT or APPROVED only) ───────────────────────
router.post('/:id/cancel',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.cancelPlan(req.params.id, req.user.id, req.body?.reason);
    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to cancel internal production plan.',
        error.status || httpForCode(error.code)
      );
    }
    return sendSuccess(res, data);
  }
);

// ─── POST /:id/approve — DRAFT -> APPROVED + stamp resolved recipe/routing ─────
router.post('/:id/approve',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.approvePlan(req.params.id, req.user.id);
    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to approve internal production plan.',
        error.status || httpForCode(error.code)
      );
    }
    return sendSuccess(res, data);
  }
);

// ─── POST /:id/generate-work-orders — APPROVED -> draft INTERNAL_PLAN WOs ─────
router.post('/:id/generate-work-orders',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.generateWorkOrdersFromInternalPlan(req.params.id, req.user.id);
    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to generate Work Orders from internal production plan.',
        error.status || httpForCode(error.code)
      );
    }
    return sendSuccess(res, data);
  }
);

// ─── POST /:id/prepare-work-orders — snapshot steps/components + readiness (draft) ─
router.post('/:id/prepare-work-orders',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.prepareWorkOrdersForInternalPlan(req.params.id, req.user.id);
    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to prepare Work Orders for internal production plan.',
        error.status || httpForCode(error.code)
      );
    }
    return sendSuccess(res, data);
  }
);

// ─── POST /:id/release-work-orders — recompute readiness + release READY/PARTIAL drafts ─
router.post('/:id/release-work-orders',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.releasePreparedWorkOrdersForInternalPlan(req.params.id, req.user.id);
    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to release Work Orders for internal production plan.',
        error.status || httpForCode(error.code)
      );
    }
    return sendSuccess(res, data);
  }
);

// ─── GET /:id — single plan (header + lines) ──────────────────────────────────
router.get('/:id',
  authenticate,
  roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await service.getPlanById(req.params.id);
    if (error) {
      return sendError(res, ERROR_CODES.NOT_FOUND, 'Internal production plan not found.', 404);
    }
    return sendSuccess(res, data);
  }
);

export default router;
