import { supabase } from '../config/supabase.js';
import { getNextNumber } from './numberSeriesService.js';
import { snapshotBomComponentsForWO } from './woService.js';
import { calculateWorkOrderExpectedMinutes } from './recipeCalculationService.js';

function qtyNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readinessFromQty(readyQty, plannedQty) {
  if (plannedQty <= 0) return 'BLOCKED';
  if (readyQty >= plannedQty) return 'READY';
  if (readyQty > 0) return 'PARTIAL';
  return 'BLOCKED';
}


function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function keyOf(x) {
  return String(x?.client_key || x?.item_id || x?.id || x?.item_code || '');
}

function cleanId(v) {
  return v || null;
}

function lineQty(x) {
  return num(x?.approved_qty ?? x?.approvedQty ?? x?.suggested_qty ?? x?.quantity ?? x?.qty, 0);
}

function productionPcs(x) {
  const qty = lineQty(x);
  const uom = String(x?.uom_code || '').toUpperCase();
  const pcsPerSet = num(x?.pcs_per_set, 4);
  return num(x?.production_pcs ?? x?.productionPcs, uom === 'SET' ? qty * pcsPerSet : qty);
}

async function activeRecipeMapForTargetItems(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))];

  if (!ids.length) {
    return { recipes: [], recipeByItem: new Map(), error: null };
  }

  const { data: directRecipes, error: directErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, fg_item_id, recipe_code, recipe_name, status')
    .eq('status', 'active')
    .in('fg_item_id', ids);

  if (directErr) return { recipes: [], recipeByItem: new Map(), error: directErr };

  const { data: outputSteps, error: stepErr } = await supabase
    .from('stage_recipe_steps')
    .select('id, recipe_id, output_item_id, step_no')
    .in('output_item_id', ids);

  if (stepErr) return { recipes: [], recipeByItem: new Map(), error: stepErr };

  const outputRecipeIds = [
    ...new Set((outputSteps || []).map((x) => x.recipe_id).filter(Boolean)),
  ];

  const { data: outputRecipes, error: outputErr } = outputRecipeIds.length
    ? await supabase
        .from('stage_recipe_headers')
        .select('id, fg_item_id, recipe_code, recipe_name, status')
        .eq('status', 'active')
        .in('id', outputRecipeIds)
    : { data: [], error: null };

  if (outputErr) return { recipes: [], recipeByItem: new Map(), error: outputErr };

  const recipeById = new Map();
  for (const r of directRecipes || []) recipeById.set(r.id, r);
  for (const r of outputRecipes || []) recipeById.set(r.id, r);

  const recipeByItem = new Map();

  for (const r of directRecipes || []) {
    if (!recipeByItem.has(r.fg_item_id)) recipeByItem.set(r.fg_item_id, r);
  }

  for (const st of outputSteps || []) {
    const recipe = recipeById.get(st.recipe_id);
    if (recipe && !recipeByItem.has(st.output_item_id)) {
      recipeByItem.set(st.output_item_id, recipe);
    }
  }

  return {
    recipes: [...recipeById.values()],
    recipeByItem,
    error: null,
  };
}

function slotRowsFromPlan(planOrderId, lineMap, pressPlan) {
  const rows = [];

  for (const pressCode of Object.keys(pressPlan?.slots || {})) {
    const slots = pressPlan.slots?.[pressCode] || {};
    const queues = pressPlan.queues?.[pressCode] || {};

    for (const slotCode of ['A', 'B']) {
      const current = slots?.[slotCode];
      if (current) {
        rows.push(makeSlotRow(planOrderId, lineMap, pressCode, slotCode, 1, current));
      }

      const q = queues?.[slotCode] || [];
      q.forEach((item, idx) => {
        rows.push(makeSlotRow(planOrderId, lineMap, pressCode, slotCode, idx + 2, item));
      });
    }
  }

  return rows.filter(Boolean);
}

function itemsFromPressPlan(pressPlan) {
  const out = [];
  const seen = new Set();

  function add(item) {
    if (!item || !(item.item_id || item.id)) return;
    const k = keyOf(item);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(item);
  }

  for (const pressCode of Object.keys(pressPlan?.slots || {})) {
    const slots = pressPlan.slots?.[pressCode] || {};
    const queues = pressPlan.queues?.[pressCode] || {};

    for (const slotCode of ['A', 'B']) {
      add(slots?.[slotCode]);
      for (const item of queues?.[slotCode] || []) add(item);
    }
  }

  return out;
}


function makeSlotRow(planOrderId, lineMap, pressCode, slotCode, sequenceNo, item) {
  const itemId = item?.item_id || item?.id;
  if (!itemId) return null;

  const k = keyOf(item);
  const production_pcs = productionPcs(item);
  const cavity = num(item?.cavity, null);
  const cycle_time_sec = num(item?.cycle_time_sec, null); // PATCH23: no hardcoded 510 fallback
  const has_cycle = Number(cycle_time_sec) > 0;
  const cycles_required = cavity ? Math.ceil(production_pcs / cavity) : null;
  const runtime_hours = (cycles_required && has_cycle) ? Number(((cycles_required * cycle_time_sec) / 3600).toFixed(2)) : null;

  return {
    plan_order_id: planOrderId,
    line_id: lineMap.get(k) || null,
    press_code: pressCode,
    slot_code: slotCode,
    sequence_no: sequenceNo,
    item_id: itemId,
    planned_qty: lineQty(item),
    production_pcs,
    cavity,
    cycle_time_sec,
    cycles_required,
    runtime_hours,
    status: 'PLANNED',
    notes: `${sequenceNo === 1 ? 'Current slot' : 'Continuation queue'}${has_cycle ? '' : ' | NEEDS_SLOT_CYCLE'}`,
  };
}

export async function createProductionPlanOrder(payload, userId) {
  const payloadItems = Array.isArray(payload?.items) ? payload.items : [];
  const plannedItems = itemsFromPressPlan(payload?.press_plan || {});
  const items = plannedItems.length ? plannedItems : payloadItems;
  const validItems = items.filter(x => x?.item_id || x?.id);

  if (!validItems.length) {
    return { data: null, error: { code: 'VALIDATION_ERROR', status: 400, message: 'No assigned press slot items supplied for PPO.' } };
  }

  const validItemIds = [...new Set(validItems.map(x => x?.item_id || x?.id).filter(Boolean))];
  const { data: validItemMasters = [], error: validItemErr } = validItemIds.length
    ? await supabase
        .from('item_master')
        .select('id,item_code,item_name,uom_id')
        .in('id', validItemIds)
    : { data: [], error: null };

  if (validItemErr) {
    return { data: null, error: validItemErr };
  }

  const validItemMasterMap = new Map((validItemMasters || []).map(item => [item.id, item]));

  let ppoNumber;
  try {
    ppoNumber = await getNextNumber('PPO');
  } catch (e) {
    return { data: null, error: { code: e.code || 'INTERNAL_ERROR', status: 500, message: e.message || 'PPO number series error.' } };
  }

  const totalPcs = validItems.reduce((sum, x) => sum + productionPcs(x), 0);

  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .insert({
      ppo_number: ppoNumber,
      source_type: payload?.source_type || 'TENTATIVE_PRESS_PLAN',
      source_ref_id: payload?.source_ref_id || null,
      plan_status: 'TENTATIVE',
      material_status: payload?.material_status || 'NOT_CHECKED',
      press_status: payload?.press_status || 'PLANNED',
      execution_status: 'NOT_RELEASED',
      total_items: validItems.length,
      total_qty_pcs: totalPcs,
      notes: payload?.notes || 'Created from Press Planner',
      created_by: userId,
    })
    .select('*')
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { message: 'Failed to create PPO header.' } };
  }

  const lineRows = validItems.map((x, idx) => ({
    plan_order_id: header.id,
    line_number: idx + 1,
    item_id: x.item_id || x.id,
    uom_id: cleanId(x.uom_id) || validItemMasterMap.get(x.item_id || x.id)?.uom_id || null,
    approved_qty: lineQty(x),
    production_pcs: productionPcs(x),
    pcs_per_set: x.pcs_per_set ?? null,
    source_type: x.source_type || payload?.source_type || 'TENTATIVE_PRESS_PLAN',
    source_ref_id: x.source_ref_id || payload?.source_ref_id || null,
    source_line_id: x.source_line_id || null,
    status: 'PLANNED',
    notes: x.item_code ? `From Press Planner: ${x.item_code}` : 'From Press Planner',
  }));

  const { data: lines, error: lErr } = await supabase
    .from('production_plan_order_lines')
    .insert(lineRows)
    .select('*');

  if (lErr) {
    await supabase.from('production_plan_orders').delete().eq('id', header.id);
    return { data: null, error: lErr };
  }

  const lineMap = new Map();
  validItems.forEach((x, idx) => lineMap.set(keyOf(x), lines?.[idx]?.id));

  const slotRows = slotRowsFromPlan(header.id, lineMap, payload?.press_plan || {});
  if (slotRows.length) {
    const { error: sErr } = await supabase.from('production_plan_press_slots').insert(slotRows);
    if (sErr) {
      await supabase.from('production_plan_orders').delete().eq('id', header.id);
      return { data: null, error: sErr };
    }
  }

  return {
    data: {
      ...header,
      lines_count: lineRows.length,
      press_slots_count: slotRows.length,
      selected_only: plannedItems.length > 0,
      ignored_unassigned_count: Math.max(0, payloadItems.length - validItems.length),
    },
    error: null,
  };
}



