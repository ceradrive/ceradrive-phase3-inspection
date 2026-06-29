/**
 * CERADRIVE ERP — Work Order Service (WO-B1)
 *
 * Header DRAFT CRUD + pickers only, on the live wo_headers (27 cols).
 * Pattern mirrors bomService: returns { data, error }; throws { code, message } for
 * business-rule violations. CRUD only — NO line snapshot, release, production logs,
 * inventory, completion, or cancellation in this batch.
 *
 * Live wo_headers mandatory (NOT NULL) columns reconciled against current main:
 *   id (default uuid_generate_v4), wo_number (server-generated, no default),
 *   item_id (client), routing_type_id (DERIVED from routing, no default),
 *   routing_id (client), planned_qty (client, CHECK > 0),
 *   over_production_flag (default false), status (default 'draft'),
 *   priority_level (default 'NORMAL'), created_at (default now()).
 * NOTE: bom_id is NULLABLE on the live schema -> optional, not required.
 *
 * Derivations: wo_number via numberSeriesService.getNextNumber('WORK_ORDER') (returns the
 *   number string directly);
 *   routing_type_id from routing_headers of the chosen routing; uom_id defaults from
 *   item_master.uom_id when omitted. No hardcoded constants (R34).
 */

import { supabase } from '../config/supabase.js';
function sanitizeOrSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[,%_()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

import * as numberSeriesService from './numberSeriesService.js';

const VALID_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

// ─── Pickers (master-backed; live search) ─────────────────────────────────────

export async function searchItems({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase
    .from('item_master')
    .select('id, item_code, item_name')
    .eq('is_active', true)
    .order('item_name', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`item_name.ilike.%${safeSearch}%,item_code.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listRoutingsForItem(item_id) {
  if (!item_id) return { data: [], error: null };
  const { data, error } = await supabase
    .from('routing_headers')
    .select('id, item_id, routing_type_id, version_number, status')
    .eq('item_id', item_id)
    .order('version_number', { ascending: false });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listBomsForItem(item_id) {
  if (!item_id) return { data: [], error: null };
  const { data, error } = await supabase
    .from('bom_headers')
    .select('id, item_id, version_number, status')
    .eq('item_id', item_id)
    .order('version_number', { ascending: false });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listSkuPlansForItem(item_id) {
  if (!item_id) return { data: [], error: null };
  const { data, error } = await supabase
    .from('sku_planning_header')
    .select('id, item_id')
    .eq('item_id', item_id);
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listWarehouses() {
  const { data, error } = await supabase
    .from('warehouse_master')
    .select('id, warehouse_code, warehouse_name')
    .eq('is_active', true)
    .order('warehouse_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Validation / derivation helpers ──────────────────────────────────────────

async function deriveRoutingTypeId(routing_id) {
  const { data, error } = await supabase
    .from('routing_headers')
    .select('id, routing_type_id')
    .eq('id', routing_id)
    .maybeSingle();
  if (error || !data) throw { code: 'VALIDATION_ERROR', message: 'Selected routing does not exist.' };
  if (!data.routing_type_id) throw { code: 'VALIDATION_ERROR', message: 'Selected routing has no routing type.' };
  return data.routing_type_id;
}

async function defaultUomForItem(item_id) {
  const { data, error } = await supabase
    .from('item_master')
    .select('id, uom_id')
    .eq('id', item_id)
    .maybeSingle();
  if (error || !data) throw { code: 'VALIDATION_ERROR', message: 'Selected item does not exist.' };
  return data.uom_id ?? null;
}

function validatePriority(priority_level) {
  if (priority_level === undefined || priority_level === null || priority_level === '') return undefined;
  const p = String(priority_level).toUpperCase();
  if (!VALID_PRIORITIES.includes(p)) {
    throw { code: 'VALIDATION_ERROR', message: 'Priority must be one of LOW, NORMAL, HIGH, URGENT.' };
  }
  return p;
}

function validatePlannedDates(start, end) {
  if (start && end && new Date(end) < new Date(start)) {
    throw { code: 'VALIDATION_ERROR', message: 'Planned end cannot be earlier than planned start.' };
  }
}

// Optional, nullable header fields a client may set on a draft (whitelist).
// Excludes wo_number, status, routing_type_id (derived), and all audit/lifecycle columns.
function pickOptionalHeader(body, target) {
  const passthrough = [
    'bom_id', 'sku_plan_id', 'uom_id', 'wo_date',
    'planned_start', 'planned_end',
    'warehouse_issue_id', 'warehouse_receipt_id', 'parent_wo_id', 'notes',
  ];
  for (const key of passthrough) {
    if (body[key] !== undefined) target[key] = body[key] === '' ? null : body[key];
  }
  if (body.over_production_flag !== undefined) target.over_production_flag = Boolean(body.over_production_flag);
  const priority = validatePriority(body.priority_level);
  if (priority !== undefined) target.priority_level = priority;
  return target;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listWorkOrders({ status, item_id, wo_date, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('wo_headers')
    .select(`
      id, wo_number, item_id, routing_id, routing_type_id, bom_id, planned_qty,
      source_ppo_id, source_ppo_line_id, source_ppo_slot_id, process_type_id, stage_output_item_id,
      status, priority_level, wo_date, planned_start, planned_end, created_at
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (status)  query = query.eq('status', status);
  if (item_id) query = query.eq('item_id', item_id);
  if (wo_date) query = query.eq('wo_date', wo_date);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };

  const rows = data ?? [];
  const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))];
  let itemMap = {};

  if (itemIds.length > 0) {
    const { data: items, error: itemErr } = await supabase
      .from('item_master')
      .select('id, item_code, item_name')
      .in('id', itemIds);

    if (itemErr) return { data: null, count: null, error: itemErr };
    itemMap = Object.fromEntries((items ?? []).map((i) => [i.id, { item_code: i.item_code, item_name: i.item_name }]));
  }

  return {
    data: rows.map((r) => ({ ...r, item: itemMap[r.item_id] ?? null })),
    count: count ?? 0,
    error: null,
  };
}

