/**
 * CERADRIVE ERP — Inventory Service
 *
 * Phase 9A: Read functions only (balance lookup for display).
 * Phase 9E: Write functions added (balance upsert, ledger insert).
 *
 * Confirmed schema (PIC-05):
 *   inventory_balance columns: id, item_id, warehouse_id, quantity, uom_id,
 *                              created_by, created_at, updated_by, updated_at
 *
 * DO NOT use on_hand_qty — column is named 'quantity' (PIC-05 confirmed).
 * DO NOT use movement_type_id — inventory_ledger uses movement_type_code VARCHAR (PIC-04).
 */

import { supabase } from '../config/supabase.js';

/**
 * Get current inventory balance for a specific item + warehouse combination.
 *
 * @param {string} itemId       - item_master UUID
 * @param {string} warehouseId  - warehouse_master UUID
 * @returns {Promise<{ data: object|null, error: object|null }>}
 *
 * Returns null data (not an error) if no balance row exists yet.
 */
export async function getInventoryBalance(itemId, warehouseId) {
  const { data, error } = await supabase
    .from('inventory_balance')
    .select('id, item_id, warehouse_id, quantity, uom_id, updated_at')
    .eq('item_id', itemId)
    .eq('warehouse_id', warehouseId)
    .maybeSingle();   // Returns null if not found — does not error

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Get inventory balances for multiple items in a warehouse.
 * Used for pre-posting UOM validation (ALR-21) and display.
 *
 * @param {string[]} itemIds      - Array of item_master UUIDs
 * @param {string}   warehouseId  - warehouse_master UUID
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
export async function getInventoryBalancesBulk(itemIds, warehouseId) {
  if (!itemIds || itemIds.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from('inventory_balance')
    .select('id, item_id, warehouse_id, quantity, uom_id')
    .in('item_id', itemIds)
    .eq('warehouse_id', warehouseId);

  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Phase 9E — Write Functions (scaffolded, not implemented yet) ─────────────

/**
 * PHASE 9E PLACEHOLDER — Upsert inventory balance.
 *
 * Will implement the atomic balance upsert for GRN posting.
 *
 * Schema notes (confirmed PIC-05):
 *   - Quantity column: 'quantity' (NOT on_hand_qty)
 *   - Conflict target: (item_id, warehouse_id) — confirmed PIC-06
 *   - uom_id is NOT NULL — ALR-21 must validate UOM match before calling this
 *   - updated_by and updated_at must be set on every UPDATE
 *
 * ALR-21: If existing balance row has different uom_id than incoming transaction,
 *         block posting — no auto-conversion in Batch 10.
 *
 * NOT IMPLEMENTED IN PHASE 9A. Throws if called prematurely.
 */
export async function upsertInventoryBalance() {
  throw {
    code:    'INTERNAL_ERROR',
    message: 'upsertInventoryBalance is not yet implemented. Available in Phase 9E.',
  };
}

/**
 * PHASE 9E PLACEHOLDER — Insert inventory ledger entry.
 *
 * Will implement ledger row creation for GRN posting and reversal.
 *
 * Schema notes (confirmed PIC-04):
 *   - movement_type_code: VARCHAR (NOT movement_type_id UUID)
 *   - GRN posting uses MOVEMENT_TYPES.GRN_RECEIPT = 'GRN'
 *   - GRN reversal uses MOVEMENT_TYPES.GRN_REVERSAL = 'GRN_REVERSAL'
 *
 * NOT IMPLEMENTED IN PHASE 9A. Throws if called prematurely.
 */
export async function insertInventoryLedger() {
  throw {
    code:    'INTERNAL_ERROR',
    message: 'insertInventoryLedger is not yet implemented. Available in Phase 9E.',
  };
}
