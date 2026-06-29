/**
 * CERADRIVE ERP — SKU Planning Master Routes (S1)
 *
 * GET    /api/v1/sku-planning/items            active item search (header picker)
 * GET    /api/v1/sku-planning/routings         active routings (+steps) for an item (seeding)
 * GET    /api/v1/sku-planning/process-types    active process types (manual-step picker)
 * GET    /api/v1/sku-planning/machines         active machines (preferred-machine picker)
 * GET    /api/v1/sku-planning/dies             active dies (preferred-die picker)
 * GET    /api/v1/sku-planning/master           list (filters: item_id, status)
 * GET    /api/v1/sku-planning/master/:id       header + steps (+ derived bp_weight_g)
 * POST   /api/v1/sku-planning/master           create (header + steps) -> 201, status draft
 * PATCH  /api/v1/sku-planning/master/:id       update header + steps ({add,update,remove}), draft-only
 *
 * Route order: literal routes before /master/:id. Auth: authenticate + roleGuard on every route.
 * WRITE limited to existing WRITE_ROLES. Scope (S1): CRUD only — no lifecycle, no Work Orders, no scheduler.
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as skuPlanningService from '../services/skuPlanningService.js';

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

// ─── Lookups ──────────────────────────────────────────────────────────────────

router.get('/items', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await skuPlanningService.searchPlanItems({ search: req.query.search, limit: req.query.limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve items.', 500);
  return sendSuccess(res, data);
});

router.get('/routings', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await skuPlanningService.listPlanRoutings({ item_id: req.query.item_id });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve routings.', 500);
  return sendSuccess(res, data);
});

router.get('/process-types', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await skuPlanningService.listPlanProcessTypes();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve process types.', 500);
  return sendSuccess(res, data);
});

router.get('/machines', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await skuPlanningService.listPlanMachines();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve machines.', 500);
  return sendSuccess(res, data);
});

router.get('/dies', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await skuPlanningService.listPlanDies();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve dies.', 500);
  return sendSuccess(res, data);
});

// ─── GET /master — list (before /:id) ─────────────────────────────────────────

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { item_id, status, page, limit } = req.query;
  const { data, count, error } = await skuPlanningService.listPlans({
    item_id, status, page: Number(page) || 1, limit: Number(limit) || 50,
  });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve SKU plans.', 500);
  return sendSuccess(res, data, 200, { page: Number(page) || 1, limit: Math.min(Number(limit) || 50, 200), total: count ?? 0 });
});

// ─── GET /master/:id — single ─────────────────────────────────────────────────

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await skuPlanningService.getPlanById(req.params.id);
  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'SKU plan not found.', 404);
  return sendSuccess(res, data);
});

// ─── POST /master — create ────────────────────────────────────────────────────

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await skuPlanningService.createPlan(req.body, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data, 201);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

// ─── PATCH /master/:id — update (draft-only) ──────────────────────────────────

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await skuPlanningService.updateDraftPlan(req.params.id, req.body, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

// ─── Lifecycle (S2b) ──────────────────────────────────────────────────────────
// Header owns lifecycle. WRITE_ROLES only. Mirrors routing lifecycle routes.

// POST /master/:id/activate — draft -> active (auto-supersedes prior active for item+routing)
router.post('/master/:id/activate', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await skuPlanningService.activatePlan(req.params.id, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

// POST /master/:id/supersede — active -> superseded (explicit retire)
router.post('/master/:id/supersede', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await skuPlanningService.supersedePlan(req.params.id, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

// POST /master/:id/new-version — clone header + steps into a new draft (version max+1)
router.post('/master/:id/new-version', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await skuPlanningService.createNewVersionPlan(req.params.id, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data, 201);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

export default router;
