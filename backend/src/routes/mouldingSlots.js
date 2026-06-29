import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as svc from '../services/mouldingSlotService.js';

const router = Router();
const READ_ROLES = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function status(code) { return code === 'VALIDATION_ERROR' ? 400 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 500; }

router.get('/machines', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await svc.listMachines();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load machines.', 500);
  return sendSuccess(res, data);
});

router.get('/dies', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await svc.listDies();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load dies.', 500);
  return sendSuccess(res, data);
});

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, count, error } = await svc.listSetups(req.query);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load setups.', 500);
  return sendSuccess(res, data, 200, { total: count ?? 0 });
});

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await svc.getSetupById(req.params.id);
  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Setup not found.', 404);
  return sendSuccess(res, data);
});

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await svc.createSetup(req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, status(error.code));
  return sendSuccess(res, data, 201);
});

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await svc.updateSetup(req.params.id, req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, status(error.code));
  return sendSuccess(res, data);
});

export default router;
