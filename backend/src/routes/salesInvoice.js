/**
 * CERADRIVE ERP — Sales Invoice Routes (SI-1a). READ-ONLY preview only.
 * REGISTER: import salesInvoiceRoutes from './salesInvoice.js'; router.use('/sales-invoices', salesInvoiceRoutes);
 * No write/post/cancel endpoints in this slice.
 */
import { Router }       from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard }    from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import * as salesInvoiceService from '../services/salesInvoiceService.js';

const router = Router();
const READ_ROLES = ALL_ROLES;

function httpForCode(code) {
  switch (code) { case 'NOT_FOUND': return 404; case 'VALIDATION_ERROR': return 400; case 'CONFLICT': return 409; default: return 500; }
}

// GET /api/v1/sales-invoices/preview/:soId
// Read-only. Returns proposed draft invoice (priced header + lines + totals) from an approved SO, or blocks.
router.get('/preview/:soId', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await salesInvoiceService.previewInvoiceFromSO(req.params.soId);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
});

const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE_MANAGER];

// POST /api/v1/sales-invoices/draft/:soId — create draft invoice from approved SO. Flag-gated.
router.post('/draft/:soId', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  if (!salesInvoiceService.invoiceCommitEnabled()) {
    return sendError(res, 'FEATURE_DISABLED', 'Sales invoice draft creation is disabled (sales_invoice_commit_enabled=false).', 503);
  }
  const { data, error } = await salesInvoiceService.createDraftInvoiceFromSO(req.params.soId, req.user?.id || null);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message, httpForCode(error.code));
  return sendSuccess(res, data);
});

// GET /api/v1/sales-invoices — list invoices (read-only)
router.get('/', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { status, search } = req.query;
  const { data, error, count } = await salesInvoiceService.listSalesInvoices({ status, search });
  if (error) return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load sales invoices.', 500);
  return sendSuccess(res, data, 200, { total: count ?? (data ? data.length : 0) });
});

// GET /api/v1/sales-invoices/:id — invoice detail (read-only). Keep AFTER /preview and /draft.
router.get('/:id', authenticate, roleGuard(READ_ROLES), async (req, res) => {
  const { data, error } = await salesInvoiceService.getSalesInvoiceById(req.params.id);
  if (error) return sendError(res, error.code ?? ERROR_CODES.NOT_FOUND, error.message ?? 'Sales invoice not found.', httpForCode(error.code));
  return sendSuccess(res, data);
});

// POST /api/v1/sales-invoices/:id/post — stock check + block (SI-4). READ-ONLY: never deducts.
// Returns INSUFFICIENT_STOCK with item/required/available, or STOCK_OK_DEFERRED. No inventory write.
router.post('/:id/post', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data, error } = await salesInvoiceService.postSalesInvoice(req.params.id, req.user?.id || null);
  if (error) return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message ?? 'Post failed.', httpForCode(error.code));
  return sendSuccess(res, data);
});

export default router;
