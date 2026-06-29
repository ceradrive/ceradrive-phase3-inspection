/**
 * CERADRIVE ERP — Amount Calculator (Backend)
 *
 * Re-exports pure calculation functions from @ceradrive/shared.
 * Backend services and validators import from here.
 *
 * These are the server-side canonical calculations.
 * The frontend mirrors these via shared/validation/amounts.js.
 *
 * Approved rules: ALR-01, ALR-02, ALR-03
 */
export {
  round4,
  calculateLineAmount,
  calculateTaxAmount,
  calculateLineTotal,
  calculateAllAmounts,
} from '@ceradrive/shared/validation/amounts';
