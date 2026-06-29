/**
 * CERADRIVE ERP — Permission Guard Middleware Factory (module/action, DB-driven)
 *
 * Returns an Express middleware that allows access only when the authenticated user's
 * role holds an is_permitted = true grant for (moduleCode, actionCode) in role_permissions.
 *
 * Path A: role identity is req.user.role (app_metadata.role, set by authenticate);
 * permissions resolve from the DB (roles.role_code -> role_permissions). Routes declare
 * requirePermission('WORK_ORDER','ADD') — no role-name literals in route code.
 *
 * Must run AFTER authenticate (depends on req.user). For NEW modules only; existing
 * modules keep roleGuard until a later migration. authenticate.js / roleGuard.js unchanged.
 */

import { sendError, ERROR_CODES } from '../utils/response.js';
import * as permissionService from '../services/permissionService.js';

export function requirePermission(moduleCode, actionCode) {
  if (!moduleCode || !actionCode) {
    throw new Error('requirePermission requires both a module code and an action code.');
  }

  return async function (req, res, next) {
    if (!req.user) {
      return sendError(res, ERROR_CODES.UNAUTHORIZED, 'Authentication required.', 401);
    }

    const { allowed, error } = await permissionService.hasPermission(
      req.user.role, moduleCode, actionCode,
    );

    if (error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Permission check failed.', 500);
    }

    if (!allowed) {
      return sendError(
        res,
        ERROR_CODES.FORBIDDEN,
        `Access denied. Required permission: ${moduleCode}:${actionCode}.`,
        403,
      );
    }

    next();
  };
}