async function buildDynamicDependencies(lines) {
  const itemIds = [...new Set((lines || []).map(l => l.item_id).filter(Boolean))];

  if (!itemIds.length) return { data: [], error: null };

  const { data: recipes, error: rErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, fg_item_id, recipe_code, recipe_name, status')
    .in('fg_item_id', itemIds);

  if (rErr) return { data: [], error: rErr };

  const recipeIds = [...new Set((recipes || []).map(r => r.id))];
  if (!recipeIds.length) return { data: [], error: null };

  const { data: steps, error: stErr } = await supabase
    .from('stage_recipe_steps')
    .select('id, recipe_id, step_no, process_type_id, output_item_id, machine_id, calculation_basis, dependency_step_no, qc_required, fpa_required')
    .in('recipe_id', recipeIds)
    .order('step_no', { ascending: true });

  if (stErr) return { data: [], error: stErr };

  const processIds = [...new Set((steps || []).map(s => s.process_type_id).filter(Boolean))];
  const outputItemIds = [...new Set((steps || []).map(s => s.output_item_id).filter(Boolean))];

  const { data: processes, error: pErr } = processIds.length
    ? await supabase.from('process_types').select('id, type_code, type_name, seq_no, is_bottleneck, stage_item_code_abbr').in('id', processIds)
    : { data: [], error: null };

  if (pErr) return { data: [], error: pErr };

  const { data: outputItems, error: oiErr } = outputItemIds.length
    ? await supabase.from('item_master').select('id, item_code, item_name').in('id', outputItemIds)
    : { data: [], error: null };

  if (oiErr) return { data: [], error: oiErr };

  const processMap = new Map((processes || []).map(x => [x.id, x]));
  const itemMap = new Map((outputItems || []).map(x => [x.id, x]));
  const recipeByFg = new Map((recipes || []).map(r => [r.fg_item_id, r]));
  const stepsByRecipe = new Map();

  for (const st of steps || []) {
    if (!stepsByRecipe.has(st.recipe_id)) stepsByRecipe.set(st.recipe_id, []);
    stepsByRecipe.get(st.recipe_id).push(st);
  }

  const result = [];

  for (const line of lines || []) {
    const recipe = recipeByFg.get(line.item_id);
    const itemCode = line.item_master?.item_code || null;
    const itemName = line.item_master?.item_name || null;

    if (!recipe) {
      result.push({
        line_id: line.id,
        item_id: line.item_id,
        item_code: itemCode,
        item_name: itemName,
        recipe_found: false,
        recipe_code: null,
        pre_press: [],
        press_anchor: [],
        post_press: [],
      });
      continue;
    }

    const enriched = (stepsByRecipe.get(recipe.id) || []).map(st => {
      const proc = processMap.get(st.process_type_id) || {};
      const out = itemMap.get(st.output_item_id) || {};
      return {
        step_no: st.step_no,
        process_code: proc.type_code || null,
        process_name: proc.type_name || 'Unknown process',
        is_bottleneck: Boolean(proc.is_bottleneck),
        output_item_code: out.item_code || null,
        output_item_name: out.item_name || null,
        calculation_basis: st.calculation_basis || null,
        dependency_step_no: st.dependency_step_no || null,
        qc_required: Boolean(st.qc_required),
        fpa_required: Boolean(st.fpa_required),
      };
    }).sort((a, b) => Number(a.step_no) - Number(b.step_no));

    const anchor = enriched.find(x => x.is_bottleneck);
    const anchorStep = anchor ? Number(anchor.step_no) : null;

    result.push({
      line_id: line.id,
      item_id: line.item_id,
      item_code: itemCode,
      item_name: itemName,
      recipe_found: true,
      recipe_code: recipe.recipe_code,
      recipe_name: recipe.recipe_name,
      pre_press: anchorStep == null ? [] : enriched.filter(x => Number(x.step_no) < anchorStep),
      press_anchor: anchorStep == null ? [] : enriched.filter(x => Number(x.step_no) === anchorStep),
      post_press: anchorStep == null ? enriched : enriched.filter(x => Number(x.step_no) > anchorStep),
    });
  }

  return { data: result, error: null };
}


async function decorateWorkOrdersWithInputReasons(workOrders, lines) {
  if (!workOrders?.length) return [];

  const woIds = (workOrders || []).map(wo => wo.id).filter(Boolean);

  const { data: components, error: compErr } = woIds.length
    ? await supabase
        .from('wo_component_lines')
        .select('id, wo_id, component_item_id, required_qty, issued_qty, uom_id, is_active')
        .in('wo_id', woIds)
        .eq('is_active', true)
    : { data: [], error: null };

  if (compErr) throw compErr;

  const componentItemIds = [...new Set((components || []).map(c => c.component_item_id).filter(Boolean))];

  const { data: componentItems, error: itemErr } = componentItemIds.length
    ? await supabase
        .from('item_master')
        .select('id, item_code, item_name, stage_type')
        .in('id', componentItemIds)
    : { data: [], error: null };

  if (itemErr) throw itemErr;

  const { data: balances, error: balErr } = componentItemIds.length
    ? await supabase
        .from('inventory_balance')
        .select('item_id, quantity, uom_id')
        .in('item_id', componentItemIds)
    : { data: [], error: null };

  if (balErr) throw balErr;

  const uomIds = [
    ...new Set([
      ...(components || []).map(c => c.uom_id),
      ...(balances || []).map(b => b.uom_id),
    ].filter(Boolean)),
  ];

  const { data: uoms, error: uomErr } = uomIds.length
    ? await supabase
        .from('uom_master')
        .select('id, uom_code')
        .in('id', uomIds)
    : { data: [], error: null };

  if (uomErr) throw uomErr;

  const itemMap = new Map((componentItems || []).map(i => [i.id, i]));
  const uomMap = new Map((uoms || []).map(u => [u.id, String(u.uom_code || '').toUpperCase()]));

  const componentsByWo = new Map();
  for (const c of components || []) {
    if (!componentsByWo.has(c.wo_id)) componentsByWo.set(c.wo_id, []);
    componentsByWo.get(c.wo_id).push(c);
  }

  const balanceRowsByItem = new Map();
  for (const b of balances || []) {
    if (!balanceRowsByItem.has(b.item_id)) balanceRowsByItem.set(b.item_id, []);
    balanceRowsByItem.get(b.item_id).push(b);
  }

  function isKgCode(code) {
    return ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(String(code || '').toUpperCase());
  }

  function isGramCode(code) {
    return ['G', 'GM', 'GRM', 'GRAM', 'GRAMS'].includes(String(code || '').toUpperCase());
  }

  function convertQty(qty, fromUomId, toUomId) {
    const n = qtyNum(qty);
    if (!fromUomId || !toUomId || fromUomId === toUomId) return n;

    const fromCode = uomMap.get(fromUomId);
    const toCode = uomMap.get(toUomId);

    if (isKgCode(fromCode) && isGramCode(toCode)) return n * 1000;
    if (isGramCode(fromCode) && isKgCode(toCode)) return n / 1000;

    return n;
  }

  function availableForComponent(itemId, targetUomId) {
    return (balanceRowsByItem.get(itemId) || []).reduce(
      (sum, b) => sum + convertQty(b.quantity, b.uom_id, targetUomId),
      0
    );
  }

  function displayUomCode(uomCode) {
    return isGramCode(uomCode) ? 'KG' : (uomCode || '');
  }

  function displayQtyValue(qty, uomCode) {
    return isGramCode(uomCode) ? qtyNum(qty) / 1000 : qtyNum(qty);
  }

  return (workOrders || []).map(wo => {
    const woComponents = componentsByWo.get(wo.id) || [];

    const input_details = woComponents.map(c => {
      const componentItem = itemMap.get(c.component_item_id) || {};
      const uomCode = uomMap.get(c.uom_id) || '';
      const requiredQty = Math.max(0, qtyNum(c.required_qty) - qtyNum(c.issued_qty));
      const availableQty = availableForComponent(c.component_item_id, c.uom_id);
      const shortageQty = Math.max(0, requiredQty - availableQty);

      return {
        input_item_id: c.component_item_id,
        input_item_code: componentItem.item_code || 'UNKNOWN',
        input_item_name: componentItem.item_name || '',
        input_stage_type: componentItem.stage_type || '',
        required_qty: Number(requiredQty.toFixed(4)),
        available_qty: Number(availableQty.toFixed(4)),
        shortage_qty: Number(shortageQty.toFixed(4)),
        uom_code: uomCode,
        display_required_qty: Number(displayQtyValue(requiredQty, uomCode).toFixed(4)),
        display_available_qty: Number(displayQtyValue(availableQty, uomCode).toFixed(4)),
        display_shortage_qty: Number(displayQtyValue(shortageQty, uomCode).toFixed(4)),
        display_uom_code: displayUomCode(uomCode),
        qty_basis: 'WO_COMPONENT_LINE',
      };
    });

    const missing = input_details.filter(x => qtyNum(x.shortage_qty) > 0);
    const block_reason = !input_details.length
      ? 'No input required'
      : missing.length
        ? `Missing: ${missing.slice(0, 3).map(x => x.input_item_code).join(', ')}${missing.length > 3 ? ' +' + (missing.length - 3) : ''}`
        : 'Inputs available';

    return {
      ...wo,
      input_details,
      block_reason,
    };
  });
}

export async function listProductionPlanOrders() {
  const { data, error } = await supabase
    .from('production_plan_orders')
    .select('*')
    .order('created_at', { ascending: false });

  return { data: data || [], error };
}

export async function getProductionPlanOrderById(id) {
  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .select('*')
    .eq('id', id)
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { message: 'PPO not found.' } };
  }

  const { data: lines, error: lErr } = await supabase
    .from('production_plan_order_lines')
    .select('*, item_master:item_id(item_code,item_name), uom_master:uom_id(uom_code)')
    .eq('plan_order_id', id)
    .order('line_number', { ascending: true });

  if (lErr) return { data: null, error: lErr };

  const { data: slots, error: sErr } = await supabase
    .from('production_plan_press_slots')
    .select('*, item_master:item_id(item_code,item_name)')
    .eq('plan_order_id', id)
    .order('press_code', { ascending: true })
    .order('slot_code', { ascending: true })
    .order('sequence_no', { ascending: true });

  if (sErr) return { data: null, error: sErr };

  const { data: workOrders, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, item_id, source_ppo_line_id, process_type_id, stage_output_item_id, planned_qty, status, readiness_status, ready_to_start_qty, blocked_qty, item:item_id(item_code,item_name), process:process_type_id(type_code,type_name)')
    .eq('source_ppo_id', id)
    .eq('wo_kind', 'PPO_STAGE')
    .order('created_at', { ascending: true });

  if (woErr) return { data: null, error: woErr };

  const { data: dependencies, error: dErr } = await buildDynamicDependencies(lines || []);
  if (dErr) return { data: null, error: dErr };

  // Patch 6A: read-only production summary for the decision-first PPO view.
  // Keep correction semantics identical to getProductionPlanTimelineLoad().
  const summaryWorkOrders = workOrders || [];
  const summaryWoIds = summaryWorkOrders.map((wo) => wo.id).filter(Boolean);
  const summaryGoodByWo = {};
  const summaryScrapByWo = {};
  const summaryStartByWo = {};
  const summaryEndByWo = {};

  if (summaryWoIds.length) {
    const { data: summaryLogs, error: summaryLogErr } = await supabase
      .from('production_logs')
      .select('wo_id, good_qty, scrap_qty, entry_type, correction_delta_good_qty, correction_delta_scrap_qty, actual_start_at, actual_end_at')
      .in('wo_id', summaryWoIds);

    if (summaryLogErr) return { data: null, error: summaryLogErr };

    for (const log of summaryLogs || []) {
      const goodQty = log.entry_type === 'CORRECTION'
        ? Number(log.correction_delta_good_qty || 0)
        : Number(log.good_qty || 0);

      const scrapQty = log.entry_type === 'CORRECTION'
        ? Number(log.correction_delta_scrap_qty || 0)
        : Number(log.scrap_qty || 0);

      summaryGoodByWo[log.wo_id] =
        (summaryGoodByWo[log.wo_id] || 0) + goodQty;

      summaryScrapByWo[log.wo_id] =
        (summaryScrapByWo[log.wo_id] || 0) + scrapQty;

      if (
        log.actual_start_at &&
        (
          !summaryStartByWo[log.wo_id] ||
          log.actual_start_at < summaryStartByWo[log.wo_id]
        )
      ) {
        summaryStartByWo[log.wo_id] = log.actual_start_at;
      }

      if (
        log.actual_end_at &&
        (
          !summaryEndByWo[log.wo_id] ||
          log.actual_end_at > summaryEndByWo[log.wo_id]
        )
      ) {
        summaryEndByWo[log.wo_id] = log.actual_end_at;
      }
    }
  }

  let activeWoCount = 0;
  let releasedWoCount = 0;
  let completedWoCount = 0;
  let readyWoCount = 0;
  let blockedWoCount = 0;
  let notCheckedWoCount = 0;
  let quantityCompleteWoCount = 0;
  let scrapWoCount = 0;
  let hasProductionActivity = false;
  let hasScrapActivity = false;
  let actualStartAt = null;
  let actualEndAt = null;

  for (const wo of summaryWorkOrders) {
    const status = String(wo.status || '').toLowerCase();
    const readiness = String(wo.readiness_status || '').toUpperCase();

    const goodQty = Math.max(
      0,
      Number(summaryGoodByWo[wo.id] || 0)
    );

    const scrapQty = Number(summaryScrapByWo[wo.id] || 0);
    const plannedQty = Number(wo.planned_qty || 0);
    const startedAt = summaryStartByWo[wo.id] || null;
    const endedAt = summaryEndByWo[wo.id] || null;

    const isCompletedStatus =
      status === 'completed' || status === 'closed';

    const hasWoActivity =
      goodQty > 0 ||
      scrapQty > 0 ||
      Boolean(startedAt);

    if (hasWoActivity) {
      hasProductionActivity = true;
    }

    if (hasWoActivity && !isCompletedStatus) {
      activeWoCount += 1;
    }

    if (status === 'released' && !hasWoActivity) {
      releasedWoCount += 1;
    }

    if (isCompletedStatus) {
      completedWoCount += 1;
    }

    if (
      status === 'draft' &&
      (readiness === 'READY' || readiness === 'PARTIAL')
    ) {
      readyWoCount += 1;
    }

    if (status === 'draft' && readiness === 'BLOCKED') {
      blockedWoCount += 1;
    }

    if (
      status === 'draft' &&
      (!readiness || readiness === 'NOT_CHECKED')
    ) {
      notCheckedWoCount += 1;
    }

    if (plannedQty > 0 && goodQty >= plannedQty) {
      quantityCompleteWoCount += 1;
    }

    if (scrapQty > 0) {
      scrapWoCount += 1;
      hasScrapActivity = true;
    }

    if (
      startedAt &&
      (!actualStartAt || startedAt < actualStartAt)
    ) {
      actualStartAt = startedAt;
    }

    if (
      endedAt &&
      (!actualEndAt || endedAt > actualEndAt)
    ) {
      actualEndAt = endedAt;
    }
  }

  const productionSummary = {
    total_wo_count: summaryWorkOrders.length,
    has_production_activity: hasProductionActivity,
    active_wo_count: activeWoCount,
    released_wo_count: releasedWoCount,
    completed_wo_count: completedWoCount,
    ready_wo_count: readyWoCount,
    blocked_wo_count: blockedWoCount,
    not_checked_wo_count: notCheckedWoCount,
    quantity_complete_wo_count: quantityCompleteWoCount,
    has_scrap_activity: hasScrapActivity,
    scrap_wo_count: scrapWoCount,
    actual_start_at: actualStartAt,
    actual_end_at: actualEndAt,
  };
  return {
    data: {
      ...header,
      production_summary: productionSummary,
      lines: lines || [],
      press_slots: slots || [],
      work_orders: await decorateWorkOrdersWithInputReasons(workOrders || [], lines || []),
      dependencies: dependencies || [],
    },
    error: null,
  };
}


