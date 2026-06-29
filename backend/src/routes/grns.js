/**
 * CERADRIVE ERP — GRN Routes
 *
 * Phase 9A: Read-only endpoints only.
 * Write endpoints (create draft, post, cancel) added in Phase 9D/9E.
 *
 * All routes require authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard }    from '../middleware/roleGuard.js';
import { ROLES }        from '../constants/roles.js';
import * as controller  from '../controllers/grnController.js';
import { grnStatusGuard } from '../middleware/grnStatusGuard.js';
import { GRN_STATUS }     from '../constants/statuses.js';

const router = Router();

// All roles that may read GRN data
const GRN_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.PURCHASE_OFFICER,
  ROLES.WAREHOUSE_OPERATOR,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
];

// Roles that may POST/CANCEL a GRN (inventory-affecting writes).
// NOTE: role set pending PM confirmation — defaulted to ADMIN + STORE_MANAGER.
const GRN_WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
];

// ─── Phase 9A — Read Endpoints ────────────────────────────────────────────────

/**
 * GET /api/v1/grns
 * List GRNs with supplier name, warehouse name, linked PO number.
 * Filters: status, is_direct_grn, supplier_id, warehouse_id, po_id, date range, pagination.
 */
router.get('/',
  authenticate,
  roleGuard(GRN_READ_ROLES),
  controller.listGRNs
);

/**
 * GET /api/v1/grns/:id
 * Get full GRN detail: header + lines + linked PO summary.
 */
router.get('/:id',
  authenticate,
  roleGuard(GRN_READ_ROLES),
  controller.getGRN
);

/**
 * GET /api/v1/grns/:id/lines
 * Get GRN line detail from v_grn_line_detail view.
 */
router.get('/:id/lines',
  authenticate,
  roleGuard(GRN_READ_ROLES),
  controller.getGRNLines
);

// ─── Phase 9E — Inventory Posting Endpoints ──────────────────────────────────

/**
 * POST /api/v1/grns/:id/post
 * Post a draft GRN to inventory (per-item GRN receipts). Atomic, idempotent.
 */
router.post('/:id/post',
  authenticate,
  roleGuard(GRN_WRITE_ROLES),
  controller.postGRN
);

/**
 * POST /api/v1/grns/:id/cancel
 * Cancel a posted GRN (reversal). Negative stock is hard-blocked.
 */
router.post('/:id/cancel',
  authenticate,
  roleGuard(GRN_WRITE_ROLES),
  controller.cancelGRN
);

// ─── Phase 9D — Draft create/update (placeholders — out of this phase) ───────
// ─── Phase 9G — Draft Create ─────────────────────────────────────────────────
router.post('/',
  authenticate,
  roleGuard(GRN_WRITE_ROLES),
  controller.createGRN
);

// ─── GRN1-DRAFT-EDIT — Draft update (received_qty + unit_rate; draft-only) ────
/**
 * PATCH /api/v1/grns/:id
 * Edit a DRAFT GRN's line received_qty + unit_rate. Blocked once posted/cancelled
 * by grnStatusGuard(GRN_STATUS.DRAFT). No inventory posting.
 */
router.patch('/:id',
  authenticate,
  roleGuard(GRN_WRITE_ROLES),
  grnStatusGuard(GRN_STATUS.DRAFT),
  controller.updateGRN
);

export default router;