export async function getWorkOrderById(id) {
  const { data, error } = await supabase
    .from('wo_headers')
    .select(`
      id, wo_number, item_id, routing_id, routing_type_id, bom_id, sku_plan_id,
      wo_kind, source_internal_plan_id, source_internal_plan_line_id,
      uom_id, planned_qty, over_production_flag, status, priority_level,
      wo_date, planned_start, planned_end,
      warehouse_issue_id, warehouse_receipt_id, parent_wo_id, notes,
      source_ppo_id, source_ppo_line_id, source_ppo_slot_id, process_type_id, stage_output_item_id,
      created_by, created_at, updated_by, updated_at,
      released_by, released_at, completed_by, completed_at,
      closed_by, closed_at, cancelled_by, cancelled_at
    `)
    .eq('id', id)
    .single();
  if (error || !data) return { data: null, error: error ?? { message: 'Work order not found.' } };

  // item is also resolved separately to avoid PostgREST relationship/embed failures.
  if (data.item_id) {
    const { data: item } = await supabase
      .from('item_master')
      .select('id, item_code, item_name')
      .eq('id', data.item_id)
      .maybeSingle();
    data.item = item ?? null;
  } else {
    data.item = null;
  }

  // routing/bom/sku_plan are resolved via separate lookups instead of relational embeds:
  // embedding them from wo_headers was failing PostgREST relationship resolution and
  // 404-ing every work order. These plain selects mirror the rest of the codebase.
  if (data.routing_id) {
    const { data: r } = await supabase.from('routing_headers').select('id, version_number, status').eq('id', data.routing_id).maybeSingle();
    data.routing = r ?? null;
  } else { data.routing = null; }
  if (data.bom_id) {
    const { data: b } = await supabase.from('bom_headers').select('id, version_number, status').eq('id', data.bom_id).maybeSingle();
    data.bom = b ?? null;
  } else { data.bom = null; }
  if (data.sku_plan_id) {
    const { data: s } = await supabase.from('sku_planning_header').select('id, version_number, status').eq('id', data.sku_plan_id).maybeSingle();
    data.sku_plan = s ?? null;
  } else { data.sku_plan = null; }

  // step_lines + component_lines for the detail tabs / progress — separate queries only
  // (NO relational embeds). Snapshot tables are populated by releaseWorkOrder.
  const { data: stepLines } = await supabase
    .from('wo_step_lines')
    .select('id, seq_no, step_name, step_status, planned_qty, is_wo_driven, wip_produced, qc_required, machine_required, die_required, labour_required')
    .eq('wo_id', id)
    .order('seq_no', { ascending: true });
  data.step_lines = stepLines ?? [];

  const { data: compLines } = await supabase
    .from('wo_component_lines')
    .select('id, component_item_id, uom_id, required_qty, issued_qty, component_type, is_optional, is_active, notes')
    .eq('wo_id', id);
  const comps = compLines ?? [];
  const compItemIds = [...new Set(comps.map((c) => c.component_item_id).filter(Boolean))];
  let compItemMap = {};
  if (compItemIds.length > 0) {
    const { data: compItems } = await supabase
      .from('item_master')
      .select('id, item_code, item_name')
      .in('id', compItemIds);
    compItemMap = Object.fromEntries((compItems ?? []).map((i) => [i.id, { item_code: i.item_code, item_name: i.item_name }]));
  }
  data.component_lines = comps.map((c) => ({ ...c, component: compItemMap[c.component_item_id] ?? null }));

  return { data, error: null };
}

