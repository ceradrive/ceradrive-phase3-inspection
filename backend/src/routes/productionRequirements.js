import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as svc from '../services/productionRequirementService.js';

const router = Router();
const READ_ROLES = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

router.get('/queue', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await svc.listRequirements();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load requirements.', 500);
  return sendSuccess(res, data);
});

router.post('/queue', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await svc.createRequirement(req.body);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, error.code === 'VALIDATION_ERROR' ? 400 : 500);
  return sendSuccess(res, data, 201);
});

export default router;
