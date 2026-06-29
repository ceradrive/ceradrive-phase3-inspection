import { supabase } from '../config/supabase.js';
import { checkTentativePlan } from './materialAvailabilityService.js';
import { createProductionPlanOrder } from './productionPlanOrderService.js';

/**
 * CERADRIVE ERP — MTO Planner service (Phase 1, READ-ONLY).
 * Sales-Order-based order-fulfilment worklist. No writes, no schema, no PPO create.
 * Order-card grouped: one card per sales order, item lines inside with independent readiness.
 */

const SFG_STAGES = new Set(['PF', 'SBBP', 'ACBP', 'MLD', 'GRD', 'PWC', 'CUR', 'STK']);
const BP_STAGES = new Set(['RM', 'BP']);
const DUE_SOON_DAYS = 7;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isDueSoon(deliveryDate) {
  if (!deliveryDate) return false;
  const d = new Date(deliveryDate);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + DUE_SOON_DAYS);
  return d <= limit;
}


export async function planMtoLineNow(payload, userId) {
  const soLineId = payload?.so_line_id || payload?.soLineId;

  if (!soLineId) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', status: 400, message: 'so_line_id is required.' },
    };
  }

  const { data: worklist, error: workErr } = await getMtoWorklist();
  if (workErr) return { data: null, error: workErr };

  let foundOrder = null;
  let foundLine = null;

  for (const order of worklist?.orders ?? []) {
    const line = (order.lines ?? []).find((x) => x.so_line_id === soLineId);
    if (line) {
      foundOrder = order;
      foundLine = line;
      break;
    }
  }

  if (!foundOrder || !foundLine) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', status: 404, message: 'Sales order line not found in MTO worklist.' },
    };
  }

  if (foundLine.status !== 'Plan Now') {
    return {
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        status: 400,
        message: `Line is not ready to plan. Current status: ${foundLine.status}.`,
      },
    };
  }

  const planQty = num(payload?.plan_qty ?? foundLine.ready_qty ?? foundLine.balance);
  if (planQty <= 0) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', status: 400, message: 'Plan quantity must be greater than zero.' },
    };
  }

  if (planQty > num(foundLine.balance)) {
    return {
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        status: 400,
        message: `Plan quantity ${planQty} cannot exceed open balance ${foundLine.balance}.`,
      },
    };
  }

  const { data: soLine, error: lineErr } = await supabase
    .from('sales_order_lines')
    .select('id, so_id, item_id, uom_id, qty')
    .eq('id', soLineId)
    .single();

  if (lineErr || !soLine) {
    return { data: null, error: lineErr || { code: 'NOT_FOUND', status: 404, message: 'Sales order line not found.' } };
  }

  const { data: soHeader, error: headerErr } = await supabase
    .from('sales_order_headers')
    .select('id, so_number, status')
    .eq('id', soLine.so_id)
    .single();

  if (headerErr || !soHeader) {
    return { data: null, error: headerErr || { code: 'NOT_FOUND', status: 404, message: 'Sales order header not found.' } };
  }

  if (!['approved', 'partially_planned', 'planned'].includes(String(soHeader.status || '').toLowerCase())) {
    return {
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        status: 400,
        message: `Sales order must be approved before planning. Current status: ${soHeader.status}.`,
      },
    };
  }

  const { data: item, error: itemErr } = await supabase
    .from('item_master')
    .select('id, item_code, item_name, uom_id, planning_unit, pcs_per_set')
    .eq('id', soLine.item_id)
    .single();

  if (itemErr || !item) {
    return { data: null, error: itemErr || { code: 'NOT_FOUND', status: 404, message: 'Item not found.' } };
  }

  const pcsPerSet = num(item.pcs_per_set, 4);
  const uomCode = String(item.planning_unit || '').toUpperCase();
  const productionPcs = uomCode === 'SET' ? planQty * pcsPerSet : planQty;

  const { data: ppo, error: ppoErr } = await createProductionPlanOrder({
    source_type: 'SALES_ORDER',
    source_ref_id: soHeader.id,
    material_status: 'READY',
    press_status: 'PLANNED',
    notes: `MTO Plan Now from ${soHeader.so_number} / ${item.item_code}. No WO auto-release.`,
    items: [{
      item_id: item.id,
      uom_id: soLine.uom_id || item.uom_id,
      approved_qty: planQty,
      production_pcs: productionPcs,
      uom_code: uomCode,
      pcs_per_set: item.pcs_per_set,
      source_type: 'SALES_ORDER',
      source_ref_id: soHeader.id,
      source_line_id: soLine.id,
      item_code: item.item_code,
    }],
  }, userId);

  if (ppoErr) return { data: null, error: ppoErr };

  return {
    data: {
      ppo,
      so_id: soHeader.id,
      so_number: soHeader.so_number,
      so_line_id: soLine.id,
      item_id: item.id,
      item_code: item.item_code,
      plan_qty: planQty,
      production_pcs: productionPcs,
    },
    error: null,
  };
}


