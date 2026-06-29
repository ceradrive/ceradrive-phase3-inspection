/**
 * CERADRIVE ERP — Internal Production Plan Service (P-3E.2)
 *
 * CRUD-lite over the Internal Production Plan model (migration 0120):
 *   internal_production_plans (header) + internal_production_plan_lines (lines).
 * Functions: createPlanFromSelected, listPlans, getPlanById, cancelPlan.
 * Returns { data, error }; business-rule failures carry { code, status, message }.
 *
 * Scope: create / list / get / cancel ONLY. Recipe/routing resolution (approve) and
 * any downstream manufacturing-order generation are intentionally NOT in this file
 * (later phases). This service touches only the two internal-plan tables plus
 * item_master / uom_master lookups and the number-series RPC.
 *
 * Number: getNextNumber('INTERNAL_PLAN') -> IPP/{FY}/####.
 * Transaction: Supabase JS has no multi-statement DB transaction, so line-insert
 * failure triggers a compensating delete of the just-created header (same pattern as
 * the existing plan-order create path). No raw .or() filters (injection-safe).
 */

import { supabase } from '../config/supabase.js';
import { getNextNumber } from './numberSeriesService.js';
import { snapshotBomComponentsForWO, listBomsForItem } from './woService.js';

const HEADER = 'internal_production_plans';
const LINES = 'internal_production_plan_lines';

// Cancel is allowed ONLY from these header statuses.
const CANCELLABLE = ['DRAFT', 'APPROVED'];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cleanId(v) {
  return v ? String(v) : null;
}

// Merge selected items by item_id (sum qty); keep first stage_type/sources/uom hints.
// Mirrors the de-dup behaviour of the selection screen.
function mergeItemsByItemId(items) {
  const map = new Map();
  const order = [];
  for (const raw of items) {
    const itemId = cleanId(raw && raw.item_id);
    if (!itemId) {
      return { error: { code: 'VALIDATION_ERROR', status: 400, message: 'Each item requires item_id.' } };
    }
    const qty = num(raw && raw.qty);
    if (!(qty > 0)) {
      return { error: { code: 'VALIDATION_ERROR', status: 400, message: `Item ${(raw && raw.item_code) || itemId} requires qty > 0.` } };
    }
    if (map.has(itemId)) {
      map.get(itemId).qty += qty;
    } else {
      order.push(itemId);
      map.set(itemId, {
        item_id: itemId,
        qty,
        uom_id: cleanId(raw && raw.uom_id),
        uom_code: raw && raw.uom_code ? String(raw.uom_code).trim() : null,
        stage_type: raw && raw.stage_type ? String(raw.stage_type) : null,
        sources: Array.isArray(raw && raw.sources) ? raw.sources : [],
        item_code: raw && raw.item_code ? String(raw.item_code) : null,
      });
    }
  }
  return { lines: order.map((id) => map.get(id)) };
}

export async function createPlanFromSelected(items, userId, notes) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: 'No items supplied for the internal production plan.' } };
  }

  const merged = mergeItemsByItemId(list);
  if (merged.error) return { data: null, error: merged.error };
  const lines = merged.lines;

  // Validate item existence + read item_master.uom_id for fallback resolution.
  const itemIds = lines.map((l) => l.item_id);
  const { data: itemRows, error: itemErr } = await supabase
    .from('item_master')
    .select('id, item_code, uom_id')
    .in('id', itemIds);
  if (itemErr) return { data: null, error: itemErr };
  const itemById = new Map((itemRows || []).map((i) => [i.id, i]));
  const missing = itemIds.filter((id) => !itemById.has(id));
  if (missing.length) {
    return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: `Unknown item_id(s): ${missing.join(', ')}.` } };
  }

  // Resolve uom_code hints to uom_master ids (exact code match; safe .in() only).
  const codesToResolve = [...new Set(lines.filter((l) => !l.uom_id && l.uom_code).map((l) => l.uom_code))];
  let uomByCode = new Map();
  if (codesToResolve.length) {
    const { data: uomRows, error: uomErr } = await supabase
      .from('uom_master')
      .select('id, uom_code')
      .in('uom_code', codesToResolve);
    if (uomErr) return { data: null, error: uomErr };
    uomByCode = new Map((uomRows || []).map((u) => [String(u.uom_code), u.id]));
  }

  // Final uom per line: uom_id -> uom_code -> item default. Else reject (uom_id NOT NULL).
  for (const l of lines) {
    let uomId = l.uom_id;
    if (!uomId && l.uom_code) uomId = uomByCode.get(l.uom_code) || null;
    if (!uomId) uomId = (itemById.get(l.item_id) && itemById.get(l.item_id).uom_id) || null;
    if (!uomId) {
      return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: `Could not resolve UOM for item ${l.item_code || l.item_id}.` } };
    }
    l.resolved_uom_id = uomId;
  }

  // Plan number from the INTERNAL_PLAN series.
  let planNumber;
  try {
    planNumber = await getNextNumber('INTERNAL_PLAN');
  } catch (e) {
    return { data: null, error: { code: e.code || 'INTERNAL_ERROR', status: 500, message: e.message || 'Internal plan number series error.' } };
  }

  // Header (status DRAFT + source_type INTERNAL_DRAFT come from table defaults).
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .insert({
      plan_number: planNumber,
      notes: notes ? String(notes) : null,
      created_by: userId || null,
    })
    .select('*')
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'INTERNAL_ERROR', status: 500, message: 'Failed to create internal production plan header.' } };
  }

  const lineRows = lines.map((l, idx) => ({
    plan_id: header.id,
    line_number: idx + 1,
    item_id: l.item_id,
    stage_type: l.stage_type,
    qty: l.qty,
    uom_id: l.resolved_uom_id,
    sources: l.sources || [],
    notes: l.item_code ? `From selected internal items: ${l.item_code}` : null,
  }));

  const { data: insertedLines, error: lErr } = await supabase
    .from(LINES)
    .insert(lineRows)
    .select('*');

  if (lErr) {
    // Compensate: remove the just-created header so no empty plan is left behind.
    await supabase.from(HEADER).delete().eq('id', header.id);
    return { data: null, error: lErr };
  }

  return { data: { ...header, lines: insertedLines || [] }, error: null };
}

export async function listPlans({ status, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(num(limit, 50) || 50, 200);
  const offset = (Math.max(num(page, 1) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from(HEADER)
    .select('id, plan_number, status, source_type, notes, created_by, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);
  if (status) query = query.eq('status', String(status));

  const { data: headers, error, count } = await query;
  if (error) return { data: null, count: null, error };

  const planIds = (headers || []).map((h) => h.id);
  const countByPlan = new Map();
  if (planIds.length) {
    const { data: lineRows, error: lErr } = await supabase
      .from(LINES)
      .select('plan_id')
      .in('plan_id', planIds);
    if (lErr) return { data: null, count: null, error: lErr };
    for (const r of lineRows || []) countByPlan.set(r.plan_id, (countByPlan.get(r.plan_id) || 0) + 1);
  }

  return {
    data: (headers || []).map((h) => ({ ...h, line_count: countByPlan.get(h.id) || 0 })),
    count: count ?? 0,
    error: null,
  };
}

export async function getPlanById(id) {
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .select('*')
    .eq('id', id)
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'Internal production plan not found.' } };
  }

  const { data: lines, error: lErr } = await supabase
    .from(LINES)
    .select('*')
    .eq('plan_id', id)
    .order('line_number', { ascending: true });
  if (lErr) return { data: null, error: lErr };

  let lineRows = lines || [];

  // P3-IPP-RESOLVE-REFRESH-1: opening/refreshing a DRAFT/APPROVED plan should heal
  // stale resolved_recipe_id/resolved_routing_id values after recipes/routings are
  // activated later. This keeps users out of manual Supabase id repair and leaves
  // Work Order generation logic unchanged.
  const refresh = await refreshResolvedRecipeRoutingForPlanLines(header, lineRows);
  if (refresh.error) return { data: null, error: refresh.error };
  lineRows = refresh.lines;

  const itemIds = [...new Set(lineRows.map((l) => l.item_id).filter(Boolean))];
  const uomIds = [...new Set(lineRows.map((l) => l.uom_id).filter(Boolean))];

  let itemById = new Map();
  if (itemIds.length) {
    const { data: itemsData } = await supabase.from('item_master').select('id, item_code, item_name').in('id', itemIds);
    itemById = new Map((itemsData || []).map((i) => [i.id, i]));
  }
  let uomById = new Map();
  if (uomIds.length) {
    const { data: uomsData } = await supabase.from('uom_master').select('id, uom_code').in('id', uomIds);
    uomById = new Map((uomsData || []).map((u) => [u.id, u]));
  }

  const decoratedLines = lineRows.map((l) => ({
    ...l,
    item_code: (itemById.get(l.item_id) && itemById.get(l.item_id).item_code) || null,
    item_name: (itemById.get(l.item_id) && itemById.get(l.item_id).item_name) || null,
    uom_code: (uomById.get(l.uom_id) && uomById.get(l.uom_id).uom_code) || null,
  }));

  /* P1-IPP-WO-AUGMENT: attach generated Work Orders (read-only, additive) so the UI can show one
     next-action, a Work Order link, and prepared/released state. No write, no schema change. */
  let woByLine = new Map();
  let workOrders = [];
  {
    const { data: wos } = await supabase
      .from('wo_headers')
      .select('id, wo_number, status, bom_id, readiness_status, ready_to_start_qty, blocked_qty, source_internal_plan_line_id')
      .eq('wo_kind', 'INTERNAL_PLAN')
      .eq('source_internal_plan_id', id)
      .order('wo_number', { ascending: true });
    workOrders = wos || [];
    woByLine = new Map(workOrders.filter((w) => w.source_internal_plan_line_id).map((w) => [w.source_internal_plan_line_id, w]));
  }
  const decoratedLinesWithWo = decoratedLines.map((l) => {
    const w = woByLine.get(l.id) || null;
    return { ...l, wo_id: w ? w.id : null, wo_number: w ? w.wo_number : null, wo_status: w ? w.status : null };
  });
  return { data: { ...header, lines: decoratedLinesWithWo, work_orders: workOrders }, error: null };
}

export async function cancelPlan(id, userId, reason) {
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .select('id, status')
    .eq('id', id)
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'Internal production plan not found.' } };
  }

  const status = String(header.status || '').toUpperCase();
  if (!CANCELLABLE.includes(status)) {
    return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: `Cannot cancel a plan in status ${status}. Only DRAFT or APPROVED can be cancelled.` } };
  }

  const now = new Date().toISOString();
  const { data: updated, error: uErr } = await supabase
    .from(HEADER)
    .update({
      status: 'CANCELLED',
      cancelled_by: userId || null,
      cancelled_at: now,
      cancel_reason: reason ? String(reason) : null,
      updated_at: now,
    })
    .eq('id', id)
    .select('id, status, cancelled_at, cancel_reason')
    .single();
  if (uErr) return { data: null, error: uErr };

  // Cascade the cancellation to non-cancelled lines (read-model consistency).
  await supabase
    .from(LINES)
    .update({ status: 'CANCELLED', updated_at: now })
    .eq('plan_id', id)
    .neq('status', 'CANCELLED');

  return { data: updated, error: null };
}

