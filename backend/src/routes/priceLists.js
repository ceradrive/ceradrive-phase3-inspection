/**
 * CERADRIVE ERP — Price List Routes
 * Thin route layer over priceListService (Item Master pattern; no controller file).
 * Literal routes (/search, /master) before /master/:id. Manual codes, dedupe in service.
 * REGISTER in routes index:  import priceListRoutes from './priceLists.js';
 *                            router.use('/price-lists', priceListRoutes);
 */
import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as priceListService from '../services/priceListService.js';
import { createPriceListSchema, updatePriceListSchema, togglePriceListSchema } from '../validators/priceListValidator.js';

const router = Router();
const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER, ROLES.PURCHASE_OFFICER];

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    default:                 return 500;
  }
}
function validationError(res, parsed) {
  return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Validation failed.', 400,
    parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
}

router.get('/search', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { search, limit } = req.query;
  const { data, error } = await priceListService.searchPriceLists({ search, limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search price lists.', 500);
  return sendSuccess(res, data);
});

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { is_active, search, page, limit } = req.query;
  const { data, count, error } = await priceListService.listPriceListMaster({ is_active, search, page, limit });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load price lists.', 500);
  return sendSuccess(res, data, 200, { page: Number(page) || 1, limit: Math.min(Number(limit) || 20, 100), total: count ?? 0 });
});

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await priceListService.getPriceListById(req.params.id);
  if (error) return sendError(res, ERROR_CODES.NOT_FOUND, 'Price list not found.', 404);
  return sendSuccess(res, data);
});

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = createPriceListSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  try {
    const { data, error } = await priceListService.createPriceList(parsed.data, req.user.id);
    if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
    return sendSuccess(res, data, 201);
  } catch (e) {
    return sendError(res, e.code ?? ERROR_CODES.INTERNAL_ERROR, e.message ?? 'Create failed.', httpStatusForCode(e.code));
  }
});

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = updatePriceListSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const { data, error } = await priceListService.updatePriceList(req.params.id, parsed.data, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
  return sendSuccess(res, data);
});

router.post('/master/:id/toggle-active', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const parsed = togglePriceListSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const { data, error } = await priceListService.togglePriceListActive(req.params.id, parsed.data.is_active, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpStatusForCode(error.code));
  return sendSuccess(res, data);
});

export default router;
