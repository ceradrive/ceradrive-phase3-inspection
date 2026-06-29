/**
 * CERADRIVE ERP — Process Type routes
 * READ: all roles. WRITE: ADMIN, STORE_MANAGER.
 * Mirrors itemTypes route pattern. Literal routes before /:id.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as processTypeService from '../services/processTypeService.js';

const router = Router();

const READ_ROLES = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpStatusForCode(code) {
  switch (code) {
    case 'NOT_FOUND':         return 404;
    case 'VALIDATION_ERROR':  return 400;
    case 'CONFLICT':          return 409;
    default:                  return 500;
  }
}

// ─── Search (active only) ───────────────────────────────────────────────────────
router.get('/search', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  try {
    const { q = '', limit } = req.query;
    const { data, error } = await processTypeService.searchProcessTypes(q, limit ? Number(limit) : 20);
    if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to process process type request.', error.status || httpStatusForCode(error.code));
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message || 'Unexpected error.', httpStatusForCode(err.code));
  }
});

// ─── List (paginated) ───────────────────────────────────────────────────────────
router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', is_active } = req.query;
    const isActive = is_active === undefined ? undefined : is_active === 'true';
    const { data, count, error } = await processTypeService.listProcessTypes({
      page: Number(page), limit: Number(limit), search, isActive,
    });
    if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to process process type request.', error.status || httpStatusForCode(error.code));
    return sendSuccess(res, data, 200, { page: Number(page), limit: Number(limit), total: count });
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message || 'Unexpected error.', httpStatusForCode(err.code));
  }
});

// ─── Get by id ──────────────────────────────────────────────────────────────────
router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  try {
    const { data, error } = await processTypeService.getProcessTypeById(req.params.id);
    if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Process type not found.', 404);
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message || 'Unexpected error.', httpStatusForCode(err.code));
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────
router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await processTypeService.createProcessType(req.body, req.user?.id);
    if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to process process type request.', error.status || httpStatusForCode(error.code));
    return sendSuccess(res, data, 201);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message || 'Unexpected error.', httpStatusForCode(err.code));
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────
router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { data, error } = await processTypeService.updateProcessType(req.params.id, req.body, req.user?.id);
    if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to process process type request.', error.status || httpStatusForCode(error.code));
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message || 'Unexpected error.', httpStatusForCode(err.code));
  }
});

// ─── Toggle active ──────────────────────────────────────────────────────────────
router.post('/master/:id/toggle-active', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  try {
    const { is_active } = req.body;
    const { data, error } = await processTypeService.toggleProcessTypeActive(req.params.id, is_active === true, req.user?.id);
    if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to process process type request.', error.status || httpStatusForCode(error.code));
    return sendSuccess(res, data);
  } catch (err) {
    return sendError(res, err.code ?? ERROR_CODES.INTERNAL_ERROR, err.message || 'Unexpected error.', httpStatusForCode(err.code));
  }
});

export default router;