// Resolve active recipe + active routing for a set of item ids. Recipe via
// stage_recipe_headers.fg_item_id (active) OR stage_recipe_steps.output_item_id ->
// active header. Routing via the item's active routing_headers (latest version).
// Lookup ONLY — no routing/step writes, no hardcoded process/stage/machine.
async function refreshResolvedRecipeRoutingForPlanLines(header, lineRows) {
  const rows = Array.isArray(lineRows) ? lineRows : [];
  const headerStatus = String(header && header.status ? header.status : '').toUpperCase();

  // Only open/read-heal plans that can still move through approval/WO creation.
  // CANCELLED/CLOSED/WO_GENERATED are read history and must not be mutated here.
  if (!['DRAFT', 'APPROVED'].includes(headerStatus)) {
    return { lines: rows, refreshed_count: 0, error: null };
  }

  const candidates = rows.filter((l) => {
    const lineStatus = String(l && l.status ? l.status : '').toUpperCase();
    return l && l.item_id && (!lineStatus || lineStatus === 'PLANNED') && (!l.resolved_recipe_id || !l.resolved_routing_id);
  });
  if (!candidates.length) return { lines: rows, refreshed_count: 0, error: null };

  const itemIds = [...new Set(candidates.map((l) => l.item_id).filter(Boolean))];
  const { recipeByItem, routingByItem, error } = await resolveRecipeRoutingForItems(itemIds);
  if (error) return { lines: rows, refreshed_count: 0, error };

  const now = new Date().toISOString();
  const refreshedByLineId = new Map();
  let refreshedCount = 0;

  for (const l of candidates) {
    const activeRecipeId = recipeByItem.get(l.item_id) || null;
    const activeRouting = routingByItem.get(l.item_id) || null;
    const activeRoutingId = activeRouting ? activeRouting.id : null;

    const nextRecipeId = activeRecipeId || l.resolved_recipe_id || null;
    const nextRoutingId = activeRoutingId || l.resolved_routing_id || null;

    if (nextRecipeId === (l.resolved_recipe_id || null) && nextRoutingId === (l.resolved_routing_id || null)) {
      continue;
    }

    const { error: uErr } = await supabase
      .from(LINES)
      .update({ resolved_recipe_id: nextRecipeId, resolved_routing_id: nextRoutingId, updated_at: now })
      .eq('id', l.id);
    if (uErr) return { lines: rows, refreshed_count: refreshedCount, error: uErr };

    refreshedByLineId.set(l.id, { ...l, resolved_recipe_id: nextRecipeId, resolved_routing_id: nextRoutingId, updated_at: now });
    refreshedCount += 1;
  }

  if (!refreshedByLineId.size) return { lines: rows, refreshed_count: 0, error: null };
  return {
    lines: rows.map((l) => refreshedByLineId.get(l.id) || l),
    refreshed_count: refreshedCount,
    error: null,
  };
}

async function resolveRecipeRoutingForItems(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  const recipeByItem = new Map();
  const routingByItem = new Map();
  if (!ids.length) return { recipeByItem, routingByItem, error: null };

  // Recipe — direct fg_item_id (active).
  const { data: directRecipes, error: dErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, fg_item_id, status')
    .eq('status', 'active')
    .in('fg_item_id', ids);
  if (dErr) return { recipeByItem, routingByItem, error: dErr };

  // Recipe — via output_item_id step, then keep only active headers.
  const { data: outputSteps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select('id, recipe_id, output_item_id')
    .in('output_item_id', ids);
  if (sErr) return { recipeByItem, routingByItem, error: sErr };

  const outRecipeIds = [...new Set((outputSteps || []).map((s) => s.recipe_id).filter(Boolean))];
  let activeOutputRecipeIds = new Set();
  if (outRecipeIds.length) {
    const { data: outRecipes, error: oErr } = await supabase
      .from('stage_recipe_headers')
      .select('id, status')
      .eq('status', 'active')
      .in('id', outRecipeIds);
    if (oErr) return { recipeByItem, routingByItem, error: oErr };
    activeOutputRecipeIds = new Set((outRecipes || []).map((r) => r.id));
  }

  for (const r of directRecipes || []) {
    if (!recipeByItem.has(r.fg_item_id)) recipeByItem.set(r.fg_item_id, r.id);
  }
  for (const st of outputSteps || []) {
    if (!activeOutputRecipeIds.has(st.recipe_id)) continue;
    if (!recipeByItem.has(st.output_item_id)) recipeByItem.set(st.output_item_id, st.recipe_id);
  }

  // Routing — active routing_headers for the item, latest version. Lookup only.
  const { data: routings, error: rErr } = await supabase
    .from('routing_headers')
    .select('id, item_id, version_number, status')
    .in('item_id', ids);
  if (rErr) return { recipeByItem, routingByItem, error: rErr };
  for (const rt of routings || []) {
    if (String(rt.status || '').toLowerCase() !== 'active') continue;
    const prev = routingByItem.get(rt.item_id);
    const ver = Number(rt.version_number) || 0;
    if (!prev || ver > prev.version) routingByItem.set(rt.item_id, { id: rt.id, version: ver });
  }

  return { recipeByItem, routingByItem, error: null };
}

export async function approvePlan(id, userId) {
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .select('id, status')
    .eq('id', id)
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'Internal production plan not found.' } };
  }

  // Approve is allowed ONLY from DRAFT (blocks APPROVED/WO_GENERATED/CLOSED/CANCELLED).
  const status = String(header.status || '').toUpperCase();
  if (status !== 'DRAFT') {
    return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: `Only DRAFT plans can be approved. This plan is ${status}.` } };
  }

  const { data: lines, error: lErr } = await supabase
    .from(LINES)
    .select('id, line_number, item_id, stage_type, qty, uom_id, status')
    .eq('plan_id', id)
    .order('line_number', { ascending: true });
  if (lErr) return { data: null, error: lErr };
  const lineRows = lines || [];

  const itemIds = [...new Set(lineRows.map((l) => l.item_id).filter(Boolean))];
  let itemById = new Map();
  if (itemIds.length) {
    const { data: itemsData } = await supabase.from('item_master').select('id, item_code, item_name').in('id', itemIds);
    itemById = new Map((itemsData || []).map((i) => [i.id, i]));
  }

  const { recipeByItem, routingByItem, error: resErr } = await resolveRecipeRoutingForItems(itemIds);
  if (resErr) return { data: null, error: resErr };

  const now = new Date().toISOString();
  const unresolved = [];
  let recipeResolvedCount = 0;
  let routingResolvedCount = 0;
  const resultLines = [];

  for (const l of lineRows) {
    const recipeId = recipeByItem.get(l.item_id) || null;
    const routing = routingByItem.get(l.item_id) || null;
    const routingId = routing ? routing.id : null;

    // Stamp resolved_* only when something resolved. Line status stays PLANNED.
    if (recipeId || routingId) {
      const { error: uErr } = await supabase
        .from(LINES)
        .update({ resolved_recipe_id: recipeId, resolved_routing_id: routingId, updated_at: now })
        .eq('id', l.id);
      if (uErr) return { data: null, error: uErr };
    }
    if (recipeId) recipeResolvedCount += 1;
    if (routingId) routingResolvedCount += 1;

    const itm = itemById.get(l.item_id) || {};
    if (!recipeId || !routingId) {
      const reason = (!recipeId && !routingId)
        ? 'RECIPE_AND_ROUTING_MISSING'
        : (!recipeId ? 'RECIPE_MISSING' : 'ROUTING_MISSING');
      unresolved.push({
        line_number: l.line_number,
        item_id: l.item_id,
        item_code: itm.item_code || null,
        item_name: itm.item_name || null,
        reason,
      });
    }

    resultLines.push({
      ...l,
      item_code: itm.item_code || null,
      item_name: itm.item_name || null,
      resolved_recipe_id: recipeId,
      resolved_routing_id: routingId,
    });
  }

  // Partial approve: header -> APPROVED even if some lines are unresolved.
  const { data: updatedHeader, error: uhErr } = await supabase
    .from(HEADER)
    .update({ status: 'APPROVED', updated_by: userId || null, updated_at: now })
    .eq('id', id)
    .select('id, status, updated_at')
    .single();
  if (uhErr) return { data: null, error: uhErr };

  return {
    data: {
      ...updatedHeader,
      recipe_resolved_count: recipeResolvedCount,
      routing_resolved_count: routingResolvedCount,
      unresolved_count: unresolved.length,
      unresolved,
      lines: resultLines,
    },
    error: null,
  };
}

