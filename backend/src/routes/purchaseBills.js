/**
 * CERADRIVE ERP — Purchase Bill Routes (PB-1)
 *
 * Create draft from posted GRN + read. All routes require authentication.
 *
 * MOUNT (PB-1b, done where other routers are registered, e.g. app.js):
 *   import purchaseBillsRouter from './routes/purchaseBills.js';
 *   app.use('/api/v1/purchase-bills', purchaseBillsRouter);
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard }    from '../middleware/roleGuard.js';
import { ROLES }        from '../constants/roles.js';
import * as controller  from '../controllers/purchaseBillController.js';

const router = Router();

// Roles that may read Purchase Bills.
// NOTE: role set pending PM confirmation — mirrors GRN/PO read scope.
const PBILL_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.PURCHASE_OFFICER,
  ROLES.STORE_MANAGER,
  ROLES.SUPERVISOR,
];

// Roles that may CREATE a draft Purchase Bill.
// NOTE: role set pending PM confirmation — defaulted to ADMIN + PURCHASE_OFFICER.
const PBILL_WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.PURCHASE_OFFICER,
];

/**
 * GET /api/v1/purchase-bills
 * List Purchase Bills (filters: supplier_id, grn_id, status, pagination).
 */
router.get('/',
  authenticate,
  roleGuard(PBILL_READ_ROLES),
  controller.listBills
);

/**
 * GET /api/v1/purchase-bills/:id
 * Get full Purchase Bill detail (header + lines).
 */
router.get('/:id',
  authenticate,
  roleGuard(PBILL_READ_ROLES),
  controller.getBill
);

/**
 * POST /api/v1/purchase-bills/:id/approve
 * PB-3 status-only approval: draft -> approved. No AP/payable ledger.
 */
router.post('/:id/approve',
  authenticate,
  roleGuard(PBILL_WRITE_ROLES),
  controller.approveBill
);

/**
 * POST /api/v1/purchase-bills
 * Create a DRAFT Purchase Bill from a posted GRN. Body: { grn_id }.
 */
router.post('/',
  authenticate,
  roleGuard(PBILL_WRITE_ROLES),
  controller.createBill
);

export default router;
