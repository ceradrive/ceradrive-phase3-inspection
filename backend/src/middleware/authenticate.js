/**
 * CERADRIVE ERP — Authentication Middleware
 *
 * Verifies the Supabase JWT on every protected request.
 * Attaches req.user = { id, email, role } for downstream middleware and controllers.
 *
 * Role is read from user.app_metadata.role — set in Supabase Auth dashboard per user.
 * Valid role strings are defined in shared/roles.js.
 *
 * Applied to all routes under /api/v1.
 */

import { supabase } from '../config/supabase.js';
import { ALL_ROLES } from '../constants/roles.js';
import { sendError, ERROR_CODES } from '../utils/response.js';

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(
      res,
      ERROR_CODES.UNAUTHORIZED,
      'Authentication required. Provide a valid Bearer token.',
      401
    );
  }

  const token = authHeader.split(' ')[1];

  // Verify token via Supabase Auth using the service-role client
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return sendError(
      res,
      ERROR_CODES.UNAUTHORIZED,
      'Invalid or expired token. Please log in again.',
      401
    );
  }

  const user = data.user;
  const role = user.app_metadata?.role;

  // Role must be set in app_metadata and be one of the approved role strings
  if (!role || !ALL_ROLES.includes(role)) {
    return sendError(
      res,
      ERROR_CODES.FORBIDDEN,
      'User role is not assigned or is not recognised. Contact your administrator.',
      403
    );
  }

  // Attach user context to request for downstream use
  req.user = {
    id:    user.id,
    email: user.email,
    role,
  };

  next();
}