// Resolve routing_type_id for a set of routing_header ids (routing_type_id is NOT NULL on
// wo_headers). Lookup only — no routing/recipe writes.
async function resolveRoutingTypeIds(routingIds) {
  const ids = [...new Set((routingIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return { map, error: null };
  const { data, error } = await supabase
    .from('routing_headers')
    .select('id, routing_type_id')
    .in('id', ids);
  if (error) return { map, error };
  for (const r of data || []) map.set(r.id, r.routing_type_id || null);
  return { map, error: null };
}

// Generate DRAFT Work Orders from an APPROVED plan's eligible lines.
// Eligible line = status PLANNED + resolved_routing_id present + qty > 0. One wo_headers row
// per eligible line (wo_kind 'INTERNAL_PLAN', source_internal_plan_id / source_internal_plan_line_id).
// Idempotent: a line that already has an INTERNAL_PLAN WO is skipped (no duplicate) and its
// line status is healed to WO_CREATED. Draft only — NO release, NO production logging, NO
// stock posting, NO production logging, NO routing/recipe mutation, and nothing from
// the plan-order or scheduling stage flow. P3-IPP-STAGE-WO-EXPLOSION-1 expands
// each IPP STK target into stage-level WOs from the active routing outputs.
export async function generateWorkOrdersFromInternalPlan(id, userId) {
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .select('id, status')
    .eq('id', id)
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'Internal production plan not found.' } };
  }

  const status = String(header.status || '').toUpperCase();

  // Idempotency: if this plan is already generated, heal/expand stage WOs and return linked INTERNAL_PLAN WOs
  // instead of erroring. This keeps repeat clicks/API retries safe.
  if (status === 'WO_GENERATED') {
    const stageHeal = await ensureStageWorkOrdersForInternalPlan(id, userId);
    if (stageHeal.error) return { data: null, error: stageHeal.error };

    const { data: existingWos, error: existingErr } = await supabase
      .from('wo_headers')
      .select('id, wo_number, item_id, routing_id, bom_id, planned_qty, uom_id, status, wo_kind, stage_output_item_id, source_internal_plan_line_id')
      .eq('wo_kind', 'INTERNAL_PLAN')
      .eq('source_internal_plan_id', id)
      .order('wo_number', { ascending: true });

    if (existingErr) return { data: null, error: existingErr };

    const alreadyCreated = [];
    const snapshotSkipped = [];
    for (const w of existingWos || []) {
      const snap = await snapshotAndReadinessForInternalWO(w, userId);
      if (snap.error) return { data: null, error: snap.error };
      if (snap.skipped) snapshotSkipped.push({ wo_number: w.wo_number, reason: snap.reason, detail: snap.detail || null });
      alreadyCreated.push({
        line_id: w.source_internal_plan_line_id,
        item_id: w.item_id,
        wo_id: w.id,
        wo_number: w.wo_number,
        status: w.status,
        planned_qty: w.planned_qty,
        uom_id: w.uom_id,
        snapshot: snap.skipped ? null : {
          bom_id: snap.bom_id,
          step_count: snap.step_count,
          component_count: snap.component_count,
          readiness_status: snap.readiness_status,
          ready_to_start_qty: snap.ready_to_start_qty,
          blocked_qty: snap.blocked_qty,
        },
      });
    }

    return {
      data: {
        plan_id: id,
        header_status: 'WO_GENERATED',
        created_count: 0,
        created: [],
        already_created_count: alreadyCreated.length,
        already_created: alreadyCreated,
        stage_created_count: (stageHeal.data && stageHeal.data.created_count) || 0,
        stage_healed_count: (stageHeal.data && stageHeal.data.healed_count) || 0,
        skipped_count: snapshotSkipped.length,
        skipped: snapshotSkipped,
        message: 'Work Orders already generated for this Internal Production Plan; snapshots/readiness refreshed.',
      },
      error: null,
    };
  }

  if (status !== 'APPROVED') {
    return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: `Only APPROVED plans can generate Work Orders. This plan is ${status}.` } };
  }

  const { data: lines, error: lErr } = await supabase
    .from(LINES)
    .select('id, line_number, item_id, qty, uom_id, status, resolved_routing_id')
    .eq('plan_id', id)
    .order('line_number', { ascending: true });
  if (lErr) return { data: null, error: lErr };
  const lineRows = lines || [];

  // Partition: eligible (PLANNED + routing + qty>0) vs skipped-ineligible.
  const eligible = [];
  const skippedIneligible = [];
  for (const l of lineRows) {
    const st = String(l.status || '').toUpperCase();
    if (st !== 'PLANNED') continue; // WO_CREATED / CANCELLED are not candidates
    if (!l.resolved_routing_id) { skippedIneligible.push({ line_number: l.line_number, item_id: l.item_id, reason: 'NO_ROUTING' }); continue; }
    if (!(num(l.qty) > 0)) { skippedIneligible.push({ line_number: l.line_number, item_id: l.item_id, reason: 'QTY_INVALID' }); continue; }
    eligible.push(l);
  }

  // Idempotency: INTERNAL_PLAN WOs already linked to these lines (skip -> no duplicate).
  const eligibleIds = eligible.map((l) => l.id);
  const existingByLine = new Map();
  if (eligibleIds.length) {
    const { data: existing, error: exErr } = await supabase
      .from('wo_headers')
      .select('id, wo_number, item_id, routing_id, bom_id, planned_qty, uom_id, status, wo_kind, stage_output_item_id, source_internal_plan_line_id')
      .eq('wo_kind', 'INTERNAL_PLAN')
      .in('source_internal_plan_line_id', eligibleIds);
    if (exErr) return { data: null, error: exErr };
    for (const w of existing || []) existingByLine.set(w.source_internal_plan_line_id, w);
  }

  // routing_type_id (NOT NULL on wo_headers) for the routings we will use.
  const { map: routingTypeById, error: rtErr } = await resolveRoutingTypeIds(eligible.map((l) => l.resolved_routing_id));
  if (rtErr) return { data: null, error: rtErr };

  const now = new Date().toISOString();
  const created = [];
  const alreadyCreated = [];
  const woCreatedLineIds = new Set();

  for (const l of eligible) {
    const existing = existingByLine.get(l.id);
    if (existing) {
      // Heal: a prior run inserted the WO but may not have flipped the line; also heal
      // header-only WOs by snapshotting routing/BOM details and readiness.
      await supabase.from(LINES).update({ status: 'WO_CREATED', updated_at: now }).eq('id', l.id).eq('status', 'PLANNED');
      const snap = await snapshotAndReadinessForInternalWO(existing, userId);
      if (snap.error) return { data: null, error: snap.error };
      alreadyCreated.push({
        line_number: l.line_number,
        item_id: l.item_id,
        wo_id: existing.id,
        wo_number: existing.wo_number,
        snapshot: snap.skipped ? null : {
          bom_id: snap.bom_id,
          step_count: snap.step_count,
          component_count: snap.component_count,
          readiness_status: snap.readiness_status,
          ready_to_start_qty: snap.ready_to_start_qty,
          blocked_qty: snap.blocked_qty,
        },
        snapshot_skipped_reason: snap.skipped ? snap.reason : null,
      });
      woCreatedLineIds.add(l.id);
      continue;
    }

    const routingTypeId = routingTypeById.get(l.resolved_routing_id) || null;
    if (!routingTypeId) {
      skippedIneligible.push({ line_number: l.line_number, item_id: l.item_id, reason: 'ROUTING_TYPE_MISSING' });
      continue;
    }

    let woNumber;
    try {
      woNumber = await getNextNumber('WORK_ORDER');
    } catch (e) {
      return { data: null, error: { code: e.code || 'INTERNAL_ERROR', status: 500, message: e.message || 'Work order number series error.' } };
    }
    if (!woNumber) return { data: null, error: { code: 'INTERNAL_ERROR', status: 500, message: 'Failed to generate work order number.' } };

    /* P3I-STAMP: stamp resolver keys at WO creation (mirror stage-WO generation).
       stage_output_item_id = line item; process_type_id from the routing step that produces it
       (else the final step). Lookup only; does not alter readiness/release/partial logic. */
    let stampProcessTypeId = null;
    const stampOutputItemId = l.item_id;
    {
      const { data: rsteps } = await supabase
        .from('routing_steps')
        .select('seq_no, process_type_id, output_item_id')
        .eq('routing_header_id', l.resolved_routing_id)
        .eq('is_active', true)
        .order('seq_no', { ascending: true });
      if (rsteps && rsteps.length) {
        const producing = rsteps.find((s) => s.output_item_id === l.item_id);
        const chosen = producing || rsteps[rsteps.length - 1];
        stampProcessTypeId = chosen ? (chosen.process_type_id || null) : null;
      }
    }

    const { data: wo, error: woErr } = await supabase
      .from('wo_headers')
      .insert({
        wo_number: woNumber,
        item_id: l.item_id,
        routing_id: l.resolved_routing_id,
        routing_type_id: routingTypeId,
        planned_qty: num(l.qty),
        status: 'draft',
        uom_id: l.uom_id || null,
        created_by: userId || null,
        wo_kind: 'INTERNAL_PLAN',
        source_internal_plan_id: id,
        source_internal_plan_line_id: l.id,
        process_type_id: stampProcessTypeId,
        stage_output_item_id: stampOutputItemId,
      })
      .select('id, wo_number')
      .single();
    if (woErr || !wo) {
      return { data: null, error: woErr || { code: 'INTERNAL_ERROR', status: 500, message: 'Failed to create Work Order.' } };
    }

    const snap = await snapshotAndReadinessForInternalWO({
      id: wo.id,
      wo_number: wo.wo_number,
      item_id: l.item_id,
      routing_id: l.resolved_routing_id,
      planned_qty: num(l.qty),
      uom_id: l.uom_id || null,
      status: 'draft',
      wo_kind: 'INTERNAL_PLAN',
      bom_id: null,
    }, userId);
    if (snap.error) return { data: null, error: snap.error };
    if (snap.skipped) {
      skippedIneligible.push({ line_number: l.line_number, item_id: l.item_id, wo_number: wo.wo_number, reason: snap.reason, detail: snap.detail || null });
    }

    const { error: upErr } = await supabase.from(LINES).update({ status: 'WO_CREATED', updated_at: now }).eq('id', l.id);
    if (upErr) return { data: null, error: upErr };

    created.push({
      line_number: l.line_number,
      item_id: l.item_id,
      wo_id: wo.id,
      wo_number: wo.wo_number,
      snapshot: snap.skipped ? null : {
        bom_id: snap.bom_id,
        step_count: snap.step_count,
        component_count: snap.component_count,
        readiness_status: snap.readiness_status,
        ready_to_start_qty: snap.ready_to_start_qty,
        blocked_qty: snap.blocked_qty,
      },
      snapshot_skipped_reason: snap.skipped ? snap.reason : null,
    });
    woCreatedLineIds.add(l.id);
  }

  // P3-IPP-STAGE-WO-EXPLOSION-1: ensure one stage-level INTERNAL_PLAN WO exists per
  // active routing output item (PF/SBBP/.../STK). Existing target STK WOs are reused.
  const stageHeal = await ensureStageWorkOrdersForInternalPlan(id, userId);
  if (stageHeal.error) return { data: null, error: stageHeal.error };

  // Header -> WO_GENERATED only when no eligible PLANNED line remains uncreated.
  const remainingEligiblePlanned = lineRows.filter((l) => {
    if (woCreatedLineIds.has(l.id)) return false;
    return String(l.status || '').toUpperCase() === 'PLANNED' && l.resolved_routing_id && num(l.qty) > 0;
  }).length;

  let headerStatus = status;
  if (remainingEligiblePlanned === 0 && (created.length || alreadyCreated.length)) {
    const { data: updatedHeader, error: uhErr } = await supabase
      .from(HEADER)
      .update({ status: 'WO_GENERATED', updated_by: userId || null, updated_at: now })
      .eq('id', id)
      .eq('status', 'APPROVED')
      .select('status')
      .single();
    if (uhErr) return { data: null, error: uhErr };
    headerStatus = (updatedHeader && updatedHeader.status) || 'WO_GENERATED';
  }

  return {
    data: {
      plan_id: id,
      header_status: headerStatus,
      created_count: created.length,
      created,
      already_created_count: alreadyCreated.length,
      already_created: alreadyCreated,
      stage_created_count: (stageHeal.data && stageHeal.data.created_count) || 0,
      stage_healed_count: (stageHeal.data && stageHeal.data.healed_count) || 0,
      skipped_ineligible_count: skippedIneligible.length,
      skipped_ineligible: skippedIneligible,
    },
    error: null,
  };
}

