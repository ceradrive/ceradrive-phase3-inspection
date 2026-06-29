import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as svc from '../services/demandProductionEngineService.js';

const router = Router();

router.get('/suggestions',
  authenticate,
  roleGuard(ALL_ROLES),
  async (req, res) => {
    const { data, error } = await svc.generateSuggestions();
    if (error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to generate suggestions.', 500);
    }
    return sendSuccess(res, data);
  }
);

export default router;