export async function getMtoWorklist() {
  // 1. Sales order headers (demand source)
  const { data: headers, error: hErr } = await supabase
    .from('sales_order_headers')
    .select('id, so_number, customer_id, so_date, delivery_date, status, notes')
    .order('so_date', { ascending: true });
  if (hErr) return { data: null, error: hErr };

  // MRP-SO-2: exclude cancelled SOs from the planning board.
  const orderHeaders = (headers ?? []).filter((h) => String(h.status || '').toLowerCase() !== 'cancelled');
  if (!orderHeaders.length) {
    return { data: { orders: [], generated_at: new Date().toISOString() }, error: null };
  }

  const soIds = orderHeaders.map((h) => h.id);
  const customerIds = [...new Set(orderHeaders.map((h) => h.customer_id).filter(Boolean))];

  // 2. Customers (name + credit days)
  const { data: customers, error: cErr } = customerIds.length
    ? await supabase.from('customer_master').select('id, customer_name, credit_days').in('id', customerIds)
    : { data: [], error: null };
  if (cErr) return { data: null, error: cErr };
  const custById = new Map((customers ?? []).map((c) => [c.id, c]));

  // 3. Sales order lines (the FG demand)
  const { data: soLines, error: lErr } = await supabase
    .from('sales_order_lines')
    .select('id, so_id, line_number, item_id, uom_id, qty')
    .in('so_id', soIds);
  if (lErr) return { data: null, error: lErr };

  const lines = soLines ?? [];
  const fgIds = [...new Set(lines.map((l) => l.item_id).filter(Boolean))];
  const soLineIds = lines.map((l) => l.id);

  // 4. FG item master (code / name / planning unit)
  const { data: fgItems, error: fErr } = fgIds.length
    ? await supabase.from('item_master').select('id, item_code, item_name, planning_unit, pcs_per_set, uom_id').in('id', fgIds)
    : { data: [], error: null };
  if (fErr) return { data: null, error: fErr };
  const fgById = new Map((fgItems ?? []).map((i) => [i.id, i]));

  // MTO-UOM-1: resolve UOM codes — Sales UOM from the SO line (l.uom_id),
  // Production UOM from item_master (fg.uom_id). Never inferred from planning_unit.
  const uomIds = [...new Set([
    ...lines.map((l) => l.uom_id),
    ...(fgItems ?? []).map((i) => i.uom_id),
  ].filter(Boolean))];
  const { data: uomRows, error: uErr } = uomIds.length
    ? await supabase.from('uom_master').select('id, uom_code').in('id', uomIds)
    : { data: [], error: null };
  if (uErr) return { data: null, error: uErr };
  const uomCodeById = new Map((uomRows ?? []).map((u) => [u.id, String(u.uom_code || '').toUpperCase()]));

  // 5. Active recipe presence per FG
  const { data: activeRecipes, error: rErr } = fgIds.length
    ? await supabase.from('stage_recipe_headers').select('fg_item_id, status').eq('status', 'active').in('fg_item_id', fgIds)
    : { data: [], error: null };
  if (rErr) return { data: null, error: rErr };
  const fgWithActiveRecipe = new Set((activeRecipes ?? []).map((r) => r.fg_item_id));

  // 6. FG stock = SUM(quantity) by item_id across warehouses
  const { data: stockRows, error: sErr } = fgIds.length
    ? await supabase.from('inventory_balance').select('item_id, quantity').in('item_id', fgIds)
    : { data: [], error: null };
  if (sErr) return { data: null, error: sErr };
  const fgStockById = new Map();
  for (const row of stockRows ?? []) {
    fgStockById.set(row.item_id, (fgStockById.get(row.item_id) || 0) + num(row.quantity));
  }

  // 7. Already planned per SO line (order-linked PPO lines, non-cancelled)
  const { data: ppoLines, error: pErr } = soLineIds.length
    ? await supabase
        .from('production_plan_order_lines')
        .select('plan_order_id, item_id, approved_qty, source_type, source_line_id, status')
        .eq('source_type', 'SALES_ORDER')
        .in('source_line_id', soLineIds)
    : { data: [], error: null };
  if (pErr) return { data: null, error: pErr };

  const ppoLineRows = ppoLines ?? [];
  const planOrderIds = [...new Set(ppoLineRows.map((x) => x.plan_order_id).filter(Boolean))];
  let cancelledPlanOrders = new Set();
  if (planOrderIds.length) {
    const { data: ppoHeaders, error: phErr } = await supabase
      .from('production_plan_orders')
      .select('id, plan_status')
      .in('id', planOrderIds);
    if (phErr) return { data: null, error: phErr };
    cancelledPlanOrders = new Set(
      (ppoHeaders ?? [])
        .filter((x) => String(x.plan_status).toUpperCase() === 'CANCELLED')
        .map((x) => x.id),
    );
  }
  const plannedBySoLine = new Map();
  for (const row of ppoLineRows) {
    if (String(row.status).toUpperCase() === 'CANCELLED') continue;
    if (cancelledPlanOrders.has(row.plan_order_id)) continue;
    plannedBySoLine.set(row.source_line_id, (plannedBySoLine.get(row.source_line_id) || 0) + num(row.approved_qty));
  }

  // 7b. FG-STORE on-hand per FG item (ready-for-dispatch; FG-STORE warehouse only). Read-only.
  let fgStoreStockById = new Map();
  {
    const { data: fgWh } = await supabase
      .from('warehouse_master')
      .select('id, warehouse_code')
      .eq('warehouse_code', 'FG-STORE')
      .limit(1)
      .maybeSingle();
    if (fgWh?.id && fgIds.length) {
      const { data: fgBal } = await supabase
        .from('inventory_balance')
        .select('item_id, quantity')
        .eq('warehouse_id', fgWh.id)
        .in('item_id', fgIds);
      fgStoreStockById = new Map((fgBal ?? []).map((b) => [b.item_id, num(b.quantity)]));
    }
  }

  // 7c. Produced / completed per SO line (final-stage lot-stamped WOs + their logs). Read-only.
  const producedBySoLine = new Map();
  const completedBySoLine = new Map();
  const woCountBySoLine = new Map();
  if (soLineIds.length) {
    const { data: lotWos } = await supabase
      .from('wo_headers')
      .select('id, source_sales_order_line_id, stage_output_item_id, status')
      .in('source_sales_order_line_id', soLineIds);
    const finalWos = (lotWos ?? []).filter((w) => {
      const ln = lines.find((x) => x.id === w.source_sales_order_line_id);
      return ln && w.stage_output_item_id === ln.item_id;
    });
    for (const w of finalWos) {
      woCountBySoLine.set(w.source_sales_order_line_id, (woCountBySoLine.get(w.source_sales_order_line_id) || 0) + 1);
    }
    const finalWoIds = finalWos.map((w) => w.id);
    const goodByWo = new Map();
    if (finalWoIds.length) {
      const { data: pLogs } = await supabase
        .from('production_logs')
        .select('wo_id, good_qty, entry_type, correction_delta_good_qty')
        .in('wo_id', finalWoIds);
      for (const lg of pLogs ?? []) {
        const g = lg.entry_type === 'CORRECTION' ? num(lg.correction_delta_good_qty) : num(lg.good_qty);
        goodByWo.set(lg.wo_id, (goodByWo.get(lg.wo_id) || 0) + g);
      }
    }
    for (const w of finalWos) {
      const g = goodByWo.get(w.id) || 0;
      producedBySoLine.set(w.source_sales_order_line_id, (producedBySoLine.get(w.source_sales_order_line_id) || 0) + g);
      if (String(w.status || '').toLowerCase() === 'completed') {
        completedBySoLine.set(w.source_sales_order_line_id, (completedBySoLine.get(w.source_sales_order_line_id) || 0) + g);
      }
    }
  }

  // 8. Group lines under their order + compute readiness
  const linesBySo = new Map();
  for (const l of lines) {
    if (!linesBySo.has(l.so_id)) linesBySo.set(l.so_id, []);
    linesBySo.get(l.so_id).push(l);
  }

  const STATUS_RANK = { 'Plan Now': 0, Partial: 1, Blocked: 2, Done: 3 };
  const orders = [];

  for (const h of orderHeaders) {
    const cust = custById.get(h.customer_id);
    const dueSoon = isDueSoon(h.delivery_date);
    const outLines = [];

    for (const l of linesBySo.get(h.id) ?? []) {
      const fg = fgById.get(l.item_id);
      const orderQty = num(l.qty);
      const fgStock = fgStockById.get(l.item_id) || 0;
      const alreadyPlanned = plannedBySoLine.get(l.id) || 0;
      const producedQty = producedBySoLine.get(l.id) || 0;
      const completedQty = completedBySoLine.get(l.id) || 0;
      const readyFgQty = fgStoreStockById.get(l.item_id) || 0;
      const woCount = woCountBySoLine.get(l.id) || 0;
      const balance = Math.max(0, orderQty - fgStock - alreadyPlanned);
      const covered = Math.max(0, orderQty - balance);
      const hasActiveRecipe = fgWithActiveRecipe.has(l.item_id);

      let material = { status: 'SKIPPED', sfg_short: false, bp_short: false };
      if (balance > 0 && hasActiveRecipe && fg?.item_code) {
        const { data: matData } = await checkTentativePlan([{ item_code: fg.item_code, approved_qty: balance }]);
        const matLines = matData?.lines ?? [];
        const sfgShort = matLines.some((x) => x.status === 'SHORT' && SFG_STAGES.has(String(x.stage_type)));
        const bpShort = matLines.some((x) => x.status === 'SHORT' && BP_STAGES.has(String(x.stage_type)));
        material = { status: matData?.material_status ?? 'SHORTAGE', sfg_short: sfgShort, bp_short: bpShort };
      }

      let status;
      if (balance === 0) status = 'Done';
      else if (!hasActiveRecipe) status = 'Blocked';
      else if (material.status === 'READY') status = covered > 0 ? 'Partial' : 'Plan Now';
      else status = 'Blocked';

      const readyQty = material.status === 'READY' ? balance : 0;
      const pendingQty = balance - readyQty;

      let line_status;
      if (orderQty > 0 && completedQty >= orderQty) line_status = 'Ready for Dispatch';
      else if (producedQty > 0 || woCount > 0) line_status = 'In Production';
      else if (alreadyPlanned > 0) line_status = 'Planned';
      else line_status = status;

      const chips = [];
      if (material.status === 'READY') chips.push('Material ready');
      if (fgStock > 0) chips.push('FG stock available');
      if (material.sfg_short) chips.push('SFG shortage');
      if (material.bp_short) chips.push('BP shortage');
      if (!hasActiveRecipe) chips.push('No active recipe');

      let guidance;
      if (status === 'Done') guidance = 'Already covered by stock/plan';
      else if (status === 'Plan Now') guidance = `Plan this line now (${readyQty})`;
      else if (status === 'Partial') guidance = `${covered} covered by stock/plan, plan ${balance}`;
      else if (!hasActiveRecipe) guidance = 'No active recipe — build/activate first';
      else {
        const what = material.bp_short && material.sfg_short ? 'BP & SFG short'
          : material.bp_short ? 'BP short'
          : material.sfg_short ? 'SFG short'
          : 'material short';
        guidance = `Blocked — ${what}`;
      }

      // MTO-UOM-1: Sales UOM from the SO line (l.uom_id); Production UOM from item_master (fg.uom_id).
      const salesUom = uomCodeById.get(l.uom_id) || '';
      const productionUom = uomCodeById.get(fg?.uom_id) || 'PCS';
      const orderUom = salesUom || productionUom || 'PCS';
      const orderPcsPerSet = num(fg?.pcs_per_set) || 1;            // column only; identity fallback, never 0/hardcoded
      // SET -> PCS conversion only when the SALES line is in SET; otherwise production qty == sales qty.
      const orderConvertedPcs = salesUom === 'SET' ? orderQty * orderPcsPerSet : orderQty;
      outLines.push({
        so_line_id: l.id,
        fg_item_id: l.item_id,
        fg_item_code: fg?.item_code ?? null,
        fg_item_name: fg?.item_name ?? null,
        order_qty: orderQty,
        order_uom: orderUom,                 // MTO-UOM-1: Sales UOM (from SO line uom_id)
        sales_uom: salesUom,                 // MTO-UOM-1: authoritative sales unit
        production_uom: productionUom,       // MTO-UOM-1: Production UOM (from item_master.uom_id)
        pcs_per_set: orderPcsPerSet,         // MTO-UOM-1
        converted_pcs: orderConvertedPcs,    // MTO-UOM-1: sales qty x pcs_per_set when Sales UOM = SET
        production_qty: orderConvertedPcs,   // MTO-UOM-1: explicit production demand
        fg_stock: fgStock,
        already_planned: alreadyPlanned,
        planned_qty: alreadyPlanned,
        produced_qty: producedQty,
        completed_qty: completedQty,
        ready_fg_qty: readyFgQty,
        dispatched_qty: null,
        line_status,
        balance,
        ready_qty: readyQty,
        pending_qty: pendingQty,
        status,
        has_active_recipe: hasActiveRecipe,
        material,
        chips,
        guidance,
      });
    }

    outLines.sort((a, b) =>
      (STATUS_RANK[a.status] - STATUS_RANK[b.status]) ||
      String(a.fg_item_code || '').localeCompare(String(b.fg_item_code || '')),
    );

    const totalOrderQty = outLines.reduce((s, x) => s + num(x.order_qty), 0);
    const totalCompletedQty = outLines.reduce((s, x) => s + num(x.completed_qty), 0);
    const summary = {
      total_lines: outLines.length,
      ready: outLines.filter((x) => x.status === 'Plan Now').length,
      partial: outLines.filter((x) => x.status === 'Partial').length,
      blocked: outLines.filter((x) => x.status === 'Blocked').length,
      ready_lines: outLines.filter((x) => x.status === 'Plan Now' || x.status === 'Partial').length,
      blocked_lines: outLines.filter((x) => x.status === 'Blocked').length,
      in_production_lines: outLines.filter((x) => x.line_status === 'In Production').length,
      ready_for_dispatch_lines: outLines.filter((x) => x.line_status === 'Ready for Dispatch').length,
      fulfillment_pct: totalOrderQty > 0 ? Math.round((totalCompletedQty / totalOrderQty) * 100) : 0,
    };
    const cardStatus = (summary.ready + summary.partial) > 0
      ? 'ATTENTION'
      : (summary.blocked > 0 ? 'BLOCKED' : 'DONE');

    orders.push({
      so_id: h.id,
      so_number: h.so_number,
      customer_id: h.customer_id,
      customer_name: cust?.customer_name ?? null,
      delivery_date: h.delivery_date ?? null,
      credit_days: cust?.credit_days ?? null,
      priority: 'MED',
      lot_label: 'Customer lot',
      due_soon: dueSoon,
      card_status: cardStatus,
      summary,
      lines: outLines,
    });
  }

  // Card sort (data-driven; client pins manual HIGH on top)
  const CARD_RANK = { ATTENTION: 0, BLOCKED: 1, DONE: 2 };
  orders.sort((a, b) => {
    const cr = CARD_RANK[a.card_status] - CARD_RANK[b.card_status];
    if (cr) return cr;
    if (a.due_soon !== b.due_soon) return a.due_soon ? -1 : 1;
    const ad = a.delivery_date || '9999-12-31';
    const bd = b.delivery_date || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.so_number).localeCompare(String(b.so_number));
  });

  return { data: { orders, generated_at: new Date().toISOString() }, error: null };
}
