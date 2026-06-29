import { supabase } from '../config/supabase.js';
import { checkTentativePlan } from './materialAvailabilityService.js'; // P-2A: Engine B as feasibility source

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < list.length) {
      const idx = nextIndex++;
      out[idx] = await worker(list[idx], idx);
    }
  }

  const runners = Array.from({ length: Math.min(Math.max(1, limit), list.length) }, () => run());
  await Promise.all(runners);
  return out;
}

// P-2A: single source of truth for guided readiness, mirrored from the frontend
// P-1.1 mapping. Pure mapping from Engine B (checkTentativePlan) output.
function deriveGuidedStatus(result, error) {
  if (error || !result) {
    return { code: 'MATERIAL_CHECK_FAILED', label: 'Material Check Failed' };
  }
  const status = String(result.material_status || '').toUpperCase();
  const unresolved = Array.isArray(result.unresolved_items) ? result.unresolved_items : [];
  const purchase = Array.isArray(result.purchase_material_shortage) ? result.purchase_material_shortage : [];
  const internal = Array.isArray(result.internal_production_gap) ? result.internal_production_gap : [];
  if (status === 'NEEDS_RECIPE' || unresolved.length) return { code: 'RECIPE_MISSING', label: 'Recipe / Mapping Missing' };
  if (status === 'READY') return { code: 'READY', label: 'Ready to Plan' };
  if (purchase.length) return { code: 'NEED_PURCHASE', label: 'Need Purchase First' };
  if (internal.length) return { code: 'NEED_PRODUCTION', label: 'Need Internal Production First' };
  return { code: 'BLOCKED', label: 'Blocked — material short' };
}

// P-2B: conservative press-ready quantity from Engine B feasibility.
// ratio = min(available_qty / required_qty) over chain lines (clamped 0..1).
// Never exceeds requested; floored. READY -> full; recipe/blocked/unknown -> 0.
// NOTE: this is an ESTIMATE; exact per-stage/batch rounding is deferred.
function computePressReady(requestedQty, guided, data) {
  const req = num(requestedQty);
  if (req <= 0) return { press_ready_qty: 0, blocked_qty: 0, press_ready_basis: 'NO_DEMAND' };
  const code = guided && guided.code;
  if (code === 'READY') return { press_ready_qty: req, blocked_qty: 0, press_ready_basis: 'READY_FULL' };
  if (code === 'RECIPE_MISSING' || code === 'MATERIAL_CHECK_FAILED' || code === 'BLOCKED' || code === 'UNKNOWN') {
    return { press_ready_qty: 0, blocked_qty: req, press_ready_basis: 'BLOCKED_ZERO' };
  }
  // NEED_PURCHASE / NEED_PRODUCTION -> material ratio (bottleneck across the chain)
  const lines = Array.isArray(data && data.lines) ? data.lines : [];
  let ratio = 1;
  for (const l of lines) {
    const required = num(l.required_qty);
    if (required <= 0) continue;
    const frac = Math.max(0, Math.min(1, num(l.available_qty) / required));
    if (frac < ratio) ratio = frac;
  }
  const ready = Math.max(0, Math.min(req, Math.floor(req * ratio)));
  return { press_ready_qty: ready, blocked_qty: req - ready, press_ready_basis: 'ESTIMATED_BY_MATERIAL_RATIO' };
}


// MRP-PHASE-3A: annotate manufacturing gaps with open PPO/requested quantities.
// This is read-only netting metadata: it does not create/update PPOs and it does not
// change recipe explosion. The frontend subtracts open_requested_qty from the STK
// make-target so already-planned STK rows move to Already Requested.
function getOpenPpoDetail(openPpoPlannedQtyByItem, itemId) {
  if (!itemId || !openPpoPlannedQtyByItem || !openPpoPlannedQtyByItem.get) return null;
  const raw = openPpoPlannedQtyByItem.get(itemId);
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  return { open_qty: num(raw), refs: [] };
}

function annotateInternalGapWithOpenPpo(gaps, openPpoPlannedQtyByItem) {
  if (!Array.isArray(gaps) || !gaps.length) return [];
  return gaps.map((gap) => {
    const detail = getOpenPpoDetail(openPpoPlannedQtyByItem, gap?.item_id);
    const rawShortage = num(gap?.shortage_qty);
    const openQty = Math.max(0, num(detail?.open_qty));
    const appliedOpenQty = Math.min(rawShortage, openQty);
    if (!(appliedOpenQty > 0)) {
      return {
        ...gap,
        original_shortage_qty: rawShortage,
        open_requested_qty: 0,
        already_requested_refs: [],
        balance_after_requested_qty: rawShortage,
      };
    }
    return {
      ...gap,
      original_shortage_qty: rawShortage,
      open_requested_qty: appliedOpenQty,
      already_requested_refs: Array.isArray(detail?.refs) ? detail.refs : [],
      balance_after_requested_qty: Math.max(0, rawShortage - appliedOpenQty),
    };
  });
}

