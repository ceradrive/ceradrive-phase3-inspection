/**
 * CERADRIVE ERP — Amount Calculation Utilities
 * Pure functions. No DB access. No side effects. Fully testable.
 *
 * These are the canonical calculation functions for all line-level amounts.
 * Both backend (amountCalculator.js) and frontend (usePOAmounts, useGRNAmounts)
 * source from this shared module to guarantee identical results on both sides.
 *
 * Rounding: 4 decimal places, half-up — matches NUMERIC(18,4) column precision.
 *
 * Approved rules:
 *   ALR-01: line_amount = ROUND(qty × unit_rate, 4)
 *   ALR-02: tax_amount  = tax_percent ? ROUND(line_amount × tax_percent / 100, 4) : 0
 *   ALR-03: line_total  = line_amount + tax_amount
 */

/**
 * Round a number to exactly 4 decimal places using half-up rounding.
 * @param {number} value
 * @returns {number}
 */
export function round4(value) {
  if (typeof value !== 'number' || isNaN(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

/**
 * Calculate line amount (pre-tax).
 * ALR-01: line_amount = ROUND(qty × unit_rate, 4)
 *
 * @param {number} qty        - ordered_qty (PO) or received_qty (GRN). Must be > 0.
 * @param {number} unitRate   - unit_rate. Must be >= 0.
 * @returns {number}          - Rounded to 4dp.
 */
export function calculateLineAmount(qty, unitRate) {
  if (typeof qty !== 'number' || typeof unitRate !== 'number') return 0;
  return round4(qty * unitRate);
}

/**
 * Calculate tax amount.
 * ALR-02: tax_amount = tax_percent ? ROUND(line_amount × tax_percent / 100, 4) : 0
 *
 * @param {number}      lineAmount  - Pre-tax line amount (output of calculateLineAmount).
 * @param {number|null} taxPercent  - Tax percentage. Null or 0 = no tax.
 * @returns {number}                - Rounded to 4dp. Returns 0 if no tax.
 */
export function calculateTaxAmount(lineAmount, taxPercent) {
  if (!taxPercent || typeof taxPercent !== 'number' || taxPercent === 0) return 0;
  if (typeof lineAmount !== 'number') return 0;
  return round4(lineAmount * taxPercent / 100);
}

/**
 * Calculate line total (line_amount + tax_amount).
 * ALR-03: line_total = line_amount + tax_amount
 *
 * Inputs are already rounded to 4dp. No additional rounding applied here —
 * sum of two 4dp values produces at most 4dp result.
 *
 * @param {number} lineAmount - Output of calculateLineAmount.
 * @param {number} taxAmount  - Output of calculateTaxAmount.
 * @returns {number}
 */
export function calculateLineTotal(lineAmount, taxAmount) {
  if (typeof lineAmount !== 'number') lineAmount = 0;
  if (typeof taxAmount !== 'number') taxAmount = 0;
  return lineAmount + taxAmount;
}

/**
 * Calculate all three line values in one call.
 * Returns { lineAmount, taxAmount, lineTotal } — all rounded to 4dp.
 *
 * @param {object} params
 * @param {number}      params.qty
 * @param {number}      params.unitRate
 * @param {number|null} params.taxPercent
 * @returns {{ lineAmount: number, taxAmount: number, lineTotal: number }}
 */
export function calculateAllAmounts({ qty, unitRate, taxPercent }) {
  const lineAmount = calculateLineAmount(qty, unitRate);
  const taxAmount  = calculateTaxAmount(lineAmount, taxPercent);
  const lineTotal  = calculateLineTotal(lineAmount, taxAmount);
  return { lineAmount, taxAmount, lineTotal };
}
