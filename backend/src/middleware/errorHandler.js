/**
 * CERADRIVE ERP — Global Error Handler
 *
 * Must be the LAST middleware registered in app.js.
 * Catches all errors passed via next(error) or thrown in async handlers
 * (express-async-errors forwards thrown errors automatically).
 *
 * Returns consistent error envelope: { success: false, error: { code, message, details? } }
 * Never exposes stack traces in production.
 */

import { ZodError } from 'zod';
import { ERROR_CODES } from '../utils/response.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';

  // ── Zod Validation Error ───────────────────────────────────────────────────
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field:   e.path.join('.'),
      message: e.message,
    }));

    return res.status(400).json({
      success: false,
      error: {
        code:    ERROR_CODES.VALIDATION_ERROR,
        message: 'One or more fields failed validation.',
        details,
      },
    });
  }

  // ── Known Application Errors (thrown as plain objects with .code) ──────────
  if (err && typeof err === 'object' && err.code) {
    const statusMap = {
      [ERROR_CODES.NOT_FOUND]:   404,
      [ERROR_CODES.FORBIDDEN]:   403,
      [ERROR_CODES.UNAUTHORIZED]:401,
      [ERROR_CODES.CONFLICT]:    409,
      [ERROR_CODES.VALIDATION_ERROR]: 400,
    };

    const statusCode = statusMap[err.code] ?? 500;

    return res.status(statusCode).json({
      success: false,
      error: {
        code:    err.code,
        message: err.message ?? 'An error occurred.',
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // ── Unhandled / Unexpected Errors ─────────────────────────────────────────
  // Log full error server-side; return safe message to client
  console.error('[ErrorHandler] Unhandled error:', err);

  return res.status(500).json({
    success: false,
    error: {
      code:    ERROR_CODES.INTERNAL_ERROR,
      message: isDev
        ? (err?.message ?? 'Internal server error.')
        : 'An unexpected error occurred. Please try again.',
      ...(isDev && err?.stack ? { stack: err.stack } : {}),
    },
  });
}
