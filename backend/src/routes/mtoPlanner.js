import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ALL_ROLES, ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as svc from '../services/mtoPlannerService.js';

const router = Router();


const WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
];


// Phase 1 read-only: MTO order-fulfilment worklist (order cards + line readiness).
router.get('/worklist', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const { data, error } = await svc.getMtoWorklist();
  if (error) {
    return sendError(
      res,
      error.code ?? ERROR_CODES.INTERNAL_ERROR,
      error.message ?? 'Failed to load MTO worklist.',
      500,
    );
  }
  return sendSuccess(res, data);
});

router.post('/plan-now', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await svc.planMtoLineNow(req.body, req.user.id);
  if (error) {
    return sendError(
      res,
      error.code ?? ERROR_CODES.INTERNAL_ERROR,
      error.message ?? 'Failed to create MTO plan.',
      error.status ?? 500,
    );
  }
  return sendSuccess(res, data, 201);
});

export default router;
