/**
 * CERADRIVE ERP — PO Line Validator
 * Phase 9B: Zod schemas for PO line validation.
 *
 * Rules enforced:
 *   ALR-01: line_amount = ROUND(ordered_qty × unit_rate, 4)
 *   ALR-02: tax_amount  = tax_percent ? ROUND(line_amount × tax_percent / 100, 4) : 0
 *   ALR-03: line_total  = line_amount + tax_amount
 *   ALR-11: ordered_qty > 0
 *   ALR-13: unit_rate >= 0
 *   ALR-14: tax_percent >= 0 if provided
 */

import { z } from 'zod';
import {
  calculateLineAmount,
  calculateTaxAmount,
  calculateLineTotal,
  round4,
} from '../utils/amountCalculator.js';

// ─── Base line schema (field shapes) ─────────────────────────────────────────

export const poLineBaseSchema = z.object({
  item_id:     z.string().uuid({ message: 'item_id must be a valid UUID.' }),
  uom_id:      z.string().uuid({ message: 'uom_id must be a valid UUID.' }),
  ordered_qty: z.number({ invalid_type_error: 'ordered_qty must be a number.' })
                .positive({ message: 'Ordered quantity must be greater than zero.' }),  // ALR-11
  unit_rate:   z.number({ invalid_type_error: 'unit_rate must be a number.' })
                .min(0, { message: 'Unit rate cannot be negative.' }),                   // ALR-13

  // C6: computed amounts — required in request body (application calculates before send)
  line_amount: z.number({ invalid_type_error: 'line_amount must be a number.' }),
  tax_amount:  z.number({ invalid_type_error: 'tax_amount must be a number.' }),
  line_total:  z.number({ invalid_type_error: 'line_total must be a number.' }),

  // Tax snapshot (C6) — tax_id is traceability only, nullable
  tax_id:      z.string().uuid().nullable().optional(),
  tax_name:    z.string().max(100).nullable().optional(),
  tax_percent: z.number().min(0, { message: 'tax_percent cannot be negative.' })        // ALR-14
                .nullable().optional(),

  notes:       z.string().max(500).nullable().optional(),
});

// ─── Amount consistency refinement (ALR-01, 02, 03) ─────────────────────────

/**
 * Validates that submitted line_amount, tax_amount, line_total
 * match server-calculated values within floating point tolerance.
 * Tolerance: 0.0001 (one unit at 4dp) to allow for frontend rounding differences.
 */
export const poLineSchema = poLineBaseSchema.superRefine((line, ctx) => {
  const expectedLineAmount = calculateLineAmount(line.ordered_qty, line.unit_rate);
  const expectedTaxAmount  = calculateTaxAmount(expectedLineAmount, line.tax_percent ?? null);
  const expectedLineTotal  = calculateLineTotal(expectedLineAmount, expectedTaxAmount);
  const tolerance          = 0.0001;

  if (Math.abs(line.line_amount - expectedLineAmount) > tolerance) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      path:    ['line_amount'],
      message: `line_amount ${line.line_amount} does not match calculated value ${expectedLineAmount}. ` +
               `Expected: ordered_qty (${line.ordered_qty}) × unit_rate (${line.unit_rate}).`,
    });
  }

  if (Math.abs(line.tax_amount - expectedTaxAmount) > tolerance) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      path:    ['tax_amount'],
      message: `tax_amount ${line.tax_amount} does not match calculated value ${expectedTaxAmount}.`,
    });
  }

  if (Math.abs(line.line_total - expectedLineTotal) > tolerance) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      path:    ['line_total'],
      message: `line_total ${line.line_total} does not match calculated value ${expectedLineTotal}.`,
    });
  }

  // Tax name/percent consistency: both or neither
  const hasName    = line.tax_name    != null && line.tax_name    !== '';
  const hasPercent = line.tax_percent != null;
  if (hasName && !hasPercent) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      path:    ['tax_percent'],
      message: 'tax_percent is required when tax_name is provided.',
    });
  }
  if (hasPercent && !hasName) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      path:    ['tax_name'],
      message: 'tax_name is required when tax_percent is provided.',
    });
  }
});

/**
 * Normalise a validated line: recalculate amounts server-side before DB write.
 * Ensures stored values match server calculation regardless of submitted values.
 *
 * @param {object} line - validated line object
 * @param {number} lineNumber - 1-based line position
 * @returns {object} - ready for DB INSERT
 */
export function normalisePoLine(line, lineNumber) {
  const line_amount = calculateLineAmount(line.ordered_qty, line.unit_rate);
  const tax_amount  = calculateTaxAmount(line_amount, line.tax_percent ?? null);
  const line_total  = calculateLineTotal(line_amount, tax_amount);

  return {
    line_number:  lineNumber,
    item_id:      line.item_id,
    uom_id:       line.uom_id,
    ordered_qty:  line.ordered_qty,
    unit_rate:    line.unit_rate,
    line_amount:  round4(line_amount),
    tax_amount:   round4(tax_amount),
    line_total:   round4(line_total),
    tax_id:       line.tax_id    ?? null,
    tax_name:     line.tax_name  ?? null,
    tax_percent:  line.tax_percent ?? null,
    notes:        line.notes     ?? null,
  };
}
