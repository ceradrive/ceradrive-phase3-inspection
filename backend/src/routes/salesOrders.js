/**
 * CERADRIVE ERP — Sales Order Routes (10B). Draft CRUD only. No approve/cancel/pricing.
 * REGISTER: import salesOrderRoutes from './salesOrders.js'; router.use('/sales-orders', salesOrderRoutes);
 * WRITE_ROLES pending PM confirmation — defaulted to ADMIN + STORE_MANAGER.
 */
import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as salesOrderService from '../services/salesOrderService.js';
import { createSalesOrderSchema, updateSalesOrderSchema } from '../validators/salesOrderValidator.js';

const router = Router();
const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpForCode(code) {
  switch (code) { case 'NOT_FOUND': return 404; case 'VALIDATION_ERROR': return 400; case 'CONFLICT': return 409; default: return 500; }
}
function vErr(res, parsed) {
  return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400,
    parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
}

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { status, customer_id, date_from, date_to, search, page, limit } = req.query;
  const { data, count, error } = await salesOrderService.listSalesOrders({ status, customer_id, date_from, date_to, search, page, limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load sales orders.', 500);
  return sendSuccess(res, data, 200, { page: Number(page) || 1, limit: Math.min(Number(limit) || 20, 100), total: count ?? 0 });
});

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await salesOrderService.getSalesOrderById(req.params.id);
  if (error) return sendError(res, ERROR_CODES.NOT_FOUND, 'Sales order not found.', 404);
  return sendSuccess(res, data);
});

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createSalesOrderSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  const { data, error } = await salesOrderService.createSalesOrder(parsed.data, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = updateSalesOrderSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  const { data, error } = await salesOrderService.updateSalesOrder(req.params.id, parsed.data, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
});

router.put('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = updateSalesOrderSchema.safeParse(req.body);
  if (!parsed.success) return vErr(res, parsed);
  const { data, error } = await salesOrderService.updateSalesOrder(req.params.id, parsed.data, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
});

router.post('/master/:id/approve', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await salesOrderService.approveSalesOrder(req.params.id, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
});

router.post('/master/:id/cancel', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await salesOrderService.cancelSalesOrder(req.params.id, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
});

export default router;
