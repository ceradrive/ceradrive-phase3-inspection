/**
 * CERADRIVE ERP — GRN Status Guard
 *
 * Same pattern as purchaseStatusGuard — validates GRN current status
 * before allowing state transitions (post, cancel, edit).
 *
 * Usage:
 *   router.post('/:id/post',
 *     authenticate,
 *     roleGuard([ROLES.ADMIN, ROLES.STORE_MANAGER, ROLES.WAREHOUSE_OPERATOR]),
 *     grnStatusGuard(GRN_STATUS.DRAFT),
 *     controller.post
 *   );
 */

import { supabase } from '../config/supabase.js';
import { sendError, ERROR_CODES } from '../utils/response.js';

/**
 * @param {string|string[]} requiredStatus - GRN status value(s) required.
 * @returns {import('express').RequestHandler}
 */
export function grnStatusGuard(requiredStatus) {
  const required = Array.isArray(requiredStatus) ? requiredStatus : [requiredStatus];

  return async function (req, res, next) {
    const { id } = req.params;

    if (!id) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'GRN ID is required.', 400);
    }

    const { data, error } = await supabase
      .from('grn_headers')
      .select('id, status, grn_number, is_direct_grn, po_id')
      .eq('id', id)
      .single();

    if (error || !data) {
      return sendError(res, ERROR_CODES.NOT_FOUND, `GRN not found: ${id}`, 404);
    }

    if (!required.includes(data.status)) {
      return sendError(
        res,
        ERROR_CODES.CONFLICT,
        `This action requires the GRN to be in status: ${required.join(' or ')}. ` +
        `Current status: ${data.status}.`,
        409
      );
    }

    // Attach GRN context for downstream controller use
    req.grn = data;
    next();
  };
}
