/**
 * CERADRIVE ERP — Inventory Posting Service
 *
 * PHASE 9E — NOT YET IMPLEMENTED.
 *
 * Will encapsulate the full atomic GRN posting and cancellation transactions.
 *
 * Confirmed schema details to use when implementing:
 *   inventory_balance.quantity          — NOT on_hand_qty (PIC-05)
 *   inventory_ledger.movement_type_code — NOT movement_type_id (PIC-04)
 *   GRN posting code:   MOVEMENT_TYPES.GRN_RECEIPT  = 'GRN'
 *   GRN reversal code:  MOVEMENT_TYPES.GRN_REVERSAL = 'GRN_REVERSAL'
 *   Manufacturing codes: MOVEMENT_TYPES.WO_ISSUE / WO_RECEIPT
 *
 *   inventory_balance conflict target: (item_id, warehouse_id) — confirmed PIC-06
 *   uom_id is NOT NULL on inventory_balance — ALR-21 must pre-validate UOM match
 *   updated_by and updated_at must be set on every balance UPDATE
 *
 * Transaction design (Step 7, Section 5 — GRN Post Transaction):
 *   BEGIN
 *   1. Lock GRN header row (SELECT FOR UPDATE)
 *   2. Verify status = 'draft'
 *   3. For each grn_line:
 *      a. INSERT inventory_ledger (movement_type_code = 'GRN', qty = received_qty)
 *      b. UPSERT inventory_balance (quantity += received_qty, uom_id, updated_by, updated_at)
 *      c. UPDATE grn_lines SET ledger_entry_id = returned ledger id
 *   4. UPDATE grn_headers SET status = 'posted', posted_by, posted_at = NOW()
 *   5. Verify: SELECT COUNT(*) WHERE ledger_entry_id IS NULL = 0
 *   6. COMMIT (or ROLLBACK on any step failure)
 *
 * Negative stock guard (OBD-01) for cancellation:
 *   Pre-check BEFORE transaction begins:
 *     For each line: if balance.quantity - received_qty < 0 → BLOCK
 *   In-transaction guard:
 *     WHERE quantity - :qty >= 0 on UPDATE — if 0 rows affected → ROLLBACK + 409
 */

import { supabase } from '../config/supabase.js';

// Posts a draft GRN to inventory via the atomic RPC fn_post_grn(uuid, uuid).
// Returns { data, error } (service convention). RPC RAISE (bad status / no lines)
// surfaces as error -> mapped to CONFLICT (409) for the route.
export async function postGRN(grnId, postedBy) {
  const { data, error } = await supabase.rpc('fn_post_grn', {
    p_grn_id:    grnId,
    p_posted_by: postedBy,
  });
  if (error) return { data: null, error: { code: 'CONFLICT', message: error.message } };
  return { data, error: null };
}

// Cancels a posted GRN via the atomic RPC fn_cancel_grn(uuid, uuid, text).
// Negative-stock reversal is hard-blocked inside the RPC -> surfaces as CONFLICT.
export async function cancelGRN(grnId, cancelledBy, reason = null) {
  const { data, error } = await supabase.rpc('fn_cancel_grn', {
    p_grn_id:       grnId,
    p_cancelled_by: cancelledBy,
    p_reason:       reason,
  });
  if (error) return { data: null, error: { code: 'CONFLICT', message: error.message } };
  return { data, error: null };
}

// ─── Production-log inventory posting (Phase I-1) ──────────────────────────────
//
// Wraps the explicit RPC public.fn_post_production_log(uuid, uuid). The RPC is
// atomic server-side; this wrapper NEVER throws so a posting failure cannot fail
// or roll back the already-saved production log. Returns a normalised posting
// sub-status for the route to attach to its 201 response.
//
// Result mapping:
//   RPC jsonb { status: ... }            → posting sub-status
//   RPC RAISE EXCEPTION (PostgREST error) → 'blocked' (insufficient stock) or 'error'
//
// 'blocked' is detected from the deterministic "need <n> have <m>" suffix that the
// RPC appends on a negative-stock block. A future 0064 revision could assign a
// dedicated SQLSTATE for classification by code instead of message (no change here).
export async function postProductionLog(productionLogId, postedBy) {
  try {
    const { data, error } = await supabase.rpc('fn_post_production_log', {
      p_production_log_id: productionLogId,
      p_posted_by:         postedBy,
    });

    if (error) {
      const message = error.message || 'Inventory posting failed.';
      const blocked = /need\s.*\shave\s/i.test(message);
      return { status: blocked ? 'blocked' : 'error', message };
    }

    const rpc    = data ?? {};
    const status = rpc.status ?? 'error';

    switch (status) {
      case 'POSTED':
        return { status: 'posted', posted_rows: rpc.posted_rows ?? 0, is_final_step: rpc.is_final_step };
      case 'POSTING_OFF':
        return { status: 'off' };
      case 'BEFORE_GO_LIVE':
        return { status: 'skipped_historical' };
      case 'ALREADY_POSTED':
        return { status: 'already' };
      case 'NOOP_NONPOSITIVE_QTY':
        return { status: 'noop_qty' };
      case 'NO_INVENTORY_IMPACT':
        return { status: 'none', is_final_step: rpc.is_final_step };
      default:
        return { status: 'error', message: `Unexpected posting status: ${status}` };
    }
  } catch (err) {
    return { status: 'error', message: err?.message || 'Inventory posting failed.' };
  }
}