// ─── Write (draft only) ───────────────────────────────────────────────────────

export async function createWorkOrder(body, userId) {
  if (!body.item_id)    throw { code: 'VALIDATION_ERROR', message: 'Item is required.' };
  if (!body.routing_id) throw { code: 'VALIDATION_ERROR', message: 'Routing is required.' };

  const qty = Number(body.planned_qty);
  if (!(qty > 0)) throw { code: 'VALIDATION_ERROR', message: 'Planned quantity must be greater than 0.' };

  validatePlannedDates(body.planned_start, body.planned_end);

  // routing_type_id is NOT NULL on wo_headers -> derive from the chosen routing
  const routing_type_id = await deriveRoutingTypeId(body.routing_id);

  // uom_id defaults from item_master when not supplied (nullable column)
  const uom_id = body.uom_id !== undefined && body.uom_id !== ''
    ? body.uom_id
    : await defaultUomForItem(body.item_id);

  // wo_number from the live WORK_ORDER series.
  // numberSeriesService.getNextNumber(seriesCode) returns the number string DIRECTLY
  // (it `return data;`) — not a { data, error } envelope. It throws on failure, which
  // the route try/catch surfaces; we also guard against a falsy return.
  const wo_number = await numberSeriesService.getNextNumber('WORK_ORDER');
  if (!wo_number) {
    return { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to generate work order number.' } };
  }

  const row = {
    wo_number,
    item_id:         body.item_id,
    routing_id:      body.routing_id,
    routing_type_id,
    planned_qty:     qty,
    status:          'draft',          // forced; not client-settable
    uom_id,
    created_by:      userId,
  };
  pickOptionalHeader(body, row);

  const { data: created, error } = await supabase
    .from('wo_headers')
    .insert(row)
    .select('id')
    .single();
  if (error) return { data: null, error };

  return getWorkOrderById(created.id);
}

export async function updateDraftWorkOrder(id, body, userId) {
  const { data: current, error: curErr } = await supabase
    .from('wo_headers')
    .select('id, status, item_id, routing_id, bom_id, planned_qty')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'Work order not found.' } };
  if (current.status !== 'draft') {
    throw { code: 'VALIDATION_ERROR', message: 'Only draft work orders can be edited.' };
  }

  const allowed = {};

  if (body.item_id    !== undefined) allowed.item_id    = body.item_id;
  if (body.routing_id !== undefined) {
    allowed.routing_id      = body.routing_id;
    allowed.routing_type_id = await deriveRoutingTypeId(body.routing_id); // keep NOT NULL consistent
  }
  let plannedQtyChanged = false;
  let newPlannedQty = null;

  if (body.planned_qty !== undefined) {
    const q = Number(body.planned_qty);
    if (!(q > 0)) throw { code: 'VALIDATION_ERROR', message: 'Planned quantity must be greater than 0.' };
    allowed.planned_qty = q;
    allowed.readiness_status = 'NOT_CHECKED';
    allowed.ready_to_start_qty = 0;
    allowed.blocked_qty = q;
    plannedQtyChanged = true;
    newPlannedQty = q;
  }

  validatePlannedDates(
    body.planned_start ?? undefined,
    body.planned_end ?? undefined,
  );

  pickOptionalHeader(body, allowed);

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = new Date().toISOString();
    const { error } = await supabase.from('wo_headers').update(allowed).eq('id', id);
    if (error) return { data: null, error };
  }

  if (plannedQtyChanged) {
    const { error: stepErr } = await supabase
      .from('wo_step_lines')
      .update({
        planned_qty: newPlannedQty,
        readiness_status: 'NOT_CHECKED',
        ready_to_start_qty: 0,
        blocked_qty: newPlannedQty,
        updated_at: new Date().toISOString(),
      })
      .eq('wo_id', id);

    if (stepErr) return { data: null, error: stepErr };

    const compSnapshot = await snapshotBomComponentsForWO(id, current.bom_id, newPlannedQty, userId);
    if (compSnapshot.error) return { data: null, error: compSnapshot.error };
  }

  return getWorkOrderById(id);
}

