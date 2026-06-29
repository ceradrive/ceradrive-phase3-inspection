/**
 * CERADRIVE ERP — Stage Manufacturing Recipe Routes
 */

import { Router }           from 'express';
import { authenticate }     from '../middleware/authenticate.js';
import { roleGuard }        from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as stageRecipeService from '../services/stageRecipeService.js';

const router = Router();
const READ_ROLES  = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpForCode(code) {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT': return 409;
    default: return 500;
  }
}

router.get('/items', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.searchItems(req.query);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search items.', 500);
  return sendSuccess(res, data ?? []);
});

router.get('/process-types', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.listProcessTypes();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load processes.', 500);
  return sendSuccess(res, data ?? []);
});

router.get('/machines', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.listMachines();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load machines.', 500);
  return sendSuccess(res, data ?? []);
});

router.post('/preview', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  // 8Y-8A: read-only preview. Never saves, posts inventory, or touches BOM.
  const { data, error } = await stageRecipeService.previewStageRecipe(req.body);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to preview recipe.', httpForCode(error.code));
  return sendSuccess(res, data);
});

router.get('/master', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, count, error } = await stageRecipeService.listStageRecipes(req.query);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load stage recipes.', 500);
  return sendSuccess(res, data ?? [], 200, { total: count ?? 0 });
});

router.get('/master/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.getStageRecipeById(req.params.id);
  if (error || !data) return sendError(res, ERROR_CODES.NOT_FOUND, 'Stage recipe not found.', 404);
  return sendSuccess(res, data);
});

router.post('/master', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.createStageRecipe(req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to create stage recipe.', httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

router.patch('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.updateStageRecipe(req.params.id, req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to update stage recipe.', httpForCode(error.code));
  return sendSuccess(res, data);
});

router.post('/master/:id/new-version', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.createNewVersionStageRecipe(req.params.id, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to create new recipe version.', httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

router.post('/master/:id/copy', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.copyStageRecipeToDraft(req.params.id, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to copy stage recipe.', httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

router.post('/master/:id/copy-to-sku', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.copyStageRecipeToSku(req.params.id, req.body, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to copy stage recipe to SKU.', httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

router.post('/master/:id/batch-copy-to-sku', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.copyStageRecipeToManySkus(req.params.id, req.body?.mappings, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to batch copy stage recipe to SKUs.', httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

router.post('/master/:id/activate', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.activateStageRecipe(req.params.id, req.user.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Failed to activate recipe version.', httpForCode(error.code));
  return sendSuccess(res, data);
});

router.delete('/master/:id', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await stageRecipeService.deleteStageRecipe(req.params.id);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete stage recipe.', 500);
  return sendSuccess(res, data);
});

export default router;
