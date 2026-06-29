/**
 * CERADRIVE ERP — Purchase Order Status Guard
 *
 * Middleware factory that validates a PO's current status before allowing
 * a state transition action (approve, close, cancel, edit).
 *
 * Fetches the current status from purchase_orders by req.params.id.
 * Returns 404 if PO not found, 409 if status does not match requirement.
 *
 * Usage:
 *   router.post('/:id/approve',
 *     authenticate,
 *     roleGuard([ROLES.ADMIN, ROLES.STORE_MANAGER]),
 *     purchaseStatusGuard(PO_STATUS.DRAFT),
 *     controller.approve
 *   );
 */

import { supabase } from '../config/supabase.js';
import { sendError, ERROR_CODES } from '../utils/response.js';

/**
 * @param {string|string[]} requiredStatus - Status value(s) the PO must currently have.
 * @returns {import('express').RequestHandler}
 */
export function purchaseStatusGuard(requiredStatus) {
  const required = Array.isArray(requiredStatus) ? requiredStatus : [requiredStatus];

  return async function (req, res, next) {
    const { id } = req.params;

    if (!id) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'PO ID is required.', 400);
    }

    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, status, po_number')
      .eq('id', id)
      .single();

    if (error || !data) {
      return sendError(res, ERROR_CODES.NOT_FOUND, `Purchase Order not found: ${id}`, 404);
    }

    if (!required.includes(data.status)) {
      return sendError(
        res,
        ERROR_CODES.CONFLICT,
        `This action requires the Purchase Order to be in status: ${required.join(' or ')}. ` +
        `Current status: ${data.status}.`,
        409
      );
    }

    // Attach PO context for downstream controller use
    req.purchaseOrder = data;
    next();
  };
}