// ─── Release (WO-B2) ──────────────────────────────────────────────────────────
/**
 * Release a draft work order: snapshot the active routing steps into wo_step_lines and
 * (if a BOM is set) the active BOM lines into wo_component_lines, then flip status to
 * 'released' LAST. Atomicity Option A (no RPC): sequential service-layer writes; existing
 * snapshot rows for the WO are deleted first so a failed/retried release is idempotent.
 * Any error before the status flip leaves the WO in 'draft' (retryable).
 *
 * Snapshot rules (locked): ALL active routing steps snapshotted (is_wo_driven is a flag,
 * not a status); every step_status = 'not_started'; required_qty = bom_lines.quantity *
 * planned_qty (scrap_factor deferred); issued_qty = 0; machine_id/die_id NULL (assigned at
 * execution); target_cycle_time_sec/target_batch_size_kg NULL (SKU-plan-driven, deferred).
 * No production logs, no inventory.
 */

export async function snapshotBomComponentsForWO(woId, bomId, plannedQty, userId) {
  const { error: delCompErr } = await supabase
    .from('wo_component_lines')
    .delete()
    .eq('wo_id', woId);

  if (delCompErr) return { data: null, error: delCompErr };

  if (!bomId) {
    return { data: { inserted: 0 }, error: null };
  }

  const { data: bomLines, error: linesErr } = await supabase
    .from('bom_lines')
    .select('id, component_item_id, uom_id, quantity, step_link_routing_step_id, component_type, is_optional, notes')
    .eq('bom_id', bomId)
    .eq('is_active', true);

  if (linesErr) return { data: null, error: linesErr };

  if (!bomLines || bomLines.length === 0) {
    return { data: { inserted: 0 }, error: null };
  }

  const qty = Number(plannedQty || 0);

  const compRows = bomLines.map((line) => {
    const requiredQty = Number(line.quantity) * qty;
    if (!(requiredQty > 0)) {
      throw { code: 'VALIDATION_ERROR', message: 'Computed required quantity must be greater than 0.' };
    }

    return {
      wo_id:                     woId,
      component_item_id:         line.component_item_id,
      uom_id:                    line.uom_id,
      step_link_routing_step_id: line.step_link_routing_step_id ?? null,
      required_qty:              requiredQty,
      issued_qty:                0,
      component_type:            line.component_type ?? null,
      is_optional:               Boolean(line.is_optional),
      is_active:                 true,
      source_bom_line_id:        line.id,
      notes:                     line.notes ?? null,
      created_by:                userId,
    };
  });

  const { error: insCompErr } = await supabase
    .from('wo_component_lines')
    .insert(compRows);

  if (insCompErr) return { data: null, error: insCompErr };

  return { data: { inserted: compRows.length }, error: null };
}