// MRP-PHASE-3C-BUY.2: annotate purchasable BP/RM shortage with already-requested (open PR) qty.
// Read-only netting metadata mirroring annotateInternalGapWithOpenPpo. already_requested_purchase_qty
// is the ITEM-LEVEL open Purchase Requirement quantity (identical for every demand row that needs the
// item); the frontend dedups purchase shortage per item_id and subtracts this ONCE after summing, so it
// must NOT be pre-clamped to a single row's shortage here.
function getOpenPurchaseDetail(openPurchaseQtyByItem, itemId) {
  if (!itemId || !openPurchaseQtyByItem || !openPurchaseQtyByItem.get) return null;
  const raw = openPurchaseQtyByItem.get(itemId);
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  return { open_qty: num(raw), refs: [] };
}

function annotatePurchaseShortageWithOpenPr(shortages, openPurchaseQtyByItem) {
  if (!Array.isArray(shortages) || !shortages.length) return [];
  return shortages.map((s) => {
    const detail = getOpenPurchaseDetail(openPurchaseQtyByItem, s?.item_id);
    const rawShortage = num(s?.shortage_qty);
    const openQty = Math.max(0, num(detail?.open_qty));
    return {
      ...s,
      original_shortage_qty: rawShortage,
      already_requested_purchase_qty: openQty,
      already_requested_purchase_refs: openQty > 0 && Array.isArray(detail?.refs) ? detail.refs : [],
      net_shortage_qty: Math.max(0, rawShortage - openQty),
    };
  });
}

// P-2A: Engine B becomes the readiness truth. For each FG/STK row, run the deep
// resolver (full chain) and stamp material fields. bp_* fields are left intact
// (advisory) by enrichBpFeasibility; this only ADDS fields. Purchase/BP rows are
// not re-checked here.
async function stampEngineBFeasibility(rows, openPpoPlannedQtyByItem = new Map(), openPurchaseQtyByItem = new Map()) {
  const list = Array.isArray(rows) ? rows : [];

  return mapLimit(list, 3, async (row) => {
    // MRP-SET-DEMAND-CG1: material feasibility is needed for ordinary FG/STK
    // production rows and for customer-demand final SET rows. Keep the existing
    // production predicate unchanged so reorder/press-planner behaviour is not widened.
    const stage = String(row.stage_type || '').toUpperCase();
    const isCustomerSetDemand = stage === 'SET' && num(row.sales_demand_pcs) > 0;
    if (!isProductionSuggestion(row) && !isCustomerSetDemand) return row;

    // A SET recipe's top input is PER_SET (for example 1 SET -> 4 PCS), therefore
    // the resolver must receive the sales-side SET count. Giving it production PCS
    // would multiply pcs_per_set twice. Non-SET rows keep their current quantity path.
    const setQtyFromProduction = num(row.pcs_per_set) > 0
      ? (num(row.sales_demand_pcs) / num(row.pcs_per_set))
      : 0;
    const qtyForCheck = isCustomerSetDemand
      ? (num(row.sales_demand_qty) || setQtyFromProduction || 0)
      : (num(row.suggested_qty) || num(row.sales_demand_pcs) || num(row.demand_qty) || 0);
    const uomForCheck = isCustomerSetDemand
      ? (row.sales_uom || 'SET')
      : row.uom_code;
    // Resolver quantity above is SET for final items, but readiness quantities exposed
    // by this engine are production/base PCS. Keep press_ready_qty/blocked_qty in PCS.
    const readinessQty = isCustomerSetDemand
      ? (num(row.production_demand_pcs) || num(row.sales_demand_pcs) || (qtyForCheck * (num(row.pcs_per_set) || 1)))
      : qtyForCheck;
    if (qtyForCheck <= 0) {
      return {
        ...row,
        material_status: 'UNKNOWN',
        guided_status: 'UNKNOWN',
        guided_label: 'No demand qty to check',
        is_material_ready: false,
        purchase_material_shortage: [],
        internal_production_gap: [],
        root_material_available: [],
        unresolved_items: [],
        press_ready_qty: 0,
        blocked_qty: 0,
        press_ready_basis: 'NO_DEMAND',
      };
    }

    let data = null;
    let error = null;
    try {
      const res = await checkTentativePlan([{
        item_code: row.item_code,
        item_name: row.item_name,
        approved_qty: qtyForCheck,
        suggested_qty: qtyForCheck,
        uom_code: uomForCheck,
        pcs_per_set: row.pcs_per_set,
      }]);
      data = res?.data || null;
      error = res?.error || null;
    } catch (e) {
      error = e;
    }

    const guided = deriveGuidedStatus(data, error);
    const pressReady = computePressReady(readinessQty, guided, data); // P-2B; PCS for SET demand
    const internalGapWithRequested = annotateInternalGapWithOpenPpo(data?.internal_production_gap || [], openPpoPlannedQtyByItem);
    const alreadyRequestedMake = internalGapWithRequested
      .filter((g) => num(g.open_requested_qty) > 0)
      .map((g) => ({
        item_id: g.item_id,
        item_code: g.item_code,
        item_name: g.item_name,
        stage_type: g.stage_type,
        kind: 'MAKE',
        request_type: (() => {
          const ts = new Set((Array.isArray(g.already_requested_refs) ? g.already_requested_refs : []).map((r) => r && r.request_type).filter(Boolean));
          return ts.size > 1 ? 'PPO+PLAN' : (ts.values().next().value || 'PPO');
        })(),
        required_qty: num(g.original_shortage_qty || g.shortage_qty),
        open_requested_qty: num(g.open_requested_qty),
        balance_qty: num(g.balance_after_requested_qty),
        uom_code: g.required_uom || g.uom_code || row.production_uom || row.uom_code || 'PCS',
        sources: Array.isArray(g.sources) ? g.sources : [],
        refs: Array.isArray(g.already_requested_refs) ? g.already_requested_refs : [],
      }));
    return {
      ...row,
      material_status: data?.material_status || (error ? 'CHECK_FAILED' : 'UNKNOWN'),
      guided_status: guided.code,
      guided_label: guided.label,
      is_material_ready: guided.code === 'READY',
      purchase_material_shortage: annotatePurchaseShortageWithOpenPr(data?.purchase_material_shortage || [], openPurchaseQtyByItem),
      internal_production_gap: internalGapWithRequested,
      already_requested_make: alreadyRequestedMake,
      root_material_available: data?.root_material_available || [],
      unresolved_items: data?.unresolved_items || [],
      press_ready_qty: pressReady.press_ready_qty,
      blocked_qty: pressReady.blocked_qty,
      press_ready_basis: pressReady.press_ready_basis,
    };
  });
}