// P-3G.2 helpers ----------------------------------------------------------------
function round4(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

// Active item-level BOM id for an item (Strategy A). Reuses the canonical bom-by-item resolver
// (version desc) and picks the highest-version active header. Lookup only.
async function activeItemBomId(itemId) {
  const { data, error } = await listBomsForItem(itemId);
  if (error) return { bomId: null, error };
  const active = (data || []).filter((b) => String(b.status || '').toLowerCase() === 'active');
  return { bomId: active.length ? active[0].id : null, error: null };
}



// P3-IPP-STAGE-WO-EXPLOSION-1: for each IPP line target (usually VO_STKxxx), create/heal
// stage-level INTERNAL_PLAN WOs for each active routing output item. This keeps MTS production
// pooled by IPP/STK item and avoids per-customer duplicate production. No stock posting, no
// production logs, no recipe/routing mutation. Existing target WOs are reused.
async function ensureStageWorkOrdersForInternalPlan(planId, userId, options = {}) {
  const shouldSnapshot = options.snapshot !== false;
  const { data: lines, error: lineErr } = await supabase
    .from(LINES)
    .select('id, line_number, item_id, qty, uom_id, status, resolved_routing_id')
    .eq('plan_id', planId)
    .order('line_number', { ascending: true });
  if (lineErr) return { data: null, error: lineErr };

  const created = [];
  const healed = [];
  const skipped = [];
  const now = new Date().toISOString();

  for (const l of lines || []) {
    if (!l.resolved_routing_id || !(num(l.qty) > 0)) {
      skipped.push({ line_number: l.line_number, item_id: l.item_id, reason: 'NO_ROUTING_OR_QTY' });
      continue;
    }

    const routingType = await resolveRoutingTypeIds([l.resolved_routing_id]);
    if (routingType.error) return { data: null, error: routingType.error };
    const routingTypeId = routingType.map.get(l.resolved_routing_id) || null;
    if (!routingTypeId) {
      skipped.push({ line_number: l.line_number, item_id: l.item_id, reason: 'ROUTING_TYPE_MISSING' });
      continue;
    }

    const { data: steps, error: stepErr } = await supabase
      .from('routing_steps')
      .select('id, seq_no, step_name, process_type_id, output_item_id, is_active')
      .eq('routing_header_id', l.resolved_routing_id)
      .eq('is_active', true)
      .not('output_item_id', 'is', null)
      .order('seq_no', { ascending: true });
    if (stepErr) return { data: null, error: stepErr };

    const stageOutputs = [];
    const seen = new Set();
    for (const s of steps || []) {
      if (!s.output_item_id || seen.has(s.output_item_id)) continue;
      seen.add(s.output_item_id);
      stageOutputs.push(s);
    }
    if (!stageOutputs.length) {
      skipped.push({ line_number: l.line_number, item_id: l.item_id, reason: 'NO_ROUTING_OUTPUTS' });
      continue;
    }

    const outputIds = stageOutputs.map((s) => s.output_item_id);
    const { data: existingRows, error: exErr } = await supabase
      .from('wo_headers')
      .select('id, wo_number, item_id, routing_id, routing_type_id, process_type_id, bom_id, planned_qty, uom_id, status, wo_kind, stage_output_item_id, source_internal_plan_line_id')
      .eq('wo_kind', 'INTERNAL_PLAN')
      .eq('source_internal_plan_id', planId)
      .in('item_id', outputIds);
    if (exErr) return { data: null, error: exErr };
    const existingByItem = new Map((existingRows || []).map((w) => [w.item_id, w]));

    for (const step of stageOutputs) {
      let wo = existingByItem.get(step.output_item_id) || null;
      if (!wo) {
        let woNumber;
        try {
          woNumber = await getNextNumber('WORK_ORDER');
        } catch (e) {
          return { data: null, error: { code: e.code || 'INTERNAL_ERROR', status: 500, message: e.message || 'Work order number series error.' } };
        }
        if (!woNumber) return { data: null, error: { code: 'INTERNAL_ERROR', status: 500, message: 'Failed to generate work order number.' } };

        const isTargetLineItem = step.output_item_id === l.item_id;
        const { data: inserted, error: insErr } = await supabase
          .from('wo_headers')
          .insert({
            wo_number: woNumber,
            item_id: step.output_item_id,
            routing_id: l.resolved_routing_id,
            routing_type_id: routingTypeId,
            planned_qty: num(l.qty),
            status: 'draft',
            uom_id: l.uom_id || null,
            created_by: userId || null,
            wo_kind: 'INTERNAL_PLAN',
            source_internal_plan_id: planId,
            source_internal_plan_line_id: isTargetLineItem ? l.id : null,
            process_type_id: step.process_type_id || null,
            stage_output_item_id: step.output_item_id,
          })
          .select('id, wo_number, item_id, routing_id, bom_id, planned_qty, uom_id, status, wo_kind, stage_output_item_id, source_internal_plan_line_id')
          .single();
        if (insErr || !inserted) return { data: null, error: insErr || { code: 'INTERNAL_ERROR', status: 500, message: 'Failed to create stage Work Order.' } };
        wo = inserted;
        created.push({ line_number: l.line_number, item_id: step.output_item_id, wo_number: wo.wo_number });
      } else {
        // Heal old header-only/target WOs to carry the stage output/process stamp.
        // P3N-BATCH-READINESS: skip the UPDATE when the WO already carries the correct stamp
        // (avoids ~1 redundant write per stage WO on every Release click).
        const alreadyStamped =
          wo.stage_output_item_id === step.output_item_id &&
          wo.routing_id &&
          wo.routing_type_id === routingTypeId &&
          (wo.process_type_id || null) === (step.process_type_id || null) &&
          num(wo.planned_qty) === num(l.qty);
        if (!alreadyStamped) {
          await supabase
            .from('wo_headers')
            .update({
              routing_id: wo.routing_id || l.resolved_routing_id,
              routing_type_id: routingTypeId,
              process_type_id: step.process_type_id || null,
              stage_output_item_id: step.output_item_id,
              planned_qty: num(l.qty),
              uom_id: wo.uom_id || l.uom_id || null,
              updated_by: userId || null,
              updated_at: now,
            })
            .eq('id', wo.id)
            .eq('wo_kind', 'INTERNAL_PLAN')
            .eq('status', 'draft');
        }
        wo.stage_output_item_id = step.output_item_id;
        wo.routing_id = wo.routing_id || l.resolved_routing_id;
        wo.planned_qty = num(l.qty);
        healed.push({ line_number: l.line_number, item_id: step.output_item_id, wo_number: wo.wo_number });
      }

      if (shouldSnapshot) {
        const snap = await snapshotAndReadinessForInternalWO({ ...wo, routing_id: l.resolved_routing_id, planned_qty: num(l.qty), stage_output_item_id: step.output_item_id }, userId);
        if (snap.error) return { data: null, error: snap.error };
        if (snap.skipped) skipped.push({ line_number: l.line_number, item_id: step.output_item_id, wo_number: wo.wo_number, reason: snap.reason, detail: snap.detail || null });
      }
    }
  }

  return { data: { created_count: created.length, created, healed_count: healed.length, healed, skipped_count: skipped.length, skipped }, error: null };
}

// P3-IPP-WO-SNAPSHOT-1: one canonical snapshot/ready helper for INTERNAL_PLAN WOs.
// It heals existing header-only WOs by stamping the active BOM, creating routing step
// snapshots, creating BOM component snapshots, and recomputing readiness. No release,
// no inventory posting, no production logs, and no recipe/routing mutation.
async function snapshotAndReadinessForInternalWO(wo, userId) {
  const planned = num(wo && wo.planned_qty);
  if (!wo || !wo.id) return { error: { code: 'VALIDATION_ERROR', status: 400, message: 'WO row is required.' } };
  if (String(wo.wo_kind || '').toUpperCase() !== 'INTERNAL_PLAN') {
    return { skipped: true, reason: 'NOT_INTERNAL_PLAN' };
  }
  if (String(wo.status || '').toLowerCase() !== 'draft') {
    return { skipped: true, reason: 'NOT_DRAFT' };
  }
  if (!wo.routing_id) return { skipped: true, reason: 'NO_ROUTING' };
  if (!(planned > 0)) return { skipped: true, reason: 'QTY_INVALID' };

  let bomId = wo.bom_id || null;
  if (!bomId) {
    const bom = await activeItemBomId(wo.item_id);
    if (bom.error) return { error: bom.error };
    bomId = bom.bomId || null;
  }
  if (!bomId) return { skipped: true, reason: 'NO_ACTIVE_BOM' };

  const targetOutputItemId = wo.stage_output_item_id || wo.item_id || null;
  const stepRes = await snapshotStepLinesForWO(wo.id, wo.routing_id, planned, userId, targetOutputItemId);
  if (stepRes.error) return { error: stepRes.error };
  if (stepRes.noSteps) return { skipped: true, reason: 'NO_ROUTING_STEPS' };

  const { error: bomSetErr } = await supabase
    .from('wo_headers')
    .update({ bom_id: bomId })
    .eq('id', wo.id)
    .eq('wo_kind', 'INTERNAL_PLAN')
    .eq('status', 'draft');
  if (bomSetErr) return { error: bomSetErr };

  let compInserted = 0;
  try {
    const compRes = await snapshotBomComponentsForWO(wo.id, bomId, planned, userId);
    if (compRes.error) return { error: compRes.error };
    compInserted = (compRes.data && compRes.data.inserted) || 0;
  } catch (e) {
    return { skipped: true, reason: 'COMPONENT_SNAPSHOT_FAILED', detail: (e && e.message) || String(e) };
  }

  const r = await computeReadinessForWO(wo.id, planned);
  if (r.error) return { error: r.error };
  const { error: rUpdErr } = await supabase
    .from('wo_headers')
    .update({
      bom_id: bomId,
      readiness_status: r.readiness_status,
      ready_to_start_qty: r.ready_to_start_qty,
      blocked_qty: r.blocked_qty,
    })
    .eq('id', wo.id)
    .eq('wo_kind', 'INTERNAL_PLAN');
  if (rUpdErr) return { error: rUpdErr };

  return {
    skipped: false,
    bom_id: bomId,
    step_count: stepRes.count,
    component_count: compInserted,
    readiness_status: r.readiness_status,
    ready_to_start_qty: r.ready_to_start_qty,
    blocked_qty: r.blocked_qty,
    uom_unresolved: Boolean(r.uom_unresolved),
  };
}

// Snapshot wo_step_lines from a WO's active routing steps. Mirrors the release-time step
// snapshot exactly (delete + insert, step_status 'not_started'). No status flip, no stock
// posting, no logs.
async function snapshotStepLinesForWO(woId, routingId, plannedQty, userId, targetOutputItemId = null) {
  const { data: steps, error: stepsErr } = await supabase
    .from('routing_steps')
    .select('id, seq_no, step_name, output_item_id, is_wo_driven, wip_produced, qc_required, machine_required, die_required, labour_required')
    .eq('routing_header_id', routingId)
    .eq('is_active', true)
    .order('seq_no', { ascending: true });
  if (stepsErr) return { count: 0, error: stepsErr };
  if (!steps || steps.length === 0) return { count: 0, error: null, noSteps: true };

  const stepRows = targetOutputItemId
    ? steps.filter((s) => s.output_item_id === targetOutputItemId)
    : steps;
  if (!stepRows.length) return { count: 0, error: null, noSteps: true };

  const { error: delErr } = await supabase.from('wo_step_lines').delete().eq('wo_id', woId);
  if (delErr) return { count: 0, error: delErr };

  const rows = stepRows.map((s) => ({
    wo_id:            woId,
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
  const { error: insErr } = await supabase.from('wo_step_lines').insert(rows);
  if (insErr) return { count: 0, error: insErr };
  return { count: rows.length, error: null };
}

// INTERNAL_PLAN readiness for a WO from its snapshotted wo_component_lines vs current stock
// balances. ready_to_start_qty = plannedQty * min(available/required) across component lines
// (no components -> fully ready). Cross-UOM lines use active uom_conversions; an unresolved
// conversion counts as zero available (conservative — never over-credits). Read-only against
// balances; writes nothing here (caller writes only the readiness fields). No status flip.
// P3N-BATCH-READINESS: pure readiness math (no I/O), shared by computeReadinessForWO (single
// WO) and the batched release path so both produce IDENTICAL results. P3L uom-leniency lives
// in convert(). Also returns `shortages` (component, required, available, uom_unresolved) for
// clear skip-reason reporting on Release.
function readinessFromData(lines, balByItem, uomCodeById, convMap, plannedQty) {
  const planned = num(plannedQty);
  if (!lines.length) {
    return {
      readiness_status: planned > 0 ? 'READY' : 'BLOCKED',
      ready_to_start_qty: planned > 0 ? round4(planned) : 0,
      blocked_qty: planned > 0 ? 0 : round4(planned),
      component_count: 0, uom_unresolved: false, shortages: [],
    };
  }
  function convert(qty, fromU, toU, itemId) {
    if (fromU === toU) return qty;
    if (!fromU || !toU) return qty;
    const fc = uomCodeById.get(fromU);
    const tc = uomCodeById.get(toU);
    if (fc && tc && fc === tc) return qty;
    const specific = convMap.get(String(fromU) + '|' + String(toU) + '|' + String(itemId));
    if (specific != null && Number.isFinite(specific)) return qty * specific;
    const generic = convMap.get(String(fromU) + '|' + String(toU) + '|');
    if (generic != null && Number.isFinite(generic)) return qty * generic;
    return null;
  }
  let woRatio = 1;
  let unresolved = false;
  const shortages = [];
  for (const l of lines) {
    const req = num(l.required_qty);
    let avail = 0;
    let lineUnresolved = false;
    for (const b of balByItem.get(l.component_item_id) || []) {
      const c = convert(num(b.quantity), b.uom_id, l.uom_id, l.component_item_id);
      if (c == null) { unresolved = true; lineUnresolved = true; continue; }
      avail += c;
    }
    const ratio = req > 0 ? Math.min(avail / req, 1) : 1;
    if (ratio < woRatio) woRatio = ratio;
    if (req > 0 && avail < req) shortages.push({ component_item_id: l.component_item_id, required: req, available: round4(avail), uom_unresolved: lineUnresolved });
  }
  const ready = planned > 0 ? round4(planned * woRatio) : 0;
  const blocked = planned > 0 ? round4(Math.max(0, planned - ready)) : 0;
  const status = planned <= 0 ? 'BLOCKED' : (ready >= planned ? 'READY' : (ready > 0 ? 'PARTIAL' : 'BLOCKED'));
  return { readiness_status: status, ready_to_start_qty: ready, blocked_qty: blocked, component_count: lines.length, uom_unresolved: unresolved, shortages };
}

// Batched UOM helpers: build uomCodeById + convMap for a set of component lines and balances
// in two queries (shared across many WOs). Mirrors computeReadinessForWO's per-WO fetch.
async function loadUomMaps(lines, balances) {
  const uomCodeById = new Map();
  const uomIds = [...new Set([
    ...lines.map((l) => l.uom_id),
    ...(balances || []).map((b) => b.uom_id),
  ].filter(Boolean))];
  if (uomIds.length) {
    const { data: uoms, error: uomErr } = await supabase.from('uom_master').select('id, uom_code').in('id', uomIds);
    if (uomErr) return { error: uomErr };
    for (const u of uoms || []) uomCodeById.set(u.id, String(u.uom_code || '').trim().toUpperCase());
  }
  const balByItem = new Map();
  for (const b of balances || []) {
    if (!balByItem.has(b.item_id)) balByItem.set(b.item_id, []);
    balByItem.get(b.item_id).push(b);
  }
  const fromUoms = new Set();
  for (const l of lines) {
    for (const b of balByItem.get(l.component_item_id) || []) {
      if (b.uom_id && l.uom_id && b.uom_id !== l.uom_id) fromUoms.add(b.uom_id);
    }
  }
  const convMap = new Map();
  if (fromUoms.size) {
    const { data: convs, error: convErr } = await supabase
      .from('uom_conversions')
      .select('from_uom_id, to_uom_id, conversion_factor, item_id, is_active')
      .in('from_uom_id', [...fromUoms])
      .eq('is_active', true);
    if (convErr) return { error: convErr };
    for (const c of convs || []) convMap.set(String(c.from_uom_id) + '|' + String(c.to_uom_id) + '|' + String(c.item_id || ''), Number(c.conversion_factor));
  }
  return { uomCodeById, balByItem, convMap, error: null };
}

// P3O-WAREHOUSE-READINESS: readiness/release MUST check component stock at the SAME warehouse
// the production-log RPC (fn_post_production_log) issues from, else readiness says READY while
// the log fails "negative stock". The RPC uses: issue wh = COALESCE(wo.warehouse_issue_id,
// warehouse_master WHERE warehouse_code='RM-STORE'). We mirror that exactly here.
const RM_STORE_CODE = 'RM-STORE';
let _rmStoreIdCache; // undefined=unresolved, null=not found, string=id
async function resolveRmStoreWarehouseId() {
  if (_rmStoreIdCache !== undefined) return _rmStoreIdCache;
  const { data, error } = await supabase.from('warehouse_master').select('id').eq('warehouse_code', RM_STORE_CODE).limit(1);
  _rmStoreIdCache = (error || !data || !data.length) ? null : data[0].id;
  return _rmStoreIdCache;
}
// Issue warehouse for one WO = header override else RM-STORE fallback (exact RPC COALESCE).
function issueWarehouseForWo(wo, rmStoreId) {
  return (wo && wo.warehouse_issue_id) || rmStoreId || null;
}
// Narrow a balByItem map (item -> balance rows across warehouses) to a single warehouse, so
// availability is computed only from stock the RPC can actually consume. Unresolved wh -> empty
// (0 available -> BLOCKED), matching the RPC's "warehouse could not be resolved" hard guard.
function balForWarehouse(balByItem, warehouseId) {
  const out = new Map();
  if (!warehouseId) return out;
  for (const [item, rows] of balByItem.entries()) {
    const f = rows.filter((r) => r.warehouse_id === warehouseId);
    if (f.length) out.set(item, f);
  }
  return out;
}

async function computeReadinessForWO(woId, plannedQty, issueWarehouseId) {
  const { data: comps, error: compErr } = await supabase
    .from('wo_component_lines')
    .select('component_item_id, required_qty, uom_id')
    .eq('wo_id', woId)
    .eq('is_active', true);
  if (compErr) return { error: compErr };
  const lines = comps || [];
  const planned = num(plannedQty);

  if (!lines.length) {
    return {
      readiness_status: planned > 0 ? 'READY' : 'BLOCKED',
      ready_to_start_qty: planned > 0 ? round4(planned) : 0,
      blocked_qty: planned > 0 ? 0 : round4(planned),
      component_count: 0,
      uom_unresolved: false,
      error: null,
    };
  }

  const itemIds = [...new Set(lines.map((l) => l.component_item_id).filter(Boolean))];
  const { data: balances, error: balErr } = itemIds.length
    ? await supabase.from('inventory_balance').select('item_id, quantity, uom_id, warehouse_id').in('item_id', itemIds)
    : { data: [], error: null };
  if (balErr) return { error: balErr };

  // P3O-WAREHOUSE-READINESS: resolve the issue warehouse the RPC would consume from, and check
  // availability ONLY there. If a caller did not pass it, derive from the WO header (+ RM-STORE).
  let issueWh = issueWarehouseId;
  if (issueWh === undefined) {
    const { data: woRow } = await supabase.from('wo_headers').select('warehouse_issue_id').eq('id', woId).limit(1);
    issueWh = issueWarehouseForWo(woRow && woRow[0], await resolveRmStoreWarehouseId());
  }

  const maps = await loadUomMaps(lines, balances);
  if (maps.error) return { error: maps.error };
  const balWh = balForWarehouse(maps.balByItem, issueWh);
  return { ...readinessFromData(lines, balWh, maps.uomCodeById, maps.convMap, planned), error: null };
}

// Prepare draft INTERNAL_PLAN Work Orders of a plan for release review: set bom_id from the
// active item-level BOM (Strategy A), snapshot wo_step_lines + wo_component_lines, and compute
// readiness. The WO stays 'draft'. NO release, NO stock posting, NO production logs, NO
// scheduling, and nothing from the plan-order stage flow. Idempotent: re-prepare deletes and
// re-snapshots. Positive wo_kind match so stage Work Orders are never touched.
export async function prepareWorkOrdersForInternalPlan(planId, userId) {
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .select('id, status')
    .eq('id', planId)
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'Internal production plan not found.' } };
  }

  // P3-IPP-STAGE-WO-RELEASE-TRIGGER-1: release can be clicked after an IPP is already
  // in WO_GENERATED state, so make the stage-WO explosion/heal idempotently here too.
  // This avoids requiring users to re-run Generate Work Orders or manually repair DB rows.
  const stageHeal = await ensureStageWorkOrdersForInternalPlan(planId, userId);
  if (stageHeal.error) return { data: null, error: stageHeal.error };

  const { data: wos, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, item_id, routing_id, planned_qty, status, wo_kind, bom_id, stage_output_item_id')
    .eq('source_internal_plan_id', planId)
    .eq('wo_kind', 'INTERNAL_PLAN');
  if (woErr) return { data: null, error: woErr };
  const woRows = wos || [];

  const prepared = [];
  const skipped = [];

  for (const wo of woRows) {
    // Defensive guards: only draft INTERNAL_PLAN WOs; never a stage Work Order.
    if (String(wo.wo_kind || '').toUpperCase() !== 'INTERNAL_PLAN') { skipped.push({ wo_number: wo.wo_number, reason: 'NOT_INTERNAL_PLAN' }); continue; }
    if (String(wo.status || '').toLowerCase() !== 'draft') { skipped.push({ wo_number: wo.wo_number, reason: 'NOT_DRAFT' }); continue; }

    const planned = num(wo.planned_qty);

    // Resolve active item-level BOM (Strategy A).
    const { bomId, error: bomErr } = await activeItemBomId(wo.item_id);
    if (bomErr) return { data: null, error: bomErr };
    if (!bomId) { skipped.push({ wo_number: wo.wo_number, reason: 'NO_ACTIVE_BOM' }); continue; }

    // Snapshot steps from active routing steps.
    const targetOutputItemId = wo.stage_output_item_id || wo.item_id || null;
  const stepRes = await snapshotStepLinesForWO(wo.id, wo.routing_id, planned, userId, targetOutputItemId);
    if (stepRes.error) return { data: null, error: stepRes.error };
    if (stepRes.noSteps) { skipped.push({ wo_number: wo.wo_number, reason: 'NO_ROUTING_STEPS' }); continue; }

    // Set bom_id on the WO (INTERNAL_PLAN + draft scoped).
    const { error: bomSetErr } = await supabase
      .from('wo_headers')
      .update({ bom_id: bomId })
      .eq('id', wo.id)
      .eq('wo_kind', 'INTERNAL_PLAN')
      .eq('status', 'draft');
    if (bomSetErr) return { data: null, error: bomSetErr };

    // Snapshot components from the BOM (reuses the shared release-time component snapshot).
    let compInserted = 0;
    try {
      const compRes = await snapshotBomComponentsForWO(wo.id, bomId, planned, userId);
      if (compRes.error) return { data: null, error: compRes.error };
      compInserted = (compRes.data && compRes.data.inserted) || 0;
    } catch (e) {
      skipped.push({ wo_number: wo.wo_number, reason: 'COMPONENT_SNAPSHOT_FAILED', detail: (e && e.message) || String(e) });
      continue;
    }

    // Compute readiness and write ONLY the readiness fields.
    const r = await computeReadinessForWO(wo.id, planned);
    if (r.error) return { data: null, error: r.error };
    const { error: rUpdErr } = await supabase
      .from('wo_headers')
      .update({ readiness_status: r.readiness_status, ready_to_start_qty: r.ready_to_start_qty, blocked_qty: r.blocked_qty })
      .eq('id', wo.id)
      .eq('wo_kind', 'INTERNAL_PLAN');
    if (rUpdErr) return { data: null, error: rUpdErr };

    prepared.push({
      wo_number: wo.wo_number,
      bom_id: bomId,
      step_count: stepRes.count,
      component_count: compInserted,
      readiness_status: r.readiness_status,
      ready_to_start_qty: r.ready_to_start_qty,
      blocked_qty: r.blocked_qty,
      uom_unresolved: Boolean(r.uom_unresolved),
    });
  }

  return {
    data: {
      plan_id: planId,
      prepared_count: prepared.length,
      prepared,
      skipped_count: skipped.length,
      skipped,
    },
    error: null,
  };
}

// P-3G.4: controlled release of a plan's prepared draft INTERNAL_PLAN Work Orders to the shop
// floor. Per WO: re-snapshot steps + components (idempotent, shared helpers), RECOMPUTE readiness
// against current stock, persist the fresh readiness, then flip draft -> released ONLY when the
// fresh result is READY/PARTIAL with ready_to_start_qty > 0. NO stock posting, NO production logs,
// NO scheduling/RPC, and nothing from the plan-order stage flow. Does NOT go through the Work
// Order screen release (that path intentionally rejects INTERNAL_PLAN); the snapshot/flip is done
// here. Positive wo_kind match so stage Work Orders are never touched. Idempotent: re-run skips
// non-draft WOs.
export async function releasePreparedWorkOrdersForInternalPlan(planId, userId) {
  const { data: header, error: hErr } = await supabase
    .from(HEADER)
    .select('id, status')
    .eq('id', planId)
    .single();
  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'Internal production plan not found.' } };
  }

  // P3-IPP-STAGE-WO-RELEASE-TRIGGER-2: release can be clicked after the plan is
  // already WO_GENERATED, so heal/create upstream stage WOs here before selecting
  // draft WOs to release. Idempotent, backend-only, no stock posting/logs/schema.
  const stageHeal = await ensureStageWorkOrdersForInternalPlan(planId, userId, { snapshot: false });
  if (stageHeal.error) return { data: null, error: stageHeal.error };

  const { data: wos, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, item_id, routing_id, planned_qty, status, wo_kind, bom_id, stage_output_item_id, warehouse_issue_id')
    .eq('source_internal_plan_id', planId)
    .eq('wo_kind', 'INTERNAL_PLAN');
  if (woErr) return { data: null, error: woErr };
  const woRows = wos || [];

  // P3N-BATCH-READINESS: classify draft candidates, then compute readiness for ALL of them with
  // a handful of BATCHED queries (components, inventory, uom, conversions — once, not per WO)
  // instead of ~4 queries per WO. Only the cheap per-WO readiness UPDATE + draft->released flip
  // run per WO (bounded-parallel). WOs with no snapshotted components fall back to the full
  // per-WO snapshot path (rare; first release). Same gates/flips/scope; nothing deleted.
  const released = [];
  const skipped = [];
  const RELEASE_CONCURRENCY = 8;

  // 1) split: draft -> release candidates; released -> recheck/heal against issue-warehouse stock
  //    (downgrade stored readiness if stock gone) WITHOUT un-releasing; completed/cancelled -> skip.
  const candidates = [];
  const recheckWos = [];
  for (const wo of woRows) {
    if (String(wo.wo_kind || '').toUpperCase() !== 'INTERNAL_PLAN') { skipped.push({ wo_number: wo.wo_number, reason: 'NOT_INTERNAL_PLAN' }); continue; }
    const st = String(wo.status || '').toLowerCase();
    if (st === 'draft') { candidates.push(wo); continue; }
    if (st === 'released') { recheckWos.push(wo); continue; }
    skipped.push({ wo_number: wo.wo_number, reason: 'NOT_DRAFT', status: wo.status });
  }

  // 2) BATCH: all active component lines for ALL candidate + recheck WOs (one query).
  const allWoIds = [...candidates, ...recheckWos].map((w) => w.id);
  const compByWo = new Map();
  if (allWoIds.length) {
    const { data: comps, error: cErr } = await supabase
      .from('wo_component_lines')
      .select('wo_id, component_item_id, required_qty, uom_id')
      .in('wo_id', allWoIds)
      .eq('is_active', true);
    if (cErr) return { data: null, error: cErr };
    for (const c of comps || []) { if (!compByWo.has(c.wo_id)) compByWo.set(c.wo_id, []); compByWo.get(c.wo_id).push(c); }
  }

  // 3) already-snapshotted (component lines + bom_id) -> batched readiness; rest -> full snapshot.
  const batchWos = candidates.filter((w) => w.bom_id && compByWo.has(w.id));
  const snapshotWos = candidates.filter((w) => !(w.bom_id && compByWo.has(w.id)));
  const recheckBatch = recheckWos.filter((w) => w.bom_id && compByWo.has(w.id));

  // 4) Build shared inventory + uom maps ONCE for all batched + recheck WOs (2-3 queries total).
  const allLines = [];
  for (const w of batchWos) for (const l of (compByWo.get(w.id) || [])) allLines.push(l);
  for (const w of recheckBatch) for (const l of (compByWo.get(w.id) || [])) allLines.push(l);
  const allItemIds = [...new Set(allLines.map((l) => l.component_item_id).filter(Boolean))];
  const { data: balances, error: balErr } = allItemIds.length
    ? await supabase.from('inventory_balance').select('item_id, quantity, uom_id, warehouse_id').in('item_id', allItemIds)
    : { data: [], error: null };
  if (balErr) return { data: null, error: balErr };
  const maps = await loadUomMaps(allLines, balances);
  if (maps.error) return { data: null, error: maps.error };
  // P3O-WAREHOUSE-READINESS: resolve RM-STORE once; each WO's availability is checked at its own
  // issue warehouse (wo.warehouse_issue_id else RM-STORE) — exactly where the RPC consumes.
  const rmStoreId = await resolveRmStoreWarehouseId();

  // persist readiness + gate + flip for one WO (reads already done; only writes here).
  async function applyOne(wo, snap) {
    const { error: upErr } = await supabase
      .from('wo_headers')
      .update({ readiness_status: snap.readiness_status, ready_to_start_qty: snap.ready_to_start_qty, blocked_qty: snap.blocked_qty })
      .eq('id', wo.id)
      .eq('wo_kind', 'INTERNAL_PLAN');
    if (upErr) return { error: upErr };

    const fresh = String(snap.readiness_status || '').toUpperCase();
    if (fresh !== 'READY' && fresh !== 'PARTIAL') return { skip: { wo_number: wo.wo_number, reason: 'FRESH_READINESS_BLOCKED', readiness_status: snap.readiness_status, blocked_qty: snap.blocked_qty, uom_unresolved: !!snap.uom_unresolved, shortages: snap.shortages || [] } };
    if (num(snap.ready_to_start_qty) <= 0) return { skip: { wo_number: wo.wo_number, reason: 'NO_READY_QTY', ready_to_start_qty: snap.ready_to_start_qty, shortages: snap.shortages || [] } };

    try {
      const { error: relErr } = await supabase
        .from('wo_headers')
        .update({ status: 'released', released_by: userId, released_at: new Date().toISOString() })
        .eq('id', wo.id)
        .eq('wo_kind', 'INTERNAL_PLAN')
        .eq('status', 'draft');
      if (relErr) return { skip: { wo_number: wo.wo_number, reason: 'RELEASE_FAILED', detail: relErr.message || String(relErr) } };
    } catch (e) {
      return { skip: { wo_number: wo.wo_number, reason: 'RELEASE_FAILED', detail: (e && e.message) || String(e) } };
    }
    return { released: { wo_number: wo.wo_number, readiness_status: snap.readiness_status, ready_to_start_qty: snap.ready_to_start_qty, blocked_qty: snap.blocked_qty } };
  }

  const collect = (results) => {
    for (const r of results) {
      if (r.error) return r.error;
      if (r.released) released.push(r.released);
      else if (r.skip) skipped.push(r.skip);
    }
    return null;
  };

  // 5a) batched WOs: readiness computed IN-MEMORY from the shared maps, but availability is
  // narrowed to each WO's issue warehouse so READY matches what the production-log RPC can consume.
  const batchTasks = batchWos.map((wo) => ({ wo, snap: readinessFromData(compByWo.get(wo.id) || [], balForWarehouse(maps.balByItem, issueWarehouseForWo(wo, rmStoreId)), maps.uomCodeById, maps.convMap, num(wo.planned_qty)) }));
  for (let i = 0; i < batchTasks.length; i += RELEASE_CONCURRENCY) {
    const chunk = batchTasks.slice(i, i + RELEASE_CONCURRENCY);
    const err = collect(await Promise.all(chunk.map((t) => applyOne(t.wo, t.snap))));
    if (err) return { data: null, error: err };
  }

  // 5b) not-yet-snapshotted WOs: full per-WO snapshot (heals), then apply (rare; parallel chunks).
  for (let i = 0; i < snapshotWos.length; i += RELEASE_CONCURRENCY) {
    const chunk = snapshotWos.slice(i, i + RELEASE_CONCURRENCY);
    const err = collect(await Promise.all(chunk.map(async (wo) => {
      const snap = await snapshotAndReadinessForInternalWO(wo, userId);
      if (snap.error) return { error: snap.error };
      if (snap.skipped) return { skip: { wo_number: wo.wo_number, reason: snap.reason, detail: snap.detail || null } };
      return applyOne(wo, snap);
    })));
    if (err) return { data: null, error: err };
  }

  // 5c) P3P-RELEASED-WO-HEAL: re-evaluate already-RELEASED WOs against the SAME issue-warehouse
  // stock. If the WO is no longer satisfiable there, downgrade its STORED readiness (BLOCKED +
  // ready 0) so Production Work stops showing it as loggable. Status is NOT changed (no
  // un-release, no delete); any qty already produced keeps its produced-based progress in the
  // read model, and the production-log RPC remains the hard backstop.
  const rechecked = [];
  async function healOne(wo) {
    const snap = readinessFromData(compByWo.get(wo.id) || [], balForWarehouse(maps.balByItem, issueWarehouseForWo(wo, rmStoreId)), maps.uomCodeById, maps.convMap, num(wo.planned_qty));
    const { error: upErr } = await supabase
      .from('wo_headers')
      .update({ readiness_status: snap.readiness_status, ready_to_start_qty: snap.ready_to_start_qty, blocked_qty: snap.blocked_qty })
      .eq('id', wo.id)
      .eq('wo_kind', 'INTERNAL_PLAN')
      .eq('status', 'released');
    if (upErr) return { error: upErr };
    return { healed: { wo_number: wo.wo_number, readiness_status: snap.readiness_status, ready_to_start_qty: snap.ready_to_start_qty, blocked_qty: snap.blocked_qty, uom_unresolved: !!snap.uom_unresolved, shortages: snap.shortages || [] } };
  }
  for (let i = 0; i < recheckBatch.length; i += RELEASE_CONCURRENCY) {
    const chunk = recheckBatch.slice(i, i + RELEASE_CONCURRENCY);
    const results = await Promise.all(chunk.map((wo) => healOne(wo)));
    for (const r of results) { if (r.error) return { data: null, error: r.error }; if (r.healed) rechecked.push(r.healed); }
  }

  return {
    data: {
      plan_id: planId,
      released_count: released.length,
      released,
      skipped_count: skipped.length,
      skipped,
      rechecked_count: rechecked.length,
      rechecked,
    },
    error: null,
  };
}

