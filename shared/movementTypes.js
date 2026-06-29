/**
 * CERADRIVE ERP — Movement Type Code Constants
 *
 * These strings are confirmed from live Supabase movement_types table
 * in Part 3 DB/schema/RPC audit.
 *
 * They match movement_types.movement_type_code and are written directly to
 * inventory_ledger.movement_type_code (VARCHAR).
 *
 * No UUID lookup is performed at runtime — codes are written directly.
 *
 * DO NOT change these values without verifying against the live movement_types table.
 */

export const MOVEMENT_TYPES = {
  OPENING_BALANCE: 'OPENING_BALANCE',

  GRN_RECEIPT: 'GRN',
  GRN_REVERSAL: 'GRN_REVERSAL',

  WO_ISSUE: 'WO_ISSUE',
  WO_RECEIPT: 'WO_RECEIPT',

  SALES_DESPATCH: 'SALES_DESPATCH',

  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',

  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  QC_TRANSFER: 'QC_TRANSFER',
  SCRAP: 'SCRAP',
  REJECTION: 'REJECTION',
};