function isProductionSuggestion(row) {
  return ['FG', 'STK'].includes(String(row.stage_type || '').toUpperCase());
}

function productionPcs(row, qtyValue = row.suggested_qty) {
  const qty = num(qtyValue);
  const uom = String(row.uom_code || '').toUpperCase();
  const pcsPerSet = num(row.pcs_per_set) || 1;   // PLANNING-UX-1: column only, no hardcoded 4
  return uom === 'SET' ? qty * pcsPerSet : qty;
}

function qtyFromPcs(row, pcsValue) {
  const pcs = Math.max(0, num(pcsValue));
  const uom = String(row.uom_code || '').toUpperCase();
  const pcsPerSet = num(row.pcs_per_set) || 1;   // PLANNING-UX-1: column only, no hardcoded 4
  return uom === 'SET' ? Math.floor(pcs / pcsPerSet) : Math.floor(pcs);
}

async function getOpenPpoPlannedQtyByItem() {
  const { data: headers, error: headerError } = await supabase
    .from('production_plan_orders')
    .select('id, plan_status, execution_status');

  if (headerError) throw headerError;

  const openHeaders = (headers || [])
    .filter((h) => {
      // MRP-PHASE-3A-FIX: net only NOT-YET-PRODUCING PPOs (execution DRAFT/BLOCKED). RELEASED/
      // COMPLETED output is already posted to inventory_balance -> netting it double-counts stock.
      const executionStatus = String(h.execution_status || '').toUpperCase();
      return executionStatus === 'DRAFT' || executionStatus === 'BLOCKED';
    });

  const headerById = new Map(openHeaders.map((h) => [h.id, h]));
  const openHeaderIds = openHeaders.map((h) => h.id).filter(Boolean);

  if (!openHeaderIds.length) return new Map();

  const { data: lines, error: lineError } = await supabase
    .from('production_plan_order_lines')
    .select('item_id, approved_qty, status, plan_order_id')
    .in('plan_order_id', openHeaderIds);

  if (lineError) throw lineError;

  const plannedByItem = new Map();

  for (const line of lines || []) {
    const status = String(line.status || '').toUpperCase();
    if (status === 'CANCELLED' || status === 'CLOSED') continue;

    const itemId = line.item_id;
    if (!itemId) continue;

    const qty = num(line.approved_qty);
    if (!(qty > 0)) continue;

    const header = headerById.get(line.plan_order_id) || {};
    const existing = plannedByItem.get(itemId) || { open_qty: 0, refs: [] };
    existing.open_qty += qty;
    existing.refs.push({
      plan_order_id: line.plan_order_id,
      request_no: line.plan_order_id,
      request_type: 'PPO',
      status: status || String(header.plan_status || header.execution_status || 'OPEN').toUpperCase(),
      qty,
    });
    plannedByItem.set(itemId, existing);
  }

  return plannedByItem;
}

