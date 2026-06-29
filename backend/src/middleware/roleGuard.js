/**
 * CERADRIVE ERP — Role Guard Middleware Factory
 *
 * Returns an Express middleware that allows access only to requests
 * where req.user.role is in the allowedRoles array.
 *
 * Must be used AFTER authenticate middleware — depends on req.user.
 *
 * Usage in routes:
 *   import { roleGuard } from '../middleware/roleGuard.js';
 *   import { ROLES } from '../constants/roles.js';
 *
 *   router.post('/approve',
 *     authenticate,
 *     roleGuard([ROLES.ADMIN, ROLES.STORE_MANAGER]),
 *     controller.approve
 *   );
 *
 * Role strings are always sourced from ROLES constants — never inline literals.
 */

import { sendError, ERROR_CODES } from '../utils/response.js';

/**
 * @param {string[]} allowedRoles - Array of ROLES constant values
 * @returns {import('express').RequestHandler}
 */
export function roleGuard(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error('roleGuard requires a non-empty array of allowed roles.');
  }

  return function (req, res, next) {
    // authenticate must have run first
    if (!req.user) {
      return sendError(
        res,
        ERROR_CODES.UNAUTHORIZED,
        'Authentication required.',
        401
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
      return sendError(
        res,
        ERROR_CODES.FORBIDDEN,
        `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
        403
      );
    }

    next();
  };
}
