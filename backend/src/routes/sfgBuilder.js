import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as sfgBuilderService from '../services/sfgBuilderService.js';
import * as sfgBuildOrchestratorService from '../services/sfgBuildOrchestratorService.js';
const router = Router();

const READ_ROLES = ALL_ROLES;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpForCode(code) {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT': return 409;
    default: return 500;
  }
}

router.get('/fg-items', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await sfgBuilderService.searchFgItems(req.query);
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to search FG items.', 500);
  return sendSuccess(res, data || []);
});

router.get('/templates', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await sfgBuilderService.listTemplates();
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load SFG templates.', 500);
  return sendSuccess(res, data || []);
});

router.post('/preview', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await sfgBuilderService.previewSfgItems(req.body);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to preview SFG items.', httpForCode(error.code));
  return sendSuccess(res, data);
});

router.post('/create', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await sfgBuilderService.createSfgItems(req.body, req.user.id);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to create SFG items.', httpForCode(error.code));
  return sendSuccess(res, data, 201);
});

// ── P-SFG-2A-1: read-only build preview (Path B abstract assembly) ──
// READ_ROLES because this endpoint performs SELECT-only resolution and never writes.
// Commit is not exposed in this phase.
router.post('/build-preview', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await sfgBuildOrchestratorService.previewBuild(req.body);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to build preview.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-alpha: ITEMS-only commit (Generate). Flag-gated. ──
// While sfg_commit_enabled is false (and SFG_COMMIT_ENABLED env not 'true'),
// this returns 503 and writes nothing. Server re-runs preview + block-gates inside commitBuild.
router.post('/build', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.commitEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder Generate is disabled (sfg_commit_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitBuild(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Commit failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-gamma: DRAFT RECIPE-only commit. Flag-gated. ──
// 503 while sfg_recipe_commit_enabled false. Creates draft recipe only (no activate/BOM/routing/links).
router.post('/build-recipe', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.recipeCommitEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder recipe draft is disabled (sfg_recipe_commit_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitRecipeDraft(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Recipe draft commit failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-delta: ACTIVATE draft recipe only (NO BOM). Flag-gated. ──
router.post('/build-recipe-activate', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.recipeActivateEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder recipe activation is disabled (sfg_recipe_activate_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitRecipeActivate(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Recipe activation failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-epsilon: BOM-only generation from active recipe. Flag-gated. ──
router.post('/build-bom', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.bomCommitEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder BOM generation is disabled (sfg_bom_commit_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitRecipeBom(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'BOM generation failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-zeta: ROUTING-only creation. Flag-gated. ──
router.post('/build-routing', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.routingCommitEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder routing is disabled (sfg_routing_commit_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitRouting(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Routing creation failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-eta: FG-SFG LINKS-only creation. Flag-gated. ──
router.post('/build-links', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.linksCommitEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder FG-SFG links are disabled (sfg_links_commit_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitFgLinks(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'FG-SFG links creation failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// ── P-SFG-2A-2-theta: FULL GENERATE (orchestrated). Master flag-gated. ──
// While sfg_full_generate_enabled is false, returns 503 and writes nothing.
router.post('/build-generate', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!sfgBuildOrchestratorService.fullGenerateEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'SFG Builder Generate is disabled (sfg_full_generate_enabled=false).', 503);
  }
  const { data, error } = await sfgBuildOrchestratorService.commitFullGenerate(req.body, req.user?.id || null);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Generate failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

export default router;