// MRP-PHASE-3A-FIX: net DRAFT/APPROVED internal production plans, PLANNED lines only.
// PLANNED = no WO generated, no inventory moved -> safe to subtract (no stock double-count).
async function getOpenInternalPlanQtyByItem() {
  const { data: headers, error: headerError } = await supabase
    .from('internal_production_plans')
    .select('id, plan_number, status');
  if (headerError) throw headerError;

  const openHeaders = (headers || []).filter((h) => {
    const st = String(h.status || '').toUpperCase();
    return st === 'DRAFT' || st === 'APPROVED';
  });
  const headerById = new Map(openHeaders.map((h) => [h.id, h]));
  const openHeaderIds = openHeaders.map((h) => h.id).filter(Boolean);
  if (!openHeaderIds.length) return new Map();

  const { data: lines, error: lineError } = await supabase
    .from('internal_production_plan_lines')
    .select('item_id, qty, status, plan_id')
    .in('plan_id', openHeaderIds);
  if (lineError) throw lineError;

  const byItem = new Map();
  for (const line of lines || []) {
    const status = String(line.status || '').toUpperCase();
    if (status !== 'PLANNED') continue; // not WO_CREATED / CANCELLED
    const itemId = line.item_id;
    if (!itemId) continue;
    const qty = num(line.qty);
    if (!(qty > 0)) continue;

    const header = headerById.get(line.plan_id) || {};
    const existing = byItem.get(itemId) || { open_qty: 0, refs: [] };
    existing.open_qty += qty;
    existing.refs.push({
      plan_id: line.plan_id,
      request_no: header.plan_number || line.plan_id,
      request_type: 'INTERNAL_PLAN',
      status: status || String(header.status || 'PLANNED').toUpperCase(),
      qty,
    });
    byItem.set(itemId, existing);
  }
  return byItem;
}

// MRP-PHASE-3A-FIX: merge two open-make maps (PPO + internal plan) of shape {open_qty, refs}.
function mergeOpenMakeMaps(a, b) {
  const out = new Map();
  for (const [k, v] of (a || new Map())) out.set(k, { open_qty: num(v && v.open_qty), refs: [...((v && v.refs) || [])] });
  for (const [k, v] of (b || new Map())) {
    const cur = out.get(k) || { open_qty: 0, refs: [] };
    cur.open_qty += num(v && v.open_qty);
    cur.refs = [...(cur.refs || []), ...((v && v.refs) || [])];
    out.set(k, cur);
  }
  return out;
}

// MRP-PHASE-3C-BUY.2: sum OPEN Purchase Requirement line quantities by item (read-only).
// Confirmed statuses (from code, not guessed):
//   purchase_requirement_lines.status = 'draft' at creation
//     (materialAvailabilityService.createPurchaseRequirementFromShortage)
//   and becomes 'po_drafted' with generated_po_id set when a PO is generated
//     (routes/purchaseRequirements.js). No 'cancelled'/'closed'/'fulfilled' status exists in the code.
// "Open / already requested" = draft lines NOT yet converted to a PO (generated_po_id IS NULL).
// po_drafted / PO-linked lines are EXCLUDED (they move to the PO side). No PO/GRN/stock is read here,
// so there is no double subtraction of received/ordered/stock quantities.
async function getOpenPurchaseRequirementQtyByItem() {
  const { data: lines, error } = await supabase
    .from('purchase_requirement_lines')
    .select('item_id, shortage_qty, status, generated_po_id, pr_id');
  if (error) throw error;

  const openLines = (lines || []).filter((l) => {
    const st = String(l.status || '').toLowerCase();
    return st === 'draft' && !l.generated_po_id;
  });
  if (!openLines.length) return new Map();

  const prIds = [...new Set(openLines.map((l) => l.pr_id).filter(Boolean))];
  let headerById = new Map();
  if (prIds.length) {
    const { data: headers, error: hErr } = await supabase
      .from('purchase_requirements')
      .select('id, pr_no, status')
      .in('id', prIds);
    if (hErr) throw hErr;
    headerById = new Map((headers || []).map((h) => [h.id, h]));
  }

  const byItem = new Map();
  for (const line of openLines) {
    const itemId = line.item_id;
    if (!itemId) continue;
    const qty = num(line.shortage_qty);
    if (!(qty > 0)) continue;
    const header = headerById.get(line.pr_id) || {};
    const existing = byItem.get(itemId) || { open_qty: 0, refs: [] };
    existing.open_qty += qty;
    existing.refs.push({
      pr_id: line.pr_id,
      request_no: header.pr_no || line.pr_id,
      request_type: 'PR',
      status: String(line.status || 'draft').toLowerCase(),
      qty,
    });
    byItem.set(itemId, existing);
  }
  return byItem;
}