export async function releaseWorkOrder(id, userId) {
  // 1. Load WO; must be draft and material-ready
  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, status, routing_id, bom_id, planned_qty, readiness_status, wo_kind')
    .eq('id', id)
    .single();
  if (woErr || !wo) return { data: null, error: woErr ?? { code: 'NOT_FOUND', message: 'Work order not found.' } };
  // P3: PPO-generated stage Work Orders are released only from their Production Plan
  // Order (PPO), never from the Work Order screen. Manual/non-PPO WOs (wo_kind null or
  // other) keep direct release. Positive match so null wo_kind is unaffected. No
  // readiness/inventory/log/assignment/schema/SQL change.
  // P-3G.6: INTERNAL_PLAN Work Orders are released only through the Internal Production Plan
  // flow, never from the Work Order screen. Separate branch; the PPO_STAGE block below is unchanged.
  if (String(wo.wo_kind || '').toUpperCase() === 'INTERNAL_PLAN') {
    throw {
      code: 'CONFLICT',
      status: 409,
      message: 'Internal Plan Work Orders must be released from the Internal Production Plan flow.',
    };
  }
  if (String(wo.wo_kind || '').toUpperCase() === 'PPO_STAGE') {
    throw {
      code: 'CONFLICT',
      status: 409,
      message: 'This is a PPO-generated Work Order. Release it from its Production Plan Order (PPO), not from the Work Order screen.',
    };
  }
  if (wo.status !== 'draft') {
    throw { code: 'VALIDATION_ERROR', message: 'Only draft work orders can be released.' };
  }

  const readinessStatus = String(wo.readiness_status || 'NOT_CHECKED').toUpperCase();
  if (!['READY', 'PARTIAL'].includes(readinessStatus)) {
    throw {
      code: 'CONFLICT',
      status: 409,
      message: `Cannot release: work order inputs are ${readinessStatus}. Run Recheck Readiness first.`,
    };
  }

  const plannedQty = Number(wo.planned_qty);

  // 2. Active routing steps (>= 1). routing_steps keys on routing_header_id = WO.routing_id.
  const { data: steps, error: stepsErr } = await supabase
    .from('routing_steps')
    .select('id, seq_no, step_name, is_wo_driven, wip_produced, qc_required, machine_required, die_required, labour_required')
    .eq('routing_header_id', wo.routing_id)
    .eq('is_active', true)
    .order('seq_no', { ascending: true });
  if (stepsErr) return { data: null, error: stepsErr };
  if (!steps || steps.length === 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Selected routing has no active steps to release.' };
  }

  // 4. Idempotent re-release: clear prior snapshot rows for this WO.
  //    Safe: release only runs from 'draft', so no production_logs reference these lines yet.
  const { error: delStepErr } = await supabase.from('wo_step_lines').delete().eq('wo_id', id);
  if (delStepErr) return { data: null, error: delStepErr };

  // 5. Snapshot ALL steps -> wo_step_lines (not_started). over_production_flag omitted
  //    (schema default applies); machine_id/die_id and target_* left NULL.
  const stepRows = steps.map((s) => ({
    wo_id:            id,
    routing_step_id:  s.id,
    seq_no:           s.seq_no,
    step_name:        s.step_name,
    is_wo_driven:     s.is_wo_driven,
    wip_produced:     s.wip_produced,
    qc_required:      s.qc_required,
    machine_required: s.machine_required,
    die_required:     s.die_required,
    labour_required:  s.labour_required,
    planned_qty:      plannedQty,
    step_status:      'not_started',
    created_by:       userId,
  }));
  const { error: insStepErr } = await supabase.from('wo_step_lines').insert(stepRows);
  if (insStepErr) return { data: null, error: insStepErr };

  // 6. Snapshot BOM components -> wo_component_lines (required_qty = quantity * planned_qty)
  const compSnapshot = await snapshotBomComponentsForWO(id, wo.bom_id, plannedQty, userId);
  if (compSnapshot.error) return { data: null, error: compSnapshot.error };

  // 7. Flip status LAST
  const { error: updErr } = await supabase
    .from('wo_headers')
    .update({ status: 'released', released_by: userId, released_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return { data: null, error: updErr };

  return getWorkOrderById(id);
}

// ─── Lifecycle transitions (WO Phase 1) ───────────────────────────────────────
/**
 * Status-only transitions on wo_headers. No snapshot, no inventory, no production
 * logs, no WIP/QC/scheduler/MRP. Each stamps ONLY its own *_by/*_at pair. Mirrors
 * releaseWorkOrder's load -> guard -> update -> re-read shape. Forward-only: no
 * un-release, no reopen.
 *   complete: released  -> completed       (completed_by/at)
 *   close:    completed -> closed          (closed_by/at)
 *   cancel:   draft|released -> cancelled  (cancelled_by/at)
 */

async function outputSummaryForWorkOrder(id) {
  const { data: logs, error } = await supabase
    .from('production_logs')
    .select('good_qty, entry_type, correction_delta_good_qty')
    .eq('wo_id', id);

  if (error) throw error;

  const producedQty = (logs || []).reduce((sum, log) => {
    const qty = String(log.entry_type || '').toUpperCase() === 'CORRECTION'
      ? Number(log.correction_delta_good_qty || 0)
      : Number(log.good_qty || 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);

  return {
    producedQty,
    logCount: (logs || []).length,
  };
}

async function assertWorkOrderHasOutput(wo) {
  const plannedQty = Number(wo?.planned_qty || 0);
  const { producedQty, logCount } = await outputSummaryForWorkOrder(wo.id);

  if (plannedQty > 0 && (logCount === 0 || producedQty <= 0)) {
    throw {
      code: 'VALIDATION_ERROR',
      message: `No output logged. Please log production before completing/closing this Work Order. Produced ${producedQty} / Planned ${plannedQty}.`,
    };
  }
}

export async function completeWorkOrder(id, userId) {
  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, status, planned_qty')
    .eq('id', id)
    .single();
  if (woErr || !wo) return { data: null, error: woErr ?? { code: 'NOT_FOUND', message: 'Work order not found.' } };
  if (wo.status !== 'released') {
    throw { code: 'VALIDATION_ERROR', message: 'Only released work orders can be completed.' };
  }

  await assertWorkOrderHasOutput(wo);

  const { error: updErr } = await supabase
    .from('wo_headers')
    .update({ status: 'completed', completed_by: userId, completed_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return { data: null, error: updErr };
  return getWorkOrderById(id);
}

export async function closeWorkOrder(id, userId) {
  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, status, planned_qty')
    .eq('id', id)
    .single();
  if (woErr || !wo) return { data: null, error: woErr ?? { code: 'NOT_FOUND', message: 'Work order not found.' } };
  if (wo.status !== 'completed') {
    throw { code: 'VALIDATION_ERROR', message: 'Only completed work orders can be closed.' };
  }

  await assertWorkOrderHasOutput(wo);

  const { error: updErr } = await supabase
    .from('wo_headers')
    .update({ status: 'closed', closed_by: userId, closed_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return { data: null, error: updErr };
  return getWorkOrderById(id);
}

export async function cancelWorkOrder(id, userId) {
  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, status')
    .eq('id', id)
    .single();
  if (woErr || !wo) return { data: null, error: woErr ?? { code: 'NOT_FOUND', message: 'Work order not found.' } };
  if (wo.status !== 'draft' && wo.status !== 'released') {
    throw { code: 'VALIDATION_ERROR', message: `Cannot cancel a ${wo.status} work order.` };
  }
  const { error: updErr } = await supabase
    .from('wo_headers')
    .update({ status: 'cancelled', cancelled_by: userId, cancelled_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return { data: null, error: updErr };
  return getWorkOrderById(id);
}
