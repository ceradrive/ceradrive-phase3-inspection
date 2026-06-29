/**
 * CERADRIVE ERP — Readiness Engine routes (READ-ONLY)
 *   GET /api/v1/readiness/:scope/:id   scope = item | recipe | ppo | wo
 * Read-only: any authenticated role. No writes.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import { getReadiness, getInbox } from '../services/readinessService.js';

const router = Router();

router.get('/inbox', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const status = String(req.query.status || 'blocker').toLowerCase();
  const scopes = req.query.scopes
    ? String(req.query.scopes).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const { data, error } = await getInbox({ status, scopes, limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to compute inbox.', 500);
  return sendSuccess(res, data);
});

router.get('/:scope/:id', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const { scope, id } = req.params;
  const { data, error } = await getReadiness(String(scope || '').toLowerCase(), id);
  if (error) {
    const code = error.code === 'NOT_FOUND' ? ERROR_CODES.NOT_FOUND
      : error.code === 'VALIDATION_ERROR' ? ERROR_CODES.VALIDATION_ERROR
      : ERROR_CODES.INTERNAL_ERROR;
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'VALIDATION_ERROR' ? 400 : 500;
    return sendError(res, code, error.message || 'Failed to compute readiness.', status);
  }
  return sendSuccess(res, data);
});

export default router;