export async function cancelProductionPlanOrder(id, userId) {
  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .select('id, ppo_number, plan_status, execution_status, notes')
    .eq('id', id)
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'PPO not found.' } };
  }

  const { data: wos, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, status')
    .eq('source_ppo_id', id);

  if (woErr) return { data: null, error: woErr };

  const woIds = (wos || []).map(w => w.id);

  const { data: logs, error: logErr } = woIds.length
    ? await supabase
        .from('production_logs')
        .select('id, wo_id')
        .in('wo_id', woIds)
    : { data: [], error: null };

  if (logErr) return { data: null, error: logErr };

  const logIds = (logs || []).map(l => l.id);

  const { data: ledgerRows, error: ledgerErr } = logIds.length
    ? await supabase
        .from('inventory_ledger')
        .select('id, reference_id')
        .eq('reference_type', 'PRODUCTION_LOG')
        .in('reference_id', logIds)
    : { data: [], error: null };

  if (ledgerErr) return { data: null, error: ledgerErr };

  if ((logs || []).length || (ledgerRows || []).length) {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        status: 409,
        message: 'Cannot cancel PPO because production logs or inventory ledger rows already exist. Reverse production first.',
      },
    };
  }

  if (woIds.length) {
    const { error: stepDelErr } = await supabase
      .from('wo_step_lines')
      .delete()
      .in('wo_id', woIds);

    if (stepDelErr) return { data: null, error: stepDelErr };

    const { error: componentDelErr } = await supabase
      .from('wo_component_lines')
      .delete()
      .in('wo_id', woIds);

    if (componentDelErr) return { data: null, error: componentDelErr };

    const { error: woDelErr } = await supabase
      .from('wo_headers')
      .delete()
      .in('id', woIds);

    if (woDelErr) return { data: null, error: woDelErr };
  }

  const now = new Date().toISOString();

  const { error: slotErr } = await supabase
    .from('production_plan_press_slots')
    .update({ status: 'CANCELLED', updated_at: now })
    .eq('plan_order_id', id);

  if (slotErr) return { data: null, error: slotErr };

  const { error: lineErr } = await supabase
    .from('production_plan_order_lines')
    .update({ status: 'CANCELLED', updated_at: now })
    .eq('plan_order_id', id);

  if (lineErr) return { data: null, error: lineErr };

  const cancelNote = `Cancelled from PPO page at ${now}`;
  const { data: updated, error: updErr } = await supabase
    .from('production_plan_orders')
    .update({
      plan_status: 'CANCELLED',
      execution_status: 'CANCELLED',
      notes: [header.notes, cancelNote].filter(Boolean).join('\n'),
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updErr) return { data: null, error: updErr };

  return {
    data: {
      ...updated,
      cancelled: true,
      deleted_work_orders: woIds.length,
      blocked_logs: 0,
      blocked_ledger_rows: 0,
    },
    error: null,
  };
}


