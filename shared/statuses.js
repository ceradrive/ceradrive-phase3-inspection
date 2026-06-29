/**
 * CERADRIVE ERP — Status Constants
 * Stored status values for purchase_orders and grn_headers.
 *
 * Approved: Batch 10 — C7 (PO statuses), C8 (GRN statuses)
 *
 * STORED statuses: written to the database.
 * DERIVED statuses: computed at runtime from views — never stored.
 */

// ─── Purchase Order — Stored Statuses (C7) ───────────────────────────────────
export const PO_STATUS = {
  DRAFT:     'draft',
  APPROVED:  'approved',
  CLOSED:    'closed',
  CANCELLED: 'cancelled',
};

/**
 * PO receipt statuses — RUNTIME DERIVED ONLY.
 * Source: v_po_receipt_summary.derived_receipt_status
 * These values are NEVER written to purchase_orders.status.
 * Used for UI colour coding and filtering only.
 */
export const PO_RECEIPT_STATUS = {
  PENDING:    'pending',
  PARTIAL:    'partial',
  FULL:       'full',
  EXCESS:     'excess',
  OVERDUE:    'overdue',
  NO_RECEIPT: 'no_receipt',
};

// ─── GRN — Stored Statuses (C8) ──────────────────────────────────────────────
export const GRN_STATUS = {
  DRAFT:     'draft',
  POSTED:    'posted',
  CANCELLED: 'cancelled',
};

// ─── GRN Type Labels ──────────────────────────────────────────────────────────
export const GRN_TYPE = {
  PO_LINKED: 'PO-linked',
  DIRECT:    'Direct',
};

// ─── All valid arrays for validation ─────────────────────────────────────────
export const ALL_PO_STATUSES  = Object.values(PO_STATUS);
export const ALL_GRN_STATUSES = Object.values(GRN_STATUS);
