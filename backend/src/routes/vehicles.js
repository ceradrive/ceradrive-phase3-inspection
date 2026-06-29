/**
 * CERADRIVE ERP — Vehicle Master Routes (10G). Item Master route pattern.
 * REGISTER: import vehicleRoutes from './vehicles.js'; router.use('/vehicles', vehicleRoutes);
 * WRITE_ROLES pending PM confirm — defaulted to ADMIN + STORE_MANAGER.
 */
import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as vehicleService from '../services/vehicleService.js';
import { createVehicleSchema, updateVehicleSchema } from '../validators/vehicleValidator.js';

const router = Router();
const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpForCode(code) { switch (code) { case 'NOT_FOUND': return 404; case 'VALIDATION_ERROR': return 400; case 'CONFLICT': return 409; default: return 500; } }
function vErr(res, parsed) { return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400, parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))); }

router.get('/search', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { search, limit } = req.query;
  const { data, error } = await vehicleService.searchVehicles({ search, limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search vehicles.', 500);
  return sendSuccess(res, data);
});

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { is_active, search, page, limit } = req.query;
  const { data, count, error } = await vehicleService.listVehicles({ is_active, search, page, limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load vehicles.', 500);
  return sendSuccess(res, data, 200, { page: Number(page) || 1, limit: Math.min(Number(limit) || 20, 100), total: count ?? 0 });
});

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await vehicleService.getVehicleById(req.params.id);
  if (error) return sendError(res, ERROR_CODES.NOT_FOUND, 'Vehicle not found.', 404);
  return sendSuccess(res, data);
});

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createVehicleSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  try {
    const { data, error } = await vehicleService.createVehicle(parsed.data, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
    return sendSuccess(res, data, 201);
  } catch (e) { return sendError(res, e.code ?? ERROR_CODES.INTERNAL_ERROR, e.message ?? 'Create failed.', httpForCode(e.code)); }
});

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = updateVehicleSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  try {
    const { data, error } = await vehicleService.updateVehicle(req.params.id, parsed.data, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
    return sendSuccess(res, data);
  } catch (e) { return sendError(res, e.code ?? ERROR_CODES.INTERNAL_ERROR, e.message ?? 'Update failed.', httpForCode(e.code)); }
});

export default router;
