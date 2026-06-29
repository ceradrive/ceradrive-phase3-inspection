/**
 * CERADRIVE ERP — API Response Helpers
 *
 * All controllers use these helpers exclusively.
 * No controller calls res.json() directly.
 *
 * Success envelope:  { success: true, data, meta? }
 * Error envelope:    { success: false, error: { code, message, details? } }
 */

/**
 * Send a successful response.
 *
 * @param {import('express').Response} res
 * @param {*}      data        - Response payload (object or array)
 * @param {number} statusCode  - HTTP status code (default 200)
 * @param {object} [meta]      - Optional pagination meta { page, limit, total }
 */
export function sendSuccess(res, data, statusCode = 200, meta = null) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

/**
 * Send an error response.
 *
 * @param {import('express').Response} res
 * @param {string} code        - Machine-readable error code (e.g. 'NOT_FOUND')
 * @param {string} message     - Human-readable message for the user
 * @param {number} statusCode  - HTTP status code
 * @param {Array}  [details]   - Optional array of field-level error details (Zod)
 */
export function sendError(res, code, message, statusCode, details = null) {
  const body = {
    success: false,
    error: { code, message },
  };
  if (details) body.error.details = details;
  return res.status(statusCode).json(body);
}

export function httpForCode(code) {
  switch (code) {
    case ERROR_CODES.VALIDATION_ERROR: return 400;
    case ERROR_CODES.UNAUTHORIZED:     return 401;
    case ERROR_CODES.FORBIDDEN:        return 403;
    case ERROR_CODES.NOT_FOUND:        return 404;
    case ERROR_CODES.CONFLICT:         return 409;
    default:                           return 500;
  }
}

export function normalizePagination({ page, limit } = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawPage = Number(page);
  const rawLimit = Number(limit);

  const safePage = Number.isFinite(rawPage) && rawPage > 0
    ? Math.floor(rawPage)
    : 1;

  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), maxLimit)
    : Math.min(defaultLimit, maxLimit);

  return { page: safePage, limit: safeLimit };
}

/**
 * Standard error codes — used consistently across all modules.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND:        'NOT_FOUND',
  FORBIDDEN:        'FORBIDDEN',
  UNAUTHORIZED:     'UNAUTHORIZED',
  CONFLICT:         'CONFLICT',
  INTERNAL_ERROR:   'INTERNAL_ERROR',
};
