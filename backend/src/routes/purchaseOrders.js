/**
 * CERADRIVE ERP — Purchase Order Routes
 * Phase 9A: Read endpoints.
 * Phase 9B: Write endpoints added.
 */

import { Router }                from 'express';
import { authenticate }          from '../middleware/authenticate.js';
import { roleGuard }             from '../middleware/roleGuard.js';
import { purchaseStatusGuard }   from '../middleware/purchaseStatusGuard.js';
import { ROLES }                 from '../constants/roles.js';
import { PO_STATUS }             from '../constants/statuses.js';
import * as controller           from '../controllers/purchaseOrderController.js';

const router = Router();

const PO_READ_ROLES = [
  ROLES.ADMIN, ROLES.STORE_MANAGER, ROLES.PURCHASE_OFFICER,
  ROLES.WAREHOUSE_OPERATOR, ROLES.SUPERVISOR, ROLES.PLANNER,
];

const PO_WRITE_ROLES = [
  ROLES.ADMIN, ROLES.STORE_MANAGER, ROLES.PURCHASE_OFFICER,
];

const PO_APPROVE_ROLES = [
  ROLES.ADMIN, ROLES.STORE_MANAGER,
];

// ─── Read (Phase 9A) ──────────────────────────────────────────────────────────

router.get('/',
  authenticate, roleGuard(PO_READ_ROLES),
  controller.listPurchaseOrders
);

router.get('/:id',
  authenticate, roleGuard(PO_READ_ROLES),
  controller.getPurchaseOrder
);

router.get('/:id/receipt-status',
  authenticate, roleGuard(PO_READ_ROLES),
  controller.getPOReceiptStatus
);

// ─── Write (Phase 9B) ─────────────────────────────────────────────────────────

// Create draft PO
router.post('/',
  authenticate, roleGuard(PO_WRITE_ROLES),
  controller.createPurchaseOrder
);

// Update PO — schema selected by controller based on current status
// purchaseStatusGuard attaches req.purchaseOrder.status for controller use
router.patch('/:id',
  authenticate, roleGuard(PO_WRITE_ROLES),
  purchaseStatusGuard([PO_STATUS.DRAFT, PO_STATUS.APPROVED]),
  controller.updatePurchaseOrder
);

// Approve — draft only
router.post('/:id/approve',
  authenticate, roleGuard(PO_APPROVE_ROLES),
  purchaseStatusGuard(PO_STATUS.DRAFT),
  controller.approvePurchaseOrder
);

// Create Draft GRN from approved PO
router.post('/:id/create-grn',
  authenticate, roleGuard(PO_WRITE_ROLES),
  purchaseStatusGuard(PO_STATUS.APPROVED),
  controller.createGRNFromPurchaseOrder
);

// Post draft GRN for approved PO
router.post('/:id/post-grn',
  authenticate, roleGuard(PO_WRITE_ROLES),
  purchaseStatusGuard(PO_STATUS.APPROVED),
  controller.postDraftGRNForPurchaseOrder
);

// Close — approved only
router.post('/:id/close',
  authenticate, roleGuard(PO_APPROVE_ROLES),
  purchaseStatusGuard(PO_STATUS.APPROVED),
  controller.closePurchaseOrder
);

// Cancel — draft or approved
router.post('/:id/cancel',
  authenticate, roleGuard(PO_APPROVE_ROLES),
  purchaseStatusGuard([PO_STATUS.DRAFT, PO_STATUS.APPROVED]),
  controller.cancelPurchaseOrder
);

export default router;