/* P3K-COMPLETION-CASCADE — after a stage WO completes and posts its output stock, recompute
 * readiness for the whole INTERNAL_PLAN and release the now-ready downstream WOs. Reuses the
 * exact manual "Release to Production Work" logic (releasePreparedWorkOrdersForInternalPlan),
 * so a completed upstream stage immediately frees its dependents. Takes the production-log id,
 * resolves its WO + plan, and no-ops (skipped, not error) for non-INTERNAL_PLAN logs so the
 * PPO/MTO flow is untouched. NO inventory posting, NO production logs, NO schema. Idempotent:
 * already-released WOs are skipped; still-blocked WOs stay draft. */
export async function recomputeAndReleaseAfterWoCompletion(logId, userId) {
  if (!logId) return { data: { skipped: true, reason: 'NO_LOG_ID' }, error: null };

  const { data: log, error: logErr } = await supabase
    .from('production_logs')
    .select('wo_id')
    .eq('id', logId)
    .single();
  if (logErr || !log || !log.wo_id) return { data: { skipped: true, reason: 'LOG_OR_WO_NOT_FOUND' }, error: null };

  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_kind, source_internal_plan_id')
    .eq('id', log.wo_id)
    .single();
  if (woErr || !wo) return { data: { skipped: true, reason: 'WO_NOT_FOUND' }, error: null };

  if (String(wo.wo_kind || '').toUpperCase() !== 'INTERNAL_PLAN' || !wo.source_internal_plan_id) {
    return { data: { skipped: true, reason: 'NOT_INTERNAL_PLAN' }, error: null };
  }

  // Cascade: same recompute-then-release as the manual Release action, scoped to this plan.
  const rel = await releasePreparedWorkOrdersForInternalPlan(wo.source_internal_plan_id, userId);
  if (rel.error) return { data: null, error: rel.error };

  return { data: { plan_id: wo.source_internal_plan_id, trigger_wo_id: wo.id, ...rel.data }, error: null };
}