export async function syncRoutingsFromPPO(id, userId) {
  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .select('id, ppo_number')
    .eq('id', id)
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', message: 'PPO not found.' } };
  }


  const { data: lines, error: lErr } = await supabase
    .from('production_plan_order_lines')
    .select('id, item_id, item_master:item_id(item_code,item_name)')
    .eq('plan_order_id', id)
    .order('line_number', { ascending: true });

  if (lErr) return { data: null, error: lErr };

  const itemIds = [...new Set((lines || []).map(l => l.item_id).filter(Boolean))];

  if (!itemIds.length) {
    return { data: { created: 0, skipped: 0, message: 'No PPO lines found.' }, error: null };
  }

  const { data: standardType, error: rtErr } = await supabase
    .from('routing_types')
    .select('id, type_code')
    .eq('type_code', 'STANDARD')
    .eq('is_active', true)
    .single();

  if (rtErr || !standardType) {
    return { data: null, error: { code: 'VALIDATION_ERROR', message: 'STANDARD routing type not found.' } };
  }

  const { data: existingRoutings, error: erErr } = await supabase
    .from('routing_headers')
    .select('id, item_id, status')
    .in('item_id', itemIds)
    .eq('status', 'active');

  if (erErr) return { data: null, error: erErr };

  const existingItemIds = new Set((existingRoutings || []).map(r => r.item_id));

  const { recipes, recipeByItem, error: recErr } = await activeRecipeMapForTargetItems(itemIds);

  if (recErr) return { data: null, error: recErr };

  const recipeIds = [...new Set((recipes || []).map(r => r.id))];

  const { data: steps, error: stErr } = recipeIds.length
    ? await supabase
        .from('stage_recipe_steps')
        .select('id, recipe_id, step_no, output_item_id, process_type_id, machine_id, qc_required, fpa_required, notes')
        .in('recipe_id', recipeIds)
        .order('step_no', { ascending: true })
    : { data: [], error: null };

  if (stErr) return { data: null, error: stErr };

  const processIds = [...new Set((steps || []).map(s => s.process_type_id).filter(Boolean))];

  const { data: processes, error: pErr } = processIds.length
    ? await supabase
        .from('process_types')
        .select('id, type_code, type_name, is_wo_driven, is_bottleneck')
        .in('id', processIds)
    : { data: [], error: null };

  if (pErr) return { data: null, error: pErr };

  const processMap = new Map((processes || []).map(p => [p.id, p]));
  const stepsByRecipe = new Map();

  for (const step of steps || []) {
    if (!stepsByRecipe.has(step.recipe_id)) stepsByRecipe.set(step.recipe_id, []);
    stepsByRecipe.get(step.recipe_id).push(step);
  }

  let created = 0;
  let skipped = 0;
  const results = [];

  for (const line of lines || []) {
    if (existingItemIds.has(line.item_id)) {
      skipped++;
      results.push({
        item_code: line.item_master?.item_code,
        status: 'skipped',
        reason: 'Active routing already exists',
      });
      continue;
    }

    const recipe = recipeByItem.get(line.item_id);
    if (!recipe) {
      skipped++;
      results.push({
        item_code: line.item_master?.item_code,
        status: 'skipped',
        reason: 'No stage recipe found',
      });
      continue;
    }

    const recipeSteps = (stepsByRecipe.get(recipe.id) || []).sort((a, b) => Number(a.step_no) - Number(b.step_no));

    if (!recipeSteps.length) {
      skipped++;
      results.push({
        item_code: line.item_master?.item_code,
        status: 'skipped',
        reason: 'Recipe has no steps',
      });
      continue;
    }

    const { data: rh, error: rhErr } = await supabase
      .from('routing_headers')
      .insert({
        item_id: line.item_id,
        routing_type_id: standardType.id,
        version_number: 1,
        status: 'active',
        effective_date: new Date().toISOString().slice(0, 10),
        notes: `Auto-synced from ${recipe.recipe_code} via ${header.ppo_number}`,
        created_by: userId,
      })
      .select('id')
      .single();

    if (rhErr || !rh) return { data: null, error: rhErr || { message: 'Failed to create routing header.' } };

    const routeSteps = recipeSteps.map((st, idx) => {
      const proc = processMap.get(st.process_type_id) || {};
      const prev = recipeSteps[idx - 1];

      return {
        routing_header_id: rh.id,
        seq_no: st.step_no,
        step_name: proc.type_name || proc.type_code || `Step ${st.step_no}`,
        process_type_id: st.process_type_id,
        input_item_id: prev?.output_item_id || null,
        output_item_id: st.output_item_id || null,
        wip_produced: Boolean(st.output_item_id),
        is_wo_driven: Boolean(proc.is_wo_driven ?? true),
        qc_required: Boolean(st.qc_required),
        machine_required: Boolean(st.machine_id),
        die_required: Boolean(proc.is_bottleneck),
        labour_required: true,
        is_active: true,
        notes: `Synced from stage recipe step ${st.step_no}`,
        created_by: userId,
      };
    });

    const { error: rsErr } = await supabase.from('routing_steps').insert(routeSteps);

    if (rsErr) {
      await supabase.from('routing_headers').delete().eq('id', rh.id);
      return { data: null, error: rsErr };
    }

    created++;
    results.push({
      item_code: line.item_master?.item_code,
      status: 'created',
      routing_id: rh.id,
      steps: routeSteps.length,
    });
  }

  return {
    data: {
      ppo_number: header.ppo_number,
      created,
      skipped,
      results,
    },
    error: null,
  };
}


async function activeRoutingForItem(itemId) {
  const { data, error } = await supabase
    .from('routing_headers')
    .select('id, routing_type_id, item_id, status')
    .eq('item_id', itemId)
    .eq('status', 'active')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}


