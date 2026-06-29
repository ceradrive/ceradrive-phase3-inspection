import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as svc from '../services/materialAvailabilityService.js';

const router = Router();

const WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
];


router.post('/purchase-requirement', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await svc.createPurchaseRequirementFromShortage(req.body || {}, req.user?.id);
  if (error) {
    return sendError(
      res,
      error.code ?? ERROR_CODES.INTERNAL_ERROR,
      error.message ?? 'Failed to create purchase requirement.',
      error.code === 'VALIDATION_ERROR' ? 400 : 500
    );
  }
  return sendSuccess(res, data, 201);
});

router.post('/tentative-plan-check', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const { data, error } = await svc.checkTentativePlan(req.body?.items || []);
  if (error) {
    return sendError(
      res,
      error.code ?? ERROR_CODES.INTERNAL_ERROR,
      error.message ?? 'Failed to check tentative plan material.',
      error.code === 'VALIDATION_ERROR' ? 400 : 500
    );
  }
  return sendSuccess(res, data);
});

router.get('/requirement/:id', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const { data, error } = await svc.checkRequirement(req.params.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to check material availability.', error.code === 'NOT_FOUND' ? 404 : 500);
  return sendSuccess(res, data);
});

export default router;