async function enrichBpFeasibility(suggestions) {
  const productionRows = suggestions.filter(isProductionSuggestion);
  const targetIds = [...new Set(productionRows.map((r) => r.item_id).filter(Boolean))];

  if (!targetIds.length) return suggestions;

  const { data: directRecipes } = await supabase
    .from('stage_recipe_headers')
    .select('id, fg_item_id, recipe_code')
    .eq('status', 'active')
    .in('fg_item_id', targetIds);

  const { data: targetOutputSteps } = await supabase
    .from('stage_recipe_steps')
    .select('id, recipe_id, step_no, output_item_id')
    .in('output_item_id', targetIds);

  const recipeIdsFromOutputSteps = [
    ...new Set((targetOutputSteps || []).map((s) => s.recipe_id).filter(Boolean)),
  ];

  const { data: outputStepRecipes } = recipeIdsFromOutputSteps.length
    ? await supabase
        .from('stage_recipe_headers')
        .select('id, fg_item_id, recipe_code')
        .eq('status', 'active')
        .in('id', recipeIdsFromOutputSteps)
    : { data: [] };

  const recipeById = new Map();
  for (const r of directRecipes || []) recipeById.set(r.id, r);
  for (const r of outputStepRecipes || []) recipeById.set(r.id, r);

  const recipes = [...recipeById.values()];
  const recipeIds = recipes.map((r) => r.id).filter(Boolean);

  const recipeByTargetItem = new Map();

  for (const r of directRecipes || []) {
    if (!recipeByTargetItem.has(r.fg_item_id)) recipeByTargetItem.set(r.fg_item_id, r);
  }

  const activeRecipeIds = new Set(recipeIds);
  for (const st of targetOutputSteps || []) {
    if (!activeRecipeIds.has(st.recipe_id)) continue;
    if (!recipeByTargetItem.has(st.output_item_id)) {
      recipeByTargetItem.set(st.output_item_id, recipeById.get(st.recipe_id));
    }
  }

  const { data: steps } = recipeIds.length
    ? await supabase
        .from('stage_recipe_steps')
        .select('id, recipe_id, step_no, output_item_id')
        .in('recipe_id', recipeIds)
    : { data: [] };

  const stepIds = [...new Set((steps || []).map((s) => s.id).filter(Boolean))];

  const { data: inputs } = stepIds.length
    ? await supabase
        .from('stage_recipe_inputs')
        .select('id, step_id, input_item_id, qty, qty_basis')
        .in('step_id', stepIds)
    : { data: [] };

  const inputItemIds = [...new Set((inputs || []).map((i) => i.input_item_id).filter(Boolean))];

  const { data: inputItems } = inputItemIds.length
    ? await supabase
        .from('item_master')
        .select('id, item_code, item_name, stage_type, bp_weight_g')
        .in('id', inputItemIds)
    : { data: [] };

  const inputItemById = new Map((inputItems || []).map((i) => [i.id, i]));

  const stepsByRecipe = new Map();
  for (const st of steps || []) {
    if (!stepsByRecipe.has(st.recipe_id)) stepsByRecipe.set(st.recipe_id, []);
    stepsByRecipe.get(st.recipe_id).push(st);
  }

  const inputsByStep = new Map();
  for (const inp of inputs || []) {
    if (!inputsByStep.has(inp.step_id)) inputsByStep.set(inp.step_id, []);
    inputsByStep.get(inp.step_id).push(inp);
  }

  const bpByTargetItem = new Map();

  for (const row of productionRows) {
    const recipe = recipeByTargetItem.get(row.item_id);
    const recipeSteps = recipe ? (stepsByRecipe.get(recipe.id) || []) : [];

    let bpInput = null;
    for (const st of recipeSteps) {
      for (const inp of inputsByStep.get(st.id) || []) {
        const item = inputItemById.get(inp.input_item_id);
        const stage = String(item?.stage_type || '').toUpperCase();
        const code = String(item?.item_code || '').toUpperCase();
        const isRawBp = stage === 'BP' || /^DEV_BP\d+/.test(code) || /^BP\d+/.test(code);
        const isProcessedBp = code.includes('SBBP') || code.includes('ACBP');

        if (isRawBp && !isProcessedBp) {
          bpInput = { input: inp, item };
          break;
        }
      }
      if (bpInput) break;
    }

    if (bpInput?.item) bpByTargetItem.set(row.item_id, bpInput.item);
  }

  const bpItemIds = [...new Set([...bpByTargetItem.values()].map((i) => i.id).filter(Boolean))];

  const { data: balances } = bpItemIds.length
    ? await supabase
        .from('inventory_balance')
        .select('item_id, quantity')
        .in('item_id', bpItemIds)
    : { data: [] };

  const bpStock = new Map();
  for (const b of balances || []) {
    bpStock.set(b.item_id, num(bpStock.get(b.item_id)) + num(b.quantity));
  }

  return suggestions.map((row) => {
    if (!isProductionSuggestion(row)) return row;

    const bp = bpByTargetItem.get(row.item_id);
    const requiredPcs = productionPcs(row);

    if (!bp) {
      return {
        ...row,
        bp_status: 'BP_NOT_MAPPED',
        bp_item_id: null,
        bp_item_code: null,
        bp_item_name: null,
        bp_available_pcs: 0,
        bp_required_pcs: requiredPcs,
        bp_feasible_pcs: 0,
        bp_feasible_qty: 0,
        bp_pending_pcs: requiredPcs,
        bp_pending_qty: qtyFromPcs(row, requiredPcs),
      };
    }

    const availablePcs = Math.floor(num(bpStock.get(bp.id)));
    let feasiblePcs = Math.min(requiredPcs, availablePcs);
    feasiblePcs = Math.max(0, Math.floor(feasiblePcs));

    const uom = String(row.uom_code || '').toUpperCase();
    const pcsPerSet = num(row.pcs_per_set) || 1;   // PLANNING-UX-1: column only, no hardcoded 4
    if (uom === 'SET') {
      feasiblePcs = Math.floor(feasiblePcs / pcsPerSet) * pcsPerSet;
    }

    const pendingPcs = Math.max(0, requiredPcs - feasiblePcs);
    const bpStatus =
      feasiblePcs >= requiredPcs ? 'BP_READY' :
      feasiblePcs > 0 ? 'BP_PARTIAL' :
      'BP_NOT_AVAILABLE';

    return {
      ...row,
      bp_status: bpStatus,
      bp_item_id: bp.id,
      bp_item_code: bp.item_code,
      bp_item_name: bp.item_name,
      bp_available_pcs: availablePcs,
      bp_required_pcs: requiredPcs,
      bp_feasible_pcs: feasiblePcs,
      bp_feasible_qty: qtyFromPcs(row, feasiblePcs),
      bp_pending_pcs: pendingPcs,
      bp_pending_qty: qtyFromPcs(row, pendingPcs),
    };
  });
}

