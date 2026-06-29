import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as dataImportService from '../services/dataImportService.js';

const router = Router();
const IMPORT_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

function httpForCode(code) {
  switch (code) {
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT': return 409;
    default: return 500;
  }
}

router.get('/template/:docType', authenticate, roleGuard(IMPORT_ROLES), async (req, res) => {
  try {
    return sendSuccess(res, dataImportService.getTemplate(req.params.docType));
  } catch (err) {
    return sendError(res, err.code || ERROR_CODES.INTERNAL_ERROR, err.message || 'Template failed.', httpForCode(err.code));
  }
});

router.post('/preview', authenticate, roleGuard(IMPORT_ROLES), async (req, res) => {
  const { data, error } = await dataImportService.previewImport(req.body);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Preview failed.', httpForCode(error.code));
  return sendSuccess(res, data || []);
});

router.post('/run', authenticate, roleGuard(IMPORT_ROLES), async (req, res) => {
  const { data, error } = await dataImportService.runImport(req.body, req.user.id);
  if (error) return sendError(res, error.code || ERROR_CODES.INTERNAL_ERROR, error.message || 'Import failed.', httpForCode(error.code));
  return sendSuccess(res, data || []);
});

export default router;