async function activeGeneratedBomForRecipeStep(recipeStepId) {
  if (!recipeStepId) return null;

  const { data, error } = await supabase
    .from('bom_headers')
    .select('id')
    .eq('generated_from_recipe_step_id', recipeStepId)
    .eq('is_system_generated', true)
    .eq('status', 'active')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function uomForItem(itemId) {
  if (!itemId) return null;
  const { data } = await supabase
    .from('item_master')
    .select('id, uom_id')
    .eq('id', itemId)
    .maybeSingle();

  return data?.uom_id || null;
}


export async function generateWorkOrdersFromPPO(id, userId, options = {}) {
  const targetProcessCode = String(options.process_code || options.processCode || '').trim().toUpperCase() || null;
  const shouldRegenerateTarget = Boolean(options.regenerate) && Boolean(targetProcessCode);
  let targetProcessTypeId = null;
  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .select('id, ppo_number, execution_status')
    .eq('id', id)
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', message: 'PPO not found.' } };
  }

  const { data: existing, error: exErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number')
    .eq('source_ppo_id', id)
    .eq('wo_kind', 'PPO_STAGE')
    .limit(1);

  if (exErr) return { data: null, error: exErr };

  if (!targetProcessCode && existing?.length) {
    return {
      data: {
        ppo_number: header.ppo_number,
        created: 0,
        skipped: existing.length,
        message: 'Work Orders already generated for this PPO.',
      },
      error: null,
    };
  }

  const { data: lines, error: lErr } = await supabase
    .from('production_plan_order_lines')
    .select('id, line_number, item_id, approved_qty, production_pcs, source_type, source_ref_id, source_line_id, item_master:item_id(item_code,item_name)')
    .eq('plan_order_id', id)
    .order('line_number', { ascending: true });

  if (lErr) return { data: null, error: lErr };
  if (!lines?.length) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'No PPO lines found.' } };

  // ── MTO (SALES_ORDER) Phase 2: downstream-only WO generation + lot stamp ──
  const mtoIsSalesOrder = (l) => String(l.source_type || '').toUpperCase() === 'SALES_ORDER';
  let stackingCutoffSeq = null;
  if (lines.some(mtoIsSalesOrder)) {
    const { data: stk } = await supabase
      .from('process_types')
      .select('seq_no')
      .eq('type_code', 'STACKING')
      .limit(1)
      .maybeSingle();
    stackingCutoffSeq = stk ? Number(stk.seq_no) : null;
    if (stackingCutoffSeq == null || !Number.isFinite(stackingCutoffSeq)) {
      return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Cannot resolve STACKING process seq_no for MTO downstream filter.' } };
    }
  }
  const mtoSoRefIds = [...new Set(lines.filter(l => mtoIsSalesOrder(l) && l.source_ref_id).map(l => l.source_ref_id))];
  const { data: mtoSoHeaders } = mtoSoRefIds.length
    ? await supabase.from('sales_order_headers').select('id, so_number, customer_id').in('id', mtoSoRefIds)
    : { data: [] };
  const mtoSoById = new Map((mtoSoHeaders || []).map(h => [h.id, h]));
  const mtoLotCtxFor = (line) => {
    if (!mtoIsSalesOrder(line)) return null;
    const so = mtoSoById.get(line.source_ref_id);
    return {
      source_sales_order_id: line.source_ref_id || null,
      source_sales_order_line_id: line.source_line_id || null,
      customer_id: so?.customer_id || null,
      customer_lot_code: so ? `${so.so_number}-L${line.line_number}` : null,
      lot_tracking_scope: 'STACKING_ONWARD',
    };
  };

  const { data: slots, error: slotErr } = await supabase
    .from('production_plan_press_slots')
    .select('id, line_id, item_id, press_code, slot_code, sequence_no')
    .eq('plan_order_id', id);

  if (slotErr) return { data: null, error: slotErr };

  const slotByLine = new Map((slots || []).map(s => [s.line_id, s]));

  const itemIds = [...new Set(lines.map(l => l.item_id).filter(Boolean))];

  const { recipes, recipeByItem, error: recErr } = await activeRecipeMapForTargetItems(itemIds);

  if (recErr) return { data: null, error: recErr };

  const recipeIds = [...new Set((recipes || []).map(r => r.id))];

  const { data: recipeSteps, error: rstErr } = recipeIds.length
    ? await supabase
        .from('stage_recipe_steps')
        .select('id, recipe_id, step_no, output_item_id, process_type_id')
        .in('recipe_id', recipeIds)
    : { data: [], error: null };

  if (rstErr) return { data: null, error: rstErr };

  const recipeStepIds = [...new Set((recipeSteps || []).map(s => s.id))];

  const { data: recipeInputs, error: riErr } = recipeStepIds.length
    ? await supabase
        .from('stage_recipe_inputs')
        .select('id, step_id, input_item_id, qty, qty_basis, uom_id')
        .in('step_id', recipeStepIds)
    : { data: [], error: null };

  if (riErr) return { data: null, error: riErr };

  const inputItemIds = [...new Set((recipeInputs || []).map(i => i.input_item_id).filter(Boolean))];
  const inputUomIds = [...new Set((recipeInputs || []).map(i => i.uom_id).filter(Boolean))];

  const { data: inputItems } = inputItemIds.length
    ? await supabase.from('item_master').select('id, item_code, item_name, bp_weight_g, uom_id').in('id', inputItemIds)
    : { data: [] };

  const { data: uoms } = inputUomIds.length
    ? await supabase.from('uom_master').select('id, uom_code').in('id', inputUomIds)
    : { data: [] };

  const { data: kgUom } = await supabase
    .from('uom_master')
    .select('id, uom_code')
    .in('uom_code', ['KG', 'KGS'])
    .limit(1)
    .maybeSingle();

  const itemMap = new Map((inputItems || []).map(i => [i.id, i]));
  const uomMap = new Map((uoms || []).map(u => [u.id, String(u.uom_code || '').toUpperCase()]));

  const stepsByRecipe = new Map();
  for (const st of recipeSteps || []) {
    if (!stepsByRecipe.has(st.recipe_id)) stepsByRecipe.set(st.recipe_id, []);
    stepsByRecipe.get(st.recipe_id).push(st);
  }

  const inputsByStep = new Map();
  for (const inp of recipeInputs || []) {
    if (!inputsByStep.has(inp.step_id)) inputsByStep.set(inp.step_id, []);
    inputsByStep.get(inp.step_id).push(inp);
  }

  async function machineCapacityConfig(processCode) {
    const code = processCode === 'MIXING' ? 'MIXER' : processCode === 'SHOT_BLASTING' ? 'SHOT_BLAST' : null;
    if (!code) return { capacityKg: null, tolerancePercent: 0 };

    const { data } = await supabase
      .from('machine_master')
      .select('planning_capacity, batch_capacity_kg, rated_capacity, capacity_tolerance_percent')
      .or(`machine_code.ilike.%${code}%,machine_name.ilike.%${code}%`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    return {
      capacityKg: Number(data?.planning_capacity || data?.batch_capacity_kg || data?.rated_capacity || 0) || null,
      tolerancePercent: Number(data?.capacity_tolerance_percent || 0) || 0,
    };
  }

  async function batchCapacityKg(processCode) {
    const cfg = await machineCapacityConfig(processCode);
    return cfg.capacityKg;
  }

  async function practicalShotBlastBatchPcs(bpWeightG, packMultiple = 100) {
    const cfg = await machineCapacityConfig('SHOT_BLASTING');
    const capacityKg = Number(cfg.capacityKg || 0);
    const tolerancePercent = Number(cfg.tolerancePercent || 0);
    const weightG = Number(bpWeightG || 0);
    const multiple = Number(packMultiple || 100);

    if (capacityKg <= 0 || weightG <= 0 || multiple <= 0) return null;

    const targetPcs = Math.floor(((capacityKg * 1000) / weightG) / multiple) * multiple;
    const minKg = capacityKg * (1 - tolerancePercent / 100);
    const maxKg = capacityKg * (1 + tolerancePercent / 100);

    let pcs = Math.max(multiple, targetPcs);
    let kg = (pcs * weightG) / 1000;

    if (kg < minKg) {
      const up = Math.ceil(((minKg * 1000) / weightG) / multiple) * multiple;
      const upKg = (up * weightG) / 1000;
      if (upKg <= maxKg) pcs = up;
    }

    kg = (pcs * weightG) / 1000;
    if (kg > maxKg) {
      pcs = Math.floor(((maxKg * 1000) / weightG) / multiple) * multiple;
    }

    return Math.max(multiple, pcs);
  }

  function toKg(qty, uomCode) {
    const u = String(uomCode || '').toUpperCase();
    if (u === 'G' || u === 'GM' || u === 'GRM' || u === 'GRAM') return Number(qty || 0) / 1000;
    return Number(qty || 0);
  }

  function formulaSignature(stepInputs) {
    return (stepInputs || [])
      .map(inp => `${inp.input_item_id}:${Number(inp.qty || 0)}:${inp.uom_id || ''}:${inp.qty_basis || ''}`)
      .sort()
      .join('|');
  }

  function requiredMixKgForStep(recipeId, mixOutputItemId, productionPcs) {
    const allSteps = (stepsByRecipe.get(recipeId) || []).sort((a, b) => Number(a.step_no) - Number(b.step_no));
    for (const st of allSteps) {
      const ins = inputsByStep.get(st.id) || [];
      const found = ins.find(i => i.input_item_id === mixOutputItemId && String(i.qty_basis || '').toUpperCase() === 'PER_OUTPUT');
      if (found) {
        return toKg(Number(productionPcs || 0) * Number(found.qty || 0), uomMap.get(found.uom_id));
      }
    }
    return Number(productionPcs || 0);
  }

  function requiredShotBlastKg(stepInputs, productionPcs) {
    for (const inp of stepInputs || []) {
      const inputItem = itemMap.get(inp.input_item_id);
      const bpWeightG = Number(inputItem?.bp_weight_g || 0);
      if (bpWeightG > 0) {
        return Number(productionPcs || 0) * Number(inp.qty || 1) * bpWeightG / 1000;
      }
    }
    return Number(productionPcs || 0);
  }

  async function createWO({ line, routing, step, recipeStep, stepInputs = [], plannedQty, uomId, sourceSlotId, notes, lotCtx = null }) {
    const woNumber = await (await import('./numberSeriesService.js')).getNextNumber('WORK_ORDER');
    const outputItemId = step.output_item_id || line.item_id;
    const hasRecipeInputs = Array.isArray(stepInputs) && stepInputs.some((inp) => inp?.input_item_id);
    let bomId = null;

    if (hasRecipeInputs) {
      if (!recipeStep?.id) {
        throw {
          code: 'VALIDATION_ERROR',
          message: 'Recipe step link missing for stage Work Order. Please sync Recipe Setup before generating Work Orders.',
        };
      }

      bomId = await activeGeneratedBomForRecipeStep(recipeStep.id);
      if (!bomId) {
        throw {
          code: 'VALIDATION_ERROR',
          message: 'No active generated BOM found for this recipe step. Please sync Recipe Setup before generating Work Orders.',
        };
      }
    }

    const { data: wo, error: woErr } = await supabase
      .from('wo_headers')
      .insert({
        wo_number: woNumber,
        item_id: outputItemId,
        routing_id: routing.id,
        routing_type_id: routing.routing_type_id,
        bom_id: bomId,
        planned_qty: plannedQty,
        uom_id: uomId || await uomForItem(outputItemId),
        status: 'draft',
        priority_level: 'NORMAL',
        source_ppo_id: id,
        source_ppo_line_id: line?.id || null,
        source_ppo_slot_id: sourceSlotId || null,
        wo_kind: 'PPO_STAGE',
        process_type_id: step.process_type_id,
        stage_output_item_id: outputItemId,
        source_sales_order_id: lotCtx?.source_sales_order_id ?? null,
        source_sales_order_line_id: lotCtx?.source_sales_order_line_id ?? null,
        customer_id: lotCtx?.customer_id ?? null,
        customer_lot_code: lotCtx?.customer_lot_code ?? null,
        lot_tracking_scope: lotCtx?.lot_tracking_scope ?? 'NONE',
        readiness_status: 'NOT_CHECKED',
        ready_to_start_qty: 0,
        blocked_qty: plannedQty,
        notes,
        created_by: userId,
      })
      .select('id, wo_number')
      .single();

    if (woErr || !wo) throw woErr || { message: 'Failed to create WO.' };

    const { error: stErr } = await supabase
      .from('wo_step_lines')
      .insert({
        wo_id: wo.id,
        routing_step_id: step.id,
        seq_no: step.seq_no,
        step_name: step.step_name,
        is_wo_driven: true,
        wip_produced: Boolean(step.wip_produced),
        qc_required: Boolean(step.qc_required),
        machine_required: Boolean(step.machine_required),
        die_required: Boolean(step.die_required),
        labour_required: Boolean(step.labour_required),
        planned_qty: plannedQty,
        step_status: 'not_started',
        readiness_status: 'NOT_CHECKED',
        ready_to_start_qty: 0,
        blocked_qty: plannedQty,
        created_by: userId,
      });

    if (stErr) {
      await supabase.from('wo_headers').delete().eq('id', wo.id);
      throw stErr;
    }

    let compSnapshot;
    try {
      compSnapshot = await snapshotBomComponentsForWO(wo.id, bomId, plannedQty, userId);
    } catch (err) {
      await supabase.from('wo_component_lines').delete().eq('wo_id', wo.id);
      await supabase.from('wo_step_lines').delete().eq('wo_id', wo.id);
      await supabase.from('wo_headers').delete().eq('id', wo.id);
      throw err;
    }

    if (compSnapshot?.error) {
      await supabase.from('wo_component_lines').delete().eq('wo_id', wo.id);
      await supabase.from('wo_step_lines').delete().eq('wo_id', wo.id);
      await supabase.from('wo_headers').delete().eq('id', wo.id);
      throw compSnapshot.error;
    }

    if (hasRecipeInputs && Number(compSnapshot?.data?.inserted || 0) <= 0) {
      await supabase.from('wo_component_lines').delete().eq('wo_id', wo.id);
      await supabase.from('wo_step_lines').delete().eq('wo_id', wo.id);
      await supabase.from('wo_headers').delete().eq('id', wo.id);
      throw {
        code: 'VALIDATION_ERROR',
        message: 'Generated BOM has no active component lines for this recipe step. Please sync Recipe Setup before generating Work Orders.',
      };
    }

    return wo;
  }

  const batchGroups = new Map();
  const normalPlans = [];
  const processIds = new Set();

  const contexts = [];

  for (const line of lines) {
    const routing = await activeRoutingForItem(line.item_id);
    if (!routing) {
      contexts.push({ line, skipped: true, reason: 'No active routing found' });
      continue;
    }

    const { data: routeSteps, error: rsErr } = await supabase
      .from('routing_steps')
      .select('id, seq_no, step_name, process_type_id, output_item_id, machine_required, die_required, labour_required, qc_required, wip_produced, is_wo_driven')
      .eq('routing_header_id', routing.id)
      .eq('is_active', true)
      .order('seq_no', { ascending: true });

    if (rsErr) return { data: null, error: rsErr };

    for (const st of routeSteps || []) processIds.add(st.process_type_id);
    contexts.push({ line, routing, routeSteps: routeSteps || [] });
  }

  const { data: processRows } = processIds.size
    ? await supabase.from('process_types').select('id, type_code, type_name, seq_no').in('id', [...processIds])
    : { data: [] };

  const processMap = new Map((processRows || []).map(p => [p.id, p]));

  for (const ctx of contexts) {
    if (ctx.skipped) continue;

    const { line, routing, routeSteps } = ctx;
    const recipe = recipeByItem.get(line.item_id);
    const rSteps = recipe ? (stepsByRecipe.get(recipe.id) || []) : [];
    const productionPcs = Number(line.production_pcs || line.approved_qty || 0);
    const pressSlot = slotByLine.get(line.id);

    for (const step of routeSteps) {
      const proc = processMap.get(step.process_type_id) || {};
      const processCode = proc.type_code;

      if (targetProcessCode && processCode !== targetProcessCode) continue;

      // MTO: generate only STACKING-onward stages; skip upstream MTS/common stages.
      if (mtoIsSalesOrder(line)) {
        const stepSeq = Number(proc.seq_no);
        if (!Number.isFinite(stepSeq) || stepSeq < stackingCutoffSeq) continue;
      }

      const recipeStep = rSteps.find(st =>
        st.process_type_id === step.process_type_id &&
        st.output_item_id === step.output_item_id
      );

      const stepInputs = recipeStep ? (inputsByStep.get(recipeStep.id) || []) : [];

      if (processCode === 'MIXING') {
        const requiredKg = requiredMixKgForStep(recipe.id, step.output_item_id, productionPcs);
        const key = `MIXING|${step.output_item_id}|${formulaSignature(stepInputs)}`;
        if (!batchGroups.has(key)) {
          batchGroups.set(key, { processCode, line, routing, step, recipeStep, stepInputs, totalQty: 0, uomId: kgUom?.id || null, notes: 'Grouped Mixing batch WO' });
        }
        batchGroups.get(key).totalQty += requiredKg;
        continue;
      }

      if (processCode === 'SHOT_BLASTING') {
        const bpInput = stepInputs.find(inp => Number(itemMap.get(inp.input_item_id)?.bp_weight_g || 0) > 0);
        const bpWeightG = Number(itemMap.get(bpInput?.input_item_id)?.bp_weight_g || 0);
        const key = `SHOT_BLASTING|${bpInput?.input_item_id || step.output_item_id}`;
        if (!batchGroups.has(key)) {
          batchGroups.set(key, {
            processCode,
            line,
            routing,
            step,
            recipeStep,
            stepInputs,
            totalQty: 0,
            uomId: null,
            notes: 'Grouped Shot Blasting practical batch WO',
            bpWeightG,
          });
        }
        batchGroups.get(key).totalQty += productionPcs;
        continue;
      }

      normalPlans.push({
        line,
        routing,
        step,
        recipeStep,
        stepInputs,
        plannedQty: ((step.output_item_id || line.item_id) === line.item_id) ? (lineQty(line) > 0 ? lineQty(line) : productionPcs) : productionPcs,
        uomId: null,
        sourceSlotId: Boolean(step.die_required) ? (pressSlot?.id || null) : null,
        notes: `Generated from ${header.ppo_number} — ${step.step_name}`,
        lotCtx: mtoLotCtxFor(line),
      });
    }
  }

  let created = 0;
  let skipped = contexts.filter(c => c.skipped).length;
  const results = [];

  for (const group of batchGroups.values()) {
    let batchSize = group.totalQty;

    if (group.processCode === 'SHOT_BLASTING') {
      batchSize = await practicalShotBlastBatchPcs(group.bpWeightG) || group.totalQty;
    } else {
      const cap = await batchCapacityKg(group.processCode);
      batchSize = cap || group.totalQty;
    }

    const totalQty = Number(Number(group.totalQty || 0).toFixed(4));
    const estimatedBatches = batchSize > 0 ? Math.ceil(totalQty / batchSize) : 1;

    await createWO({
      ...group,
      plannedQty: totalQty,
      notes: `${group.notes} — ${estimatedBatches} machine batch(es), single continuous WO`,
    });

    created++;

    results.push({
      process: group.processCode,
      status: 'grouped_single_wo',
      total_qty: totalQty,
      batch_size: batchSize,
      batches: estimatedBatches,
      created_wos: 1,
      regenerated: shouldRegenerateTarget,
    });
  }

  for (const plan of normalPlans) {
    await createWO(plan);
    created++;
  }

  if (created > 0) {
    await supabase
      .from('production_plan_orders')
      .update({
        execution_status: 'WO_DRAFTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  return {
    data: {
      ppo_number: header.ppo_number,
      created,
      skipped,
      results,
    },
    error: null,
  };
}


export async function checkWOReadinessForPPO(id, options = {}) {
  const { updateExecutionStatus = true } = options;
  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .select('id, ppo_number')
    .eq('id', id)
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', message: 'PPO not found.' } };
  }

  const { data: wos, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, item_id, stage_output_item_id, process_type_id, planned_qty, status')
    .eq('source_ppo_id', id)
    .eq('wo_kind', 'PPO_STAGE')
    .order('created_at', { ascending: true });

  if (woErr) return { data: null, error: woErr };

  if (!wos?.length) {
    return {
      data: {
        ppo_number: header.ppo_number,
        checked: 0,
        ready: 0,
        partial: 0,
        blocked: 0,
        message: 'No PPO Work Orders found.',
      },
      error: null,
    };
  }

  const woIds = (wos || []).map(w => w.id).filter(Boolean);

  const producedByWo = new Map();
  if (woIds.length) {
    const { data: logs, error: logErr } = await supabase
      .from('production_logs')
      .select('wo_id, good_qty, entry_type, correction_delta_good_qty')
      .in('wo_id', woIds);

    if (logErr) return { data: null, error: logErr };

    for (const log of logs || []) {
      const current = qtyNum(producedByWo.get(log.wo_id));
      const qty = log.entry_type === 'CORRECTION'
        ? qtyNum(log.correction_delta_good_qty)
        : qtyNum(log.good_qty);

      producedByWo.set(log.wo_id, current + qty);
    }
  }

  const { data: components, error: compErr } = await supabase
    .from('wo_component_lines')
    .select('id, wo_id, component_item_id, required_qty, issued_qty, uom_id, is_active')
    .in('wo_id', woIds)
    .eq('is_active', true);

  if (compErr) return { data: null, error: compErr };

  const componentItemIds = [...new Set((components || []).map(c => c.component_item_id).filter(Boolean))];

  const { data: componentItems, error: compItemErr } = componentItemIds.length
    ? await supabase
        .from('item_master')
        .select('id, item_code, item_name')
        .in('id', componentItemIds)
    : { data: [], error: null };

  if (compItemErr) return { data: null, error: compItemErr };

  const { data: balances, error: balErr } = componentItemIds.length
    ? await supabase
        .from('inventory_balance')
        .select('item_id, quantity, uom_id')
        .in('item_id', componentItemIds)
    : { data: [], error: null };

  if (balErr) return { data: null, error: balErr };

  const uomIds = [
    ...new Set([
      ...(components || []).map(c => c.uom_id),
      ...(balances || []).map(b => b.uom_id),
    ].filter(Boolean)),
  ];

  const { data: uoms, error: uomErr } = uomIds.length
    ? await supabase
        .from('uom_master')
        .select('id, uom_code')
        .in('id', uomIds)
    : { data: [], error: null };

  if (uomErr) return { data: null, error: uomErr };

  const uomById = new Map((uoms || []).map(u => [u.id, String(u.uom_code || '').toUpperCase()]));
  const itemById = new Map((componentItems || []).map(i => [i.id, i]));

  function isKgCode(code) {
    return ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(String(code || '').toUpperCase());
  }

  function isGramCode(code) {
    return ['G', 'GM', 'GRM', 'GRAM', 'GRAMS'].includes(String(code || '').toUpperCase());
  }

  function convertQty(qty, fromUomId, toUomId) {
    const n = qtyNum(qty);
    if (!fromUomId || !toUomId || fromUomId === toUomId) return n;

    const fromCode = uomById.get(fromUomId);
    const toCode = uomById.get(toUomId);

    if (isKgCode(fromCode) && isGramCode(toCode)) return n * 1000;
    if (isGramCode(fromCode) && isKgCode(toCode)) return n / 1000;

    return n;
  }

  const componentsByWo = new Map();
  for (const c of components || []) {
    if (!componentsByWo.has(c.wo_id)) componentsByWo.set(c.wo_id, []);
    componentsByWo.get(c.wo_id).push(c);
  }

  const balancesByItem = new Map();
  for (const b of balances || []) {
    if (!balancesByItem.has(b.item_id)) balancesByItem.set(b.item_id, []);
    balancesByItem.get(b.item_id).push(b);
  }

  const remainingByComponentKey = new Map();

  function componentKey(c) {
    return `${c.component_item_id || ''}|${c.uom_id || ''}`;
  }

  function availableForComponent(c) {
    const key = componentKey(c);

    if (!remainingByComponentKey.has(key)) {
      const available = (balancesByItem.get(c.component_item_id) || []).reduce(
        (sum, b) => sum + convertQty(b.quantity, b.uom_id, c.uom_id),
        0
      );
      remainingByComponentKey.set(key, available);
    }

    return qtyNum(remainingByComponentKey.get(key));
  }

  function outstandingRequiredForRemaining(c, remainingPlannedQty, plannedQty) {
    const requiredTotal = Math.max(0, qtyNum(c.required_qty) - qtyNum(c.issued_qty));
    if (plannedQty <= 0) return requiredTotal;
    return requiredTotal * (remainingPlannedQty / plannedQty);
  }

  function reserveForComponent(c, reserveQty) {
    const key = componentKey(c);
    const available = availableForComponent(c);
    remainingByComponentKey.set(key, Math.max(0, available - reserveQty));
  }

  let ready = 0;
  let partial = 0;
  let blocked = 0;
  const results = [];

  for (const wo of wos || []) {
    const plannedQty = qtyNum(wo.planned_qty);
    const producedQty = Math.max(0, qtyNum(producedByWo.get(wo.id)));
    const remainingPlannedQty = Math.max(0, plannedQty - producedQty);
    const comps = componentsByWo.get(wo.id) || [];

    let readyToStartQty = remainingPlannedQty;
    const componentDetails = [];

    if (remainingPlannedQty <= 0) {
      readyToStartQty = 0;
    } else if (comps.length) {
      for (const c of comps) {
        const required = outstandingRequiredForRemaining(c, remainingPlannedQty, plannedQty);
        const available = availableForComponent(c);
        const componentItem = itemById.get(c.component_item_id);
        const uomCode = uomById.get(c.uom_id) || '';

        if (required > 0) {
          const possibleQty = available >= required
            ? remainingPlannedQty
            : remainingPlannedQty * (available / required);

          readyToStartQty = Math.min(readyToStartQty, possibleQty);
        }

        componentDetails.push({
          item_id: c.component_item_id,
          item_code: componentItem?.item_code || null,
          item_name: componentItem?.item_name || null,
          required_qty: Number(required.toFixed(4)),
          available_qty: Number(available.toFixed(4)),
          shortage_qty: Number(Math.max(0, required - available).toFixed(4)),
          uom_code: uomCode,
        });
      }

      readyToStartQty = Math.max(0, Math.min(remainingPlannedQty, Number(readyToStartQty.toFixed(4))));
    }

    const blockedQty = Math.max(0, Number((remainingPlannedQty - readyToStartQty).toFixed(4)));

    const status =
      remainingPlannedQty <= 0 ? 'READY' :
      readyToStartQty >= remainingPlannedQty ? 'READY' :
      readyToStartQty > 0 ? 'PARTIAL' :
      'BLOCKED';

    if (status === 'READY') ready++;
    else if (status === 'PARTIAL') partial++;
    else blocked++;

    if (readyToStartQty > 0 && remainingPlannedQty > 0 && comps.length) {
      for (const c of comps) {
        const required = outstandingRequiredForRemaining(c, remainingPlannedQty, plannedQty);
        const reserveQty = readyToStartQty >= remainingPlannedQty
          ? required
          : required * (readyToStartQty / remainingPlannedQty);

        reserveForComponent(c, reserveQty);
      }
    }

    // P2: do NOT overwrite readiness on a RELEASED work order. A later recompute
    // (sibling production log, manual recheck, or another release) must not flip an
    // already-released WO into status=released + readiness_status=BLOCKED. The value is
    // still COMPUTED above and returned below; only the persist onto released WOs is
    // skipped. Draft WOs are unaffected. No schema/SQL/readiness-calculation change.
    const persistReadiness = String(wo.status || '').toLowerCase() !== 'released';

    if (persistReadiness) {
      await supabase
        .from('wo_headers')
        .update({
          readiness_status: status,
          ready_to_start_qty: readyToStartQty,
          blocked_qty: blockedQty,
          updated_at: new Date().toISOString(),
        })
        .eq('id', wo.id);

      await supabase
        .from('wo_step_lines')
        .update({
          readiness_status: status,
          ready_to_start_qty: readyToStartQty,
          blocked_qty: blockedQty,
          updated_at: new Date().toISOString(),
        })
        .eq('wo_id', wo.id);
    }

    results.push({
      wo_id: wo.id,
      wo_number: wo.wo_number,
      readiness_status: status,
      ready_to_start_qty: readyToStartQty,
      blocked_qty: blockedQty,
      components: componentDetails,
    });
  }

  await supabase
    .from('production_plan_orders')
    .update({
      material_status: blocked > 0 ? (ready > 0 || partial > 0 ? 'PARTIAL' : 'BLOCKED') : 'READY',
      ...(updateExecutionStatus ? { execution_status: 'WO_DRAFTED' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  return {
    data: {
      ppo_number: header.ppo_number,
      checked: wos.length,
      ready,
      partial,
      blocked,
      results,
    },
    error: null,
  };
}

export async function releaseReadyWorkOrdersFromPPO(id, userId, selectedWoIds = null) {
  const { data: header, error: hErr } = await supabase
    .from('production_plan_orders')
    .select('id, ppo_number')
    .eq('id', id)
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr || { code: 'NOT_FOUND', status: 404, message: 'PPO not found.' } };
  }

  const readiness = await checkWOReadinessForPPO(id, { updateExecutionStatus: false });
  if (readiness.error) return { data: null, error: readiness.error };

  const { data: allWos, error: allErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, status, readiness_status')
    .eq('source_ppo_id', id)
    .eq('wo_kind', 'PPO_STAGE');

  if (allErr) return { data: null, error: allErr };

  const selectedSet = Array.isArray(selectedWoIds) && selectedWoIds.length
    ? new Set(selectedWoIds.map(String))
    : null;

  const candidateWos = selectedSet
    ? (allWos || []).filter(w => selectedSet.has(String(w.id)))
    : (allWos || []);

  const releasableDraftWos = candidateWos.filter(w =>
    String(w.status || '').toLowerCase() === 'draft' &&
    ['READY', 'PARTIAL'].includes(String(w.readiness_status || '').toUpperCase())
  );

  if (!releasableDraftWos.length) {
    return {
      data: {
        ppo_number: header.ppo_number,
        released: 0,
        skipped: selectedSet ? candidateWos.length : (allWos || []).length,
        message: selectedSet ? 'No selected READY/PARTIAL draft Work Orders available to release.' : 'No READY/PARTIAL draft Work Orders available to release.',
      },
      error: null,
    };
  }

  const woIds = releasableDraftWos.map(w => w.id);
  const now = new Date().toISOString();

  const { error: updErr } = await supabase
    .from('wo_headers')
    .update({
      status: 'released',
      released_by: userId,
      released_at: now,
      updated_by: userId,
      updated_at: now,
    })
    .in('id', woIds);

  if (updErr) return { data: null, error: updErr };

  const releasedCount = releasableDraftWos.length;
  const total = (allWos || []).length;
  const alreadyReleased = (allWos || []).filter(w => String(w.status || '').toLowerCase() === 'released').length;
  const totalReleasedAfter = alreadyReleased + releasedCount;

  await supabase
    .from('production_plan_orders')
    .update({
      execution_status: totalReleasedAfter >= total ? 'RELEASED' : 'PARTIALLY_RELEASED',
      released_by: userId,
      released_at: now,
      updated_at: now,
    })
    .eq('id', id);

  return {
    data: {
      ppo_number: header.ppo_number,
      released: releasedCount,
      skipped: selectedSet ? Math.max(0, candidateWos.length - releasedCount) : Math.max(0, total - releasedCount),
      released_wo_numbers: releasableDraftWos.map(w => w.wo_number),
    },
    error: null,
  };
}

export async function autoCompleteWorkOrderForLog(productionLogId, userId) {
  const { data: logRow, error: logErr } = await supabase
    .from('production_logs')
    .select('id, wo_id')
    .eq('id', productionLogId)
    .maybeSingle();
  if (logErr) return { data: null, error: logErr };
  const woId = logRow?.wo_id;
  if (!woId) return { data: { completed: false, reason: 'no_wo' }, error: null };

  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, planned_qty, status')
    .eq('id', woId)
    .maybeSingle();
  if (woErr) return { data: null, error: woErr };
  if (!wo) return { data: { completed: false, reason: 'no_wo' }, error: null };

  const status = String(wo.status || '').toLowerCase();
  if (status === 'completed' || status === 'closed' || status === 'cancelled') {
    return { data: { wo_id: woId, completed: false, reason: 'already_terminal' }, error: null };
  }
  const plannedQty = Number(wo.planned_qty || 0);
  if (plannedQty <= 0) return { data: { wo_id: woId, completed: false, reason: 'no_planned_qty' }, error: null };

  const { data: logs, error: sumErr } = await supabase
    .from('production_logs')
    .select('good_qty, entry_type, correction_delta_good_qty')
    .eq('wo_id', woId);
  if (sumErr) return { data: null, error: sumErr };

  const totalGood = (logs || []).reduce((sum, log) =>
    sum + (log.entry_type === 'CORRECTION'
      ? Number(log.correction_delta_good_qty || 0)
      : Number(log.good_qty || 0)), 0);

  if (totalGood < plannedQty) {
    return { data: { wo_id: woId, completed: false, total_good_qty: totalGood, planned_qty: plannedQty }, error: null };
  }

  const nowIso = new Date().toISOString();
  const { error: woUpErr } = await supabase
    .from('wo_headers')
    .update({ status: 'completed', completed_by: userId, completed_at: nowIso })
    .eq('id', woId);
  if (woUpErr) return { data: null, error: woUpErr };

  const { error: stepUpErr } = await supabase
    .from('wo_step_lines')
    .update({ step_status: 'completed' })
    .eq('wo_id', woId)
    .neq('step_status', 'completed');
  if (stepUpErr) return { data: null, error: stepUpErr };

  return { data: { wo_id: woId, completed: true, total_good_qty: totalGood, planned_qty: plannedQty }, error: null };
}

export async function autoAdvancePPOAfterProductionLog(productionLogId, userId) {
  if (!productionLogId) {
    return { data: { skipped: true, reason: 'No production log id.' }, error: null };
  }

  const { data: log, error: logErr } = await supabase
    .from('production_logs')
    .select('id, wo_id')
    .eq('id', productionLogId)
    .single();

  if (logErr || !log) {
    return { data: null, error: logErr || { code: 'NOT_FOUND', message: 'Production log not found.' } };
  }

  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, source_ppo_id')
    .eq('id', log.wo_id)
    .single();

  if (woErr || !wo) {
    return { data: null, error: woErr || { code: 'NOT_FOUND', message: 'Work order not found.' } };
  }

  if (!wo.source_ppo_id) {
    return { data: { skipped: true, reason: 'Work order has no source PPO.' }, error: null };
  }

  // Refresh-only: recompute readiness for this WO's PPO without changing
  // PPO execution_status and without auto-releasing. Release remains a
  // deliberate planner action.
  const readiness = await checkWOReadinessForPPO(wo.source_ppo_id, { updateExecutionStatus: false });
  if (readiness.error) {
    return { data: null, error: readiness.error };
  }

  return {
    data: {
      source_ppo_id: wo.source_ppo_id,
      readiness: readiness.data,
      auto_release: false,
    },
    error: null,
  };
}

export async function getProductionPlanTimelineLoad(id) {
  const base = await getProductionPlanOrderById(id);
  if (base.error) return { data: null, error: base.error };
  if (!base.data) return { data: null, error: { code: 'NOT_FOUND', message: 'PPO not found.' } };
  const header = base.data;

  const { data: wos, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, wo_number, item_id, stage_output_item_id, process_type_id, planned_qty, status, readiness_status, ready_to_start_qty, blocked_qty, assigned_worker_id, assigned_machine_id, planned_start_at, planned_end_at, estimated_minutes, created_at')
    .eq('source_ppo_id', id)
    .eq('wo_kind', 'PPO_STAGE')
    .order('created_at', { ascending: true });

  if (woErr) return { data: null, error: woErr };

  const woList = wos || [];
  const woIds = woList.map((w) => w.id);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];

  const itemIds = uniq([...woList.map((w) => w.item_id), ...woList.map((w) => w.stage_output_item_id)]);
  const processIds = uniq(woList.map((w) => w.process_type_id));
  const machineIds = uniq(woList.map((w) => w.assigned_machine_id));
  const workerIds = uniq(woList.map((w) => w.assigned_worker_id));

  const producedByWo = {};
  const scrapByWo = {};
  const actualStartByWo = {};
  const actualEndByWo = {};

  if (woIds.length) {
    const { data: logs, error: logErr } = await supabase
      .from('production_logs')
      .select('wo_id, good_qty, scrap_qty, entry_type, correction_delta_good_qty, correction_delta_scrap_qty, actual_start_at, actual_end_at')
      .in('wo_id', woIds);

    if (logErr) return { data: null, error: logErr };

    for (const lg of logs || []) {
      const goodQty = lg.entry_type === 'CORRECTION'
        ? Number(lg.correction_delta_good_qty || 0)
        : Number(lg.good_qty || 0);

      const scrapQty = lg.entry_type === 'CORRECTION'
        ? Number(lg.correction_delta_scrap_qty || 0)
        : Number(lg.scrap_qty || 0);

      producedByWo[lg.wo_id] = (producedByWo[lg.wo_id] || 0) + goodQty;
      scrapByWo[lg.wo_id] = (scrapByWo[lg.wo_id] || 0) + scrapQty;

      if (lg.actual_start_at && (!actualStartByWo[lg.wo_id] || lg.actual_start_at < actualStartByWo[lg.wo_id])) {
        actualStartByWo[lg.wo_id] = lg.actual_start_at;
      }

      if (lg.actual_end_at && (!actualEndByWo[lg.wo_id] || lg.actual_end_at > actualEndByWo[lg.wo_id])) {
        actualEndByWo[lg.wo_id] = lg.actual_end_at;
      }
    }
  }

  const buildMap = async (table, cols, ids) => {
    const map = {};
    if (!ids.length) return map;

    const { data } = await supabase
      .from(table)
      .select(cols)
      .in('id', ids);

    for (const row of data || []) {
      map[row.id] = row;
    }

    return map;
  };

  const itemMap = await buildMap('item_master', 'id, item_code, item_name', itemIds);
  const processMap = await buildMap('process_types', 'id, type_code, type_name, seq_no', processIds);
  const machineMap = await buildMap('machine_master', 'id, machine_code, machine_name', machineIds);
  const workerMap = await buildMap('worker_master', 'id, worker_code, worker_name', workerIds);

  let totalPlanned = 0;
  let totalCompleted = 0;
  let totalEstimated = 0;
  let capacityMissing = 0;
  let completedWos = 0;
  let runningWos = 0;
  let notStartedWos = 0;
  let blockedWos = 0;

  let chainCursorMs = Date.now();
  let projectedRows = 0;
  const rows = [];

  for (const wo of woList) {
    const plannedQty = Number(wo.planned_qty || 0);
    const completedQty = Math.max(0, Number(producedByWo[wo.id] || 0));
    const scrapQty = Number(scrapByWo[wo.id] || 0);
    const balanceQty = Math.max(0, plannedQty - completedQty);
    const progressPct = plannedQty > 0
      ? Math.round((completedQty / plannedQty) * 1000) / 10
      : 0;

    const status = String(wo.status || '').toLowerCase();
    const isCompleteStatus = status === 'completed' || status === 'closed';
    const isFullyComplete = isCompleteStatus || (plannedQty > 0 && completedQty >= plannedQty);

    if (isCompleteStatus) completedWos += 1;
    else if (status === 'released' || status === 'in_progress' || status === 'running') runningWos += 1;
    else notStartedWos += 1;

    const isBlocked = String(wo.readiness_status || '').toUpperCase() === 'BLOCKED';
    if (isBlocked) blockedWos += 1;

    let estimatedMinutes = null;
    let tentativeStartAt = null;
    let tentativeEndAt = null;
    let tentativeNote = null;
    let riskNote = null;

    if (isFullyComplete) {
      tentativeStartAt = actualStartByWo[wo.id] || null;
      tentativeEndAt = actualEndByWo[wo.id] || null;
      tentativeNote = 'Completed';
    } else if (wo.planned_start_at && wo.planned_end_at && wo.estimated_minutes != null) {
      estimatedMinutes = Number(wo.estimated_minutes);
      tentativeStartAt = wo.planned_start_at;
      tentativeEndAt = wo.planned_end_at;
      tentativeNote = 'From stored plan';
    } else {
      let expectedMinutes = null;

      try {
        const calc = await calculateWorkOrderExpectedMinutes(wo.id);
        if (calc && !calc.error && calc.data && calc.data.expected_minutes != null) {
          expectedMinutes = Number(calc.data.expected_minutes);
        }
      } catch {
        expectedMinutes = null;
      }

      if (expectedMinutes != null && !Number.isNaN(expectedMinutes)) {
        estimatedMinutes = expectedMinutes;
        const startMs = chainCursorMs;
        const endMs = startMs + expectedMinutes * 60000;
        chainCursorMs = endMs;
        tentativeStartAt = new Date(startMs).toISOString();
        tentativeEndAt = new Date(endMs).toISOString();
        tentativeNote = 'Serial v1 projection';
      } else {
        tentativeNote = 'Needs capacity setup';
        capacityMissing += 1;
      }
    }

    if (estimatedMinutes != null) {
      totalEstimated += estimatedMinutes;
      projectedRows += 1;
    }
    if (isBlocked && balanceQty > 0) riskNote = 'Blocked with pending qty';

    totalPlanned += plannedQty;
    totalCompleted += completedQty;

    const item = itemMap[wo.item_id] || {};
    const stageOutputItem = itemMap[wo.stage_output_item_id] || {};
    const process = processMap[wo.process_type_id] || {};
    const machine = machineMap[wo.assigned_machine_id] || {};
    const worker = workerMap[wo.assigned_worker_id] || {};

    rows.push({
      wo_id: wo.id,
      wo_number: wo.wo_number,
      item_code: item.item_code || null,
      item_name: item.item_name || null,
      stage_output_item_code: stageOutputItem.item_code || null,
      process_code: process.type_code || null,
      process_name: process.type_name || null,
      planned_qty: plannedQty,
      completed_qty: completedQty,
      scrap_qty: scrapQty,
      balance_qty: balanceQty,
      progress_pct: progressPct,
      status: wo.status,
      readiness_status: wo.readiness_status,
      assigned_worker_id: wo.assigned_worker_id || null,
      assigned_worker_code: worker.worker_code || null,
      assigned_worker_name: worker.worker_name || null,
      assigned_machine_id: wo.assigned_machine_id || null,
      assigned_machine_code: machine.machine_code || null,
      assigned_machine_name: machine.machine_name || null,
      planned_start_at: wo.planned_start_at || null,
      planned_end_at: wo.planned_end_at || null,
      actual_start_at: actualStartByWo[wo.id] || null,
      actual_end_at: actualEndByWo[wo.id] || null,
      estimated_minutes: estimatedMinutes,
      tentative_start_at: tentativeStartAt,
      tentative_end_at: tentativeEndAt,
      tentative_note: tentativeNote,
      risk_note: riskNote,
    });
  }

  const tentativeCompletionAt = capacityMissing === 0 && projectedRows > 0
    ? new Date(chainCursorMs).toISOString()
    : null;

  return {
    data: {
      header,
      summary: {
        total_wos: woList.length,
        completed_wos: completedWos,
        running_wos: runningWos,
        not_started_wos: notStartedWos,
        blocked_wos: blockedWos,
        total_planned_qty: totalPlanned,
        total_completed_qty: totalCompleted,
        total_balance_qty: Math.max(0, totalPlanned - totalCompleted),
        total_estimated_minutes: totalEstimated,
        tentative_completion_at: tentativeCompletionAt,
        capacity_missing_count: capacityMissing,
      },
      rows,
    },
    error: null,
  };
}