export async function generateSuggestions() {
  const suggestions = [];
  // MRP-PHASE-3A-FIX: net safe PPO (DRAFT/BLOCKED) + DRAFT/APPROVED internal plans (PLANNED lines).
  const openPpoPlannedQtyByItem = mergeOpenMakeMaps(
    await getOpenPpoPlannedQtyByItem(),
    await getOpenInternalPlanQtyByItem(),
  );
  // MRP-PHASE-3C-BUY.2: open Purchase Requirement netting map (read-only; draft PR lines only).
  const openPurchaseQtyByItem = await getOpenPurchaseRequirementQtyByItem();

  const { data: sales } = await supabase
    .from('sales_order_lines')
    .select(`
      so_id,
      item_id,
      qty,
      uom_id,
      item:item_master(
        id,
        item_code,
        item_name,
        planning_unit,
        stage_type,
        pcs_per_set,
        min_stock,
        reorder_qty,
        max_stock
      )
    `);

  const allSalesRows = sales || [];
  // MRP-SO-2: exclude lines belonging to cancelled SOs (engine has no header status otherwise).
  const soIdsForStatus = [...new Set(allSalesRows.map((r) => r.so_id).filter(Boolean))];
  const { data: soStatusRows } = soIdsForStatus.length
    ? await supabase.from('sales_order_headers').select('id, status').in('id', soIdsForStatus)
    : { data: [] };
  const cancelledSoIds = new Set(
    (soStatusRows || [])
      .filter((h) => String(h.status || '').toLowerCase() === 'cancelled')
      .map((h) => h.id)
  );
  const salesRows = allSalesRows.filter((r) => !cancelledSoIds.has(r.so_id));
  // PLANNING-UX-1: resolve Sales UOM from the SO line (uom_id), per Item-Master-UOM-V1
  // (SET items: base=PCS, alternate=SET; the SO line carries the SET unit).
  const soLineUomIds = [...new Set(salesRows.map((r) => r.uom_id).filter(Boolean))];
  const { data: soUomRows } = soLineUomIds.length
    ? await supabase.from('uom_master').select('id, uom_code').in('id', soLineUomIds)
    : { data: [] };
  const soLineUomById = new Map((soUomRows || []).map((u) => [u.id, String(u.uom_code || '').toUpperCase()]));
  const setTargetCodes = [
    ...new Set(
      salesRows
        .map((row) => {
          const code = String(row.item?.item_code || '');
          const uom = String(row.item?.planning_unit || '').toUpperCase();
          const stage = String(row.item?.stage_type || '').toUpperCase();

          if (uom === 'SET' || stage === 'FG') {
            if (code.includes('_SET')) return code.replace('_SET', '_STK');
            if (code.startsWith('DEV_SET')) return code.replace('DEV_SET', 'DEV_STK');
          }

          return null;
        })
        .filter(Boolean)
    ),
  ];

  const { data: targetItems } = setTargetCodes.length
    ? await supabase
        .from('item_master')
        .select(`
          id,
          item_code,
          item_name,
          planning_unit,
          stage_type,
          pcs_per_set,
          min_stock,
          reorder_qty,
          max_stock
        `)
        .in('item_code', setTargetCodes)
    : { data: [] };

  const targetByCode = new Map((targetItems || []).map((item) => [item.item_code, item]));
  const mtsMap = new Map();

  function ensureMtsRow(item) {
    if (!item?.id) return null;

    const existing = mtsMap.get(item.id) || {
      item_id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      uom_code: item.planning_unit,
      stage_type: item.stage_type,
      pcs_per_set: item.pcs_per_set,
      min_stock: num(item.min_stock),
      reorder_qty: num(item.reorder_qty),
      max_stock: num(item.max_stock), // B1-MRP-PLANNING-OPTIONS: desired/target stock (existing column)
      sales_demand_pcs: 0,
      sales_demand_qty: 0,        // PLANNING-UX-1: sales-side qty (e.g. SET)
      sales_uom: null,            // PLANNING-UX-1: SO-line UOM
      pcs_per_set_missing: false, // PLANNING-UX-1
      sales_sources: [],
      reorder_triggered: false,
    };

    existing.min_stock = num(item.min_stock);
    existing.reorder_qty = num(item.reorder_qty);
    existing.max_stock = num(item.max_stock); // B1-MRP-PLANNING-OPTIONS
    mtsMap.set(item.id, existing);
    return existing;
  }

  for (const row of salesRows) {
    const sourceItem = row.item;
    if (!sourceItem?.id) continue;

    const sourceCode = String(sourceItem.item_code || '');
    const sourceUom = String(sourceItem.planning_unit || '').toUpperCase();
    const sourceStage = String(sourceItem.stage_type || '').toUpperCase();
    const soLineUom = String(soLineUomById.get(row.uom_id) || '').toUpperCase(); // PLANNING-UX-1: sales UOM
    const isSetSale = soLineUom === 'SET';

    let targetItem = sourceItem;

    if (isSetSale || sourceStage === 'FG') {
      const targetCode = sourceCode.includes('_SET')
        ? sourceCode.replace('_SET', '_STK')
        : sourceCode.startsWith('DEV_SET')
          ? sourceCode.replace('DEV_SET', 'DEV_STK')
          : null;

      if (targetCode && targetByCode.get(targetCode)) {
        targetItem = targetByCode.get(targetCode);
      }
    }

    const mtsRow = ensureMtsRow(targetItem);
    if (!mtsRow) continue;

    // PLANNING-UX-1: convert SET->PCS by SO-line UOM (not planning_unit); pcs_per_set column only.
    const sourcePcsPerSet = num(sourceItem.pcs_per_set) || 1;
    const salesQty = num(row.qty);
    const salesPcs = isSetSale ? salesQty * sourcePcsPerSet : salesQty;

    mtsRow.sales_demand_pcs += salesPcs;                               // production PCS (converted)
    mtsRow.sales_demand_qty = num(mtsRow.sales_demand_qty) + salesQty; // sales-side qty (SET)
    if (!mtsRow.sales_uom && (soLineUom || sourceUom)) mtsRow.sales_uom = soLineUom || sourceUom;
    if (isSetSale && !(num(sourceItem.pcs_per_set) > 0)) mtsRow.pcs_per_set_missing = true;
    mtsRow.sales_sources.push({
      item_id: sourceItem.id,
      item_code: sourceItem.item_code,
      qty: salesQty,
      uom_code: soLineUom || sourceItem.planning_unit,
      pcs: salesPcs,
    });
  }

  const { data: reorderItems } = await supabase
    .from('item_master')
    .select(`
      id,
      item_code,
      item_name,
      planning_unit,
      stage_type,
      pcs_per_set,
      min_stock,
      reorder_qty,
      max_stock
    `)
    .not('reorder_qty', 'is', null);

  for (const item of reorderItems ?? []) {
    ensureMtsRow(item);
  }

  const mtsRows = Array.from(mtsMap.values());
  const mtsItemIds = [...new Set(mtsRows.map((row) => row.item_id).filter(Boolean))];
  const stockQtyByItem = new Map();
  if (mtsItemIds.length) {
    const { data: stockRows, error: stockError } = await supabase
      .from('inventory_balance')
      .select('item_id, quantity')
      .in('item_id', mtsItemIds);
    if (stockError) throw stockError;
    for (const st of stockRows || []) {
      stockQtyByItem.set(st.item_id, num(stockQtyByItem.get(st.item_id)) + num(st.quantity));
    }
  }

  for (const row of mtsRows) {
    const stockQty = num(stockQtyByItem.get(row.item_id));
    const openPpoDetail = getOpenPpoDetail(openPpoPlannedQtyByItem, row.item_id);
    const openPpoQty = num(openPpoDetail?.open_qty);
    const salesDemandPcs = Math.floor(num(row.sales_demand_pcs));
    const reorderLevel = num(row.min_stock);
    const reorderQty = num(row.reorder_qty);
    const desiredStock = num(row.max_stock); // B1-MRP-PLANNING-OPTIONS: restore-to-desired target

    const projectedStockQty = stockQty + openPpoQty - salesDemandPcs;
    const salesShortagePcs = Math.max(0, salesDemandPcs - stockQty - openPpoQty);
    const soPlusBufferQty = Math.max(0, salesDemandPcs + desiredStock - stockQty - openPpoQty); // B1-MRP-PLANNING-OPTIONS
    const reorderTriggered = reorderLevel > 0 && projectedStockQty < reorderLevel;

    let suggestedQty = 0;
    if (reorderTriggered) {
      suggestedQty = reorderQty;
    }

    if (salesDemandPcs > 0 || reorderTriggered || suggestedQty > 0) {
      suggestions.push({
        item_id: row.item_id,
        item_code: row.item_code,
        item_name: row.item_name,
        uom_code: row.uom_code,
        stage_type: row.stage_type,
        pcs_per_set: row.pcs_per_set,
        reason:
          salesDemandPcs > 0 && reorderTriggered ? 'SALES_PLUS_REORDER' :
          salesDemandPcs > 0 ? 'SALES_ORDER' :
          'REORDER',
        demand_qty: salesDemandPcs,
        sales_demand_pcs: salesDemandPcs,
        sales_demand_qty: num(row.sales_demand_qty),   // PLANNING-UX-1: sales side (e.g. SET)
        sales_uom: row.sales_uom || null,              // PLANNING-UX-1
        production_demand_pcs: salesDemandPcs,         // PLANNING-UX-1: explicit production PCS
        production_uom: row.uom_code || 'PCS',         // PLANNING-UX-1: item base UOM
        pcs_per_set_missing: !!row.pcs_per_set_missing, // PLANNING-UX-1
        stock_qty: stockQty,
        open_ppo_qty: openPpoQty,
        projected_stock_qty: projectedStockQty,
        reorder_level: reorderLevel,
        reorder_qty: reorderQty,
        reorder_triggered: reorderTriggered,
        sales_shortage_pcs: salesShortagePcs,
        // B1-MRP-PLANNING-OPTIONS: additive read-only planning options. suggested_qty stays as-is.
        so_shortage_qty: salesShortagePcs,
        desired_stock: desiredStock,
        so_plus_buffer_qty: soPlusBufferQty,
        reorder_suggested_qty: suggestedQty,
        sales_sources: row.sales_sources,
        suggested_qty: suggestedQty,
      });
    }
  }

  const enriched = await enrichBpFeasibility(suggestions);

  // BP pending shortage -> purchase suggestions (raw Back Plate items to buy).
  // Aggregate pending PCS per BP item across all FG/STK production rows.
  const existingPurchaseItemIds = new Set(
    enriched.filter((r) => !isProductionSuggestion(r) && r.item_id).map((r) => r.item_id)
  );
  const bpShortageByItem = new Map();
  for (const row of enriched) {
    if (!isProductionSuggestion(row)) continue;
    const bpItemId = row.bp_item_id;
    const pendingPcs = num(row.bp_pending_pcs);
    if (!bpItemId || pendingPcs <= 0) continue;
    if (existingPurchaseItemIds.has(bpItemId)) continue; // already covered by reorder/sales row
    const agg = bpShortageByItem.get(bpItemId) || {
      item_id: bpItemId,
      item_code: row.bp_item_code,
      item_name: row.bp_item_name,
      available_pcs: num(row.bp_available_pcs),
      pending_pcs: 0,
      sources: [],
    };
    agg.pending_pcs += pendingPcs;
    if (row.item_code) agg.sources.push(row.item_code);
    bpShortageByItem.set(bpItemId, agg);
  }

  const bpSuggestions = [...bpShortageByItem.values()]
    .filter((b) => b.pending_pcs > 0)
    .map((b) => ({
      item_id: b.item_id,
      item_code: b.item_code,
      item_name: b.item_name,
      uom_code: 'PCS',
      stage_type: 'BP',
      pcs_per_set: 1,
      reason: 'BP_SHORTAGE',
      demand_qty: 0,
      sales_demand_pcs: 0,
      stock_qty: b.available_pcs,
      open_ppo_qty: 0,
      projected_stock_qty: b.available_pcs,
      reorder_level: 0,
      reorder_qty: 0,
      reorder_triggered: false,
      sales_shortage_pcs: 0,
      so_shortage_qty: 0,
      desired_stock: 0,
      so_plus_buffer_qty: 0,
      reorder_suggested_qty: 0,
      sales_sources: [...new Set(b.sources)],
      suggested_qty: b.pending_pcs,
    }));

  // P-2A: Engine B feasibility becomes the readiness truth on FG/STK rows.
  // bp_* fields stay intact (advisory) for frontend compatibility.
  const enrichedWithMaterial = await stampEngineBFeasibility(enriched, openPpoPlannedQtyByItem, openPurchaseQtyByItem);
  return { data: [...enrichedWithMaterial, ...bpSuggestions], error: null };
}
