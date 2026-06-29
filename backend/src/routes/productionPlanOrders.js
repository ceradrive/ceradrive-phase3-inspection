import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as service from '../services/productionPlanOrderService.js';

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

router.post('/',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.createProductionPlanOrder(req.body, req.user.id);

    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to create Production Plan Order.',
        error.status || 500
      );
    }

    return sendSuccess(res, data, 201);
  }
);

router.get('/',
  authenticate,
  roleGuard(READ_ROLES),
  async (_req, res) => {
    const { data, error } = await service.listProductionPlanOrders();

    if (error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load Production Plan Orders.', 500);
    }

    return sendSuccess(res, data);
  }
);





router.post('/:id/release-ready-work-orders',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.releaseReadyWorkOrdersFromPPO(req.params.id, req.user.id, req.body?.selected_wo_ids);

    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to release READY Work Orders from PPO.',
        error.status || 500
      );
    }

    return sendSuccess(res, data);
  }
);


router.post('/:id/check-wo-readiness',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.checkWOReadinessForPPO(req.params.id);

    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to check WO readiness.',
        error.status || 500
      );
    }

    return sendSuccess(res, data);
  }
);


router.post('/:id/generate-work-orders',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    try {
      const { data, error } = await service.generateWorkOrdersFromPPO(req.params.id, req.user.id, req.body || {});

      if (error) {
        return sendError(
          res,
          error.code || ERROR_CODES.INTERNAL_ERROR,
          error.message || 'Failed to generate Work Orders from PPO.',
          error.status || 500
        );
      }

      return sendSuccess(res, data);
    } catch (err) {
      console.error('generateWorkOrdersFromPPO failed:', err);
      return sendError(
        res,
        err.code || ERROR_CODES.INTERNAL_ERROR,
        err.message || 'Failed to generate Work Orders from PPO.',
        err.status || 500
      );
    }
  }
);


router.post('/:id/sync-routings',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.syncRoutingsFromPPO(req.params.id, req.user.id);

    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to sync routings from PPO.',
        error.status || 500
      );
    }

    return sendSuccess(res, data);
  }
);


router.post('/:id/cancel',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    const { data, error } = await service.cancelProductionPlanOrder(req.params.id, req.user.id);

    if (error) {
      return sendError(
        res,
        error.code || ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to cancel PPO.',
        error.status || 500
      );
    }

    return sendSuccess(res, data);
  }
);


router.get('/:id/timeline-load', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await service.getProductionPlanTimelineLoad(req.params.id);
  if (error) {
    return sendError(
      res,
      error.code === 'NOT_FOUND' ? ERROR_CODES.NOT_FOUND : ERROR_CODES.INTERNAL_ERROR,
      error.message || 'Failed to load PPO timeline.',
      error.status || (error.code === 'NOT_FOUND' ? 404 : 500)
    );
  }
  return sendSuccess(res, data);
});

router.get('/:id',
  authenticate,
  roleGuard(READ_ROLES),
  async (req, res) => {
    const { data, error } = await service.getProductionPlanOrderById(req.params.id);

    if (error) {
      return sendError(res, ERROR_CODES.NOT_FOUND, 'Production Plan Order not found.', 404);
    }

    return sendSuccess(res, data);
  }
);

export default router;
