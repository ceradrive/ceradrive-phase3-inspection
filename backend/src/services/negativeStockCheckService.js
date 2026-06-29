/**
 * CERADRIVE ERP — Negative Stock Check Service
 *
 * PHASE 9E — NOT YET IMPLEMENTED.
 *
 * Pre-checks whether a GRN cancellation reversal would cause
 * any inventory_balance row to go below zero.
 *
 * OBD-01 (locked Step 8): BLOCK cancellation if reversal causes negative stock.
 * User message: "Cannot cancel this GRN because stock has already been
 *                consumed or moved. Reverse downstream stock first."
 *
 * Design:
 *   - Runs OUTSIDE the transaction (pre-check, not in-transaction guard)
 *   - For each grn_line with ledger_entry_id IS NOT NULL:
 *       SELECT quantity FROM inventory_balance
 *       WHERE item_id = line.item_id AND warehouse_id = grn_header.warehouse_id
 *       IF quantity - line.received_qty < 0 → add to blocked list
 *   - Returns { canCancel: false, blockedLines: [...] } if any line would go negative
 *   - Returns { canCancel: true } if all lines are safe
 *
 * Note: inventory_balance.quantity confirmed column name (PIC-05).
 */

export async function checkNegativeStockOnReversal() {
  throw {
    code:    'INTERNAL_ERROR',
    message: 'checkNegativeStockOnReversal is not yet implemented. Available in Phase 9E.',
  };
}
