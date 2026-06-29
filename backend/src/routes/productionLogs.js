/**
 * CERADRIVE ERP — Production Log Routes (Phase 1: foundation)
 *
 * GET  /api/v1/production-logs/work-orders   released WO search (picker)
 * GET  /api/v1/production-logs/steps?wo_id=  steps for a WO (picker)
 * GET  /api/v1/production-logs/shifts        shift_master (picker; shift required)
 * GET  /api/v1/production-logs/workers       active workers (picker; optional)
 * GET  /api/v1/production-logs/machines      machines (picker; optional)
 * GET  /api/v1/production-logs/master        list (filters: wo_id, entry_date, worker_id, machine_id)
 * GET  /api/v1/production-logs/master/:id    single log
 * POST /api/v1/production-logs/master        create (immutable ENTRY)
 *
 * Route order: literal routes before /master/:id. Auth: authenticate + requirePermission.
 * Permissions reuse MODULES.WORK_ORDER (VIEW/ADD) — no PRODUCTION_LOG constant exists yet.
 * Scope: execution recording only — no inventory/WIP/QC/scheduler/MRP, no wo_headers writes.
 */

import { Router }               from 'express';
import { authenticate }         from '../middleware/authenticate.js';
import { requirePermission }    from '../middleware/requirePermission.js';
import { MODULES, WORK_ORDER_ACTIONS } from '../constants/permissions.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as productionLogService from '../services/productionLogService.js';
import * as inventoryPostingService from '../services/inventoryPostingService.js';
import * as productionPlanOrderService from '../services/productionPlanOrderService.js';
import * as internalProductionPlanService from '../services/internalProductionPlanService.js';

const router = Router();

const VIEW = requirePermission(MODULES.WORK_ORDER, WORK_ORDER_ACTIONS.VIEW);
const ADD  = requirePermission(MODULES.WORK_ORDER, WORK_ORDER_ACTIONS.ADD);

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

router.get('/work-orders', authenticate, VIEW, async (req, res) => {
  const { data, error } = await productionLogService.searchReleasedWorkOrders({ search: req.query.search, limit: req.query.limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve work orders.', 500);
  return sendSuccess(res, data);
});

router.get('/steps', authenticate, VIEW, async (req, res) => {
  const { data, error } = await productionLogService.listStepsForWorkOrder(req.query.wo_id);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve steps.', 500);
  return sendSuccess(res, data);
});

router.get('/shifts', authenticate, VIEW, async (req, res) => {
  const { data, error } = await productionLogService.listShifts();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve shifts.', 500);
  return sendSuccess(res, data);
});

router.get('/workers', authenticate, VIEW, async (req, res) => {
  const { data, error } = await productionLogService.listWorkers();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve workers.', 500);
  return sendSuccess(res, data);
});

router.get('/machines', authenticate, VIEW, async (req, res) => {
  const { data, error } = await productionLogService.listMachines();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve machines.', 500);
  return sendSuccess(res, data);
});

// ─── GET /master — list (MUST be before /:id) ─────────────────────────────────

router.get('/master', authenticate, VIEW, async (req, res) => {
  const { wo_id, entry_date, worker_id, machine_id, page, limit } = req.query;
  const { data, count, error } = await productionLogService.listLogs({
    wo_id, entry_date, worker_id, machine_id,
    page:  Number(page)  || 1,
    limit: Number(limit) || 50,
  });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve production logs.', 500);
  return sendSuccess(res, data, 200, {
    page:  Number(page) || 1,
    limit: Math.min(Number(limit) || 50, 500),
    total: count ?? 0,
  });
});


// ─── POST /master/:id/correct — supervisor correction ─────────────────────────

router.post('/master/:id/correct', authenticate, ADD, async (req, res) => {
  try {
    const { data, error } = await productionLogService.correctLog(req.params.id, req.body || {}, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data, 201);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

// ─── GET /master/:id — single ─────────────────────────────────────────────────

router.get('/master/:id', authenticate, VIEW, async (req, res) => {
  const { data, error } = await productionLogService.getLogById(req.params.id);
  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Production log not found.', 404);
  return sendSuccess(res, data);
});

// ─── POST /master — create (immutable ENTRY) ──────────────────────────────────

router.post('/master', authenticate, ADD, async (req, res) => {
  try {
    const { data, error } = await productionLogService.createLog(req.body, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));

    // Inventory posting is mandatory for production logs.
    // If posting fails, delete the just-created log so worker progress cannot drift from inventory.
    let posting = null;
    if (data?.id) {
      posting = await inventoryPostingService.postProductionLog(data.id, req.user.id);

      if (!posting || posting.status !== 'posted') {
        await productionLogService.deleteUnpostedLog(data.id);

        return sendError(
          res,
          ERROR_CODES.CONFLICT,
          posting?.message || `Inventory posting failed. Status: ${posting?.status || 'unknown'}`,
          409
        );
      }
    }

    let autoComplete = null;
    if (data?.id) {
      try {
        autoComplete = await productionPlanOrderService.autoCompleteWorkOrderForLog(data.id, req.user.id);
      } catch (completeErr) {
        autoComplete = { error: { message: completeErr?.message || 'Auto-complete check failed after production log.' } };
      }
    }

    let autoReleaseInternalPlan = null;
    if (data?.id) {
      try {
        // P3K-COMPLETION-CASCADE: recompute readiness + release now-ready downstream INTERNAL_PLAN WOs.
        autoReleaseInternalPlan = await internalProductionPlanService.recomputeAndReleaseAfterWoCompletion(data.id, req.user.id);
      } catch (cascadeErr) {
        autoReleaseInternalPlan = { error: { message: cascadeErr?.message || 'Internal-plan readiness cascade failed after production log.' } };
      }
    }

    let autoAdvance = null;
    if (data?.id) {
      try {
        autoAdvance = await productionPlanOrderService.autoAdvancePPOAfterProductionLog(data.id, req.user.id);
      } catch (advanceErr) {
        autoAdvance = {
          error: {
            message: advanceErr?.message || 'Auto readiness/release failed after production log.',
          },
        };
      }
    }

    return sendSuccess(res, data, 201, { posting, autoAdvance, autoComplete, autoReleaseInternalPlan });
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message, httpStatusForCode(err.code));
  }
});

export default router;
