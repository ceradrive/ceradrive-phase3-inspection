import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as dieService from '../services/dieService.js';

const router = Router();
const READ_ROLES = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function status(code) {
  if (code === 'VALIDATION_ERROR') return 400;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'CONFLICT') return 409;
  return 500;
}

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, count, error } = await dieService.listDies(req.query);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to retrieve dies.', 500);
  return sendSuccess(res, data, 200, { total: count ?? 0 });
});

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await dieService.getDieById(req.params.id);
  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Die not found.', 404);
  return sendSuccess(res, data);
});

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await dieService.createDie(req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, status(error.code));
  return sendSuccess(res, data, 201);
});

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await dieService.updateDie(req.params.id, req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, status(error.code));
  return sendSuccess(res, data);
});

// ── Die ↔ compatible output items (Press Planner cavity source) ──────────────
// Hermetic aliased imports so this block cannot collide with existing bindings.
import { authenticate as _dcAuth } from '../middleware/authenticate.js';
import { roleGuard as _dcGuard } from '../middleware/roleGuard.js';
import { ROLES as _dcROLES, ALL_ROLES as _dcALL } from '../constants/roles.js';
import { sendSuccess as _dcOk, sendError as _dcErr, ERROR_CODES as _dcCodes } from '../utils/response.js';
import * as _dcSvc from '../services/dieService.js';

const _DC_WRITE = [_dcROLES.ADMIN, _dcROLES.STORE_MANAGER];

router.get('/master/:id/items', _dcAuth, _dcGuard(_dcALL), async (req, res) => {
  const { data, error } = await _dcSvc.getDieItems(req.params.id);
  if (error) return _dcErr(res, _dcCodes.INTERNAL_ERROR, 'Failed to load die items.', 500);
  return _dcOk(res, data);
});

router.patch('/master/:id/items', _dcAuth, _dcGuard(_DC_WRITE), async (req, res) => {
  const items = (req.body && req.body.items) || [];
  const { data, error } = await _dcSvc.syncDieItems(req.params.id, items);
  if (error) {
    return _dcErr(
      res,
      error.code || _dcCodes.INTERNAL_ERROR,
      error.message || 'Failed to save die items.',
      error.code === 'VALIDATION_ERROR' ? 400 : 500,
    );
  }
  return _dcOk(res, data);
});

export default router;
