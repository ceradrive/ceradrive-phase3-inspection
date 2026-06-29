import { supabase } from '../config/supabase.js';

const MAX_RECIPE_EXPLOSION_DEPTH = 50;

export async function checkRequirement(requirementId) {
  const { data: req, error: rErr } = await supabase
    .from('production_requirement_queue')
    .select('id, item_id, required_qty, required_uom_id, item:item_master(id,item_code,item_name), uom:uom_master(id,uom_code)')
    .eq('id', requirementId)
    .single();

  if (rErr || !req) {
    return { data: null, error: rErr ?? { code: 'NOT_FOUND', message: 'Requirement not found.' } };
  }

  const { data: steps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select('id, output_item_id')
    .eq('output_item_id', req.item_id);

  if (sErr) return { data: null, error: sErr };

  const stepIds = (steps ?? []).map(s => s.id);
  if (!stepIds.length) return { data: { requirement: req, lines: [] }, error: null };

  const { data: inputs, error: iErr } = await supabase
    .from('stage_recipe_inputs')
    .select('input_item_id, qty, uom_id, qty_basis, input_item:item_master(id,item_code,item_name), uom:uom_master(id,uom_code)')
    .in('step_id', stepIds);

  if (iErr) return { data: null, error: iErr };

  const lines = [];

  for (const input of inputs ?? []) {
    const requiredQty = Number(input.qty || 0) * Number(req.required_qty || 0);

    const { data: stockRows } = await supabase
      .from('inventory_balance')
      .select('quantity, uom_id, uom:uom_master(id,uom_code)')
      .eq('item_id', input.input_item_id);

    let availableQty = 0;

    for (const st of stockRows ?? []) {
      if (st.uom_id === input.uom_id) {
        availableQty += Number(st.quantity || 0);
      } else {
        const { data: conv } = await supabase
          .from('uom_conversions')
          .select('conversion_factor')
          .eq('from_uom_id', st.uom_id)
          .eq('to_uom_id', input.uom_id)
          .eq('is_active', true)
          .maybeSingle();

        if (conv?.conversion_factor) {
          availableQty += Number(st.quantity || 0) * Number(conv.conversion_factor);
        }
      }
    }

    let displayRequiredQty = requiredQty;
    let displayAvailableQty = availableQty;
    let displayShortageQty = Math.max(0, requiredQty - availableQty);
    let displayUom = input.uom?.uom_code;

    const firstStock = (stockRows ?? [])[0];
    if (firstStock?.uom_id && firstStock.uom_id !== input.uom_id) {
      const { data: displayConv } = await supabase
        .from('uom_conversions')
        .select('conversion_factor')
        .eq('from_uom_id', input.uom_id)
        .eq('to_uom_id', firstStock.uom_id)
        .eq('is_active', true)
        .maybeSingle();

      if (displayConv?.conversion_factor) {
        displayRequiredQty = requiredQty * Number(displayConv.conversion_factor);
        displayAvailableQty = displayAvailableQty * Number(displayConv.conversion_factor);
        displayShortageQty = Math.max(0, displayRequiredQty - displayAvailableQty);
        displayUom = firstStock.uom?.uom_code || displayUom;
      }
    }

    lines.push({
      item_code: input.input_item?.item_code,
      item_name: input.input_item?.item_name,
      required_qty: displayRequiredQty,
      required_uom: displayUom,
      available_qty: displayAvailableQty,
      shortage_qty: displayShortageQty,
      status: availableQty >= requiredQty ? 'available' : 'short',
    });
  }

  return { data: { requirement: req, lines }, error: null };
}


async function convertQty(qty, fromUomId, toUomId) {
  if (!fromUomId || !toUomId || fromUomId === toUomId) return Number(qty || 0);

  const { data: direct } = await supabase
    .from('uom_conversions')
    .select('conversion_factor')
    .eq('from_uom_id', fromUomId)
    .eq('to_uom_id', toUomId)
    .eq('is_active', true)
    .maybeSingle();

  if (direct?.conversion_factor) {
    return Number(qty || 0) * Number(direct.conversion_factor);
  }

  const { data: reverse } = await supabase
    .from('uom_conversions')
    .select('conversion_factor')
    .eq('from_uom_id', toUomId)
    .eq('to_uom_id', fromUomId)
    .eq('is_active', true)
    .maybeSingle();

  if (reverse?.conversion_factor) {
    return Number(qty || 0) / Number(reverse.conversion_factor);
  }

  return null;
}

async function getStockInUom(itemId, targetUomId) {
  const { data: stockRows, error } = await supabase
    .from('inventory_balance')
    .select('quantity, uom_id')
    .eq('item_id', itemId);

  if (error) throw error;

  let available = 0;

  for (const row of stockRows ?? []) {
    const converted = await convertQty(Number(row.quantity || 0), row.uom_id, targetUomId);
    if (converted !== null) available += converted;
  }

  return available;
}

async function getStockInUomBatch(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const itemIds = [...new Set(list.map((x) => x?.item_id).filter(Boolean))];
  const out = new Map();

  for (const entry of list) {
    if (entry?.item_id) out.set(`${entry.item_id}:${entry.uom_id || ''}`, 0);
  }

  if (!itemIds.length) return out;

  const { data: stockRows, error } = await supabase
    .from('inventory_balance')
    .select('item_id, quantity, uom_id')
    .in('item_id', itemIds);

  if (error) throw error;

  const stockByItem = new Map();
  for (const row of stockRows ?? []) {
    if (!stockByItem.has(row.item_id)) stockByItem.set(row.item_id, []);
    stockByItem.get(row.item_id).push(row);
  }

  for (const entry of list) {
    if (!entry?.item_id) continue;
    const key = `${entry.item_id}:${entry.uom_id || ''}`;
    let available = 0;
    for (const row of stockByItem.get(entry.item_id) ?? []) {
      const converted = await convertQty(Number(row.quantity || 0), row.uom_id, entry.uom_id);
      if (converted !== null) available += converted;
    }
    out.set(key, available);
  }

  return out;
}

function roundQty(n) {
  return Number(Number(n || 0).toFixed(4));
}

export async function checkTentativePlan(items = []) {
  const inputItems = Array.isArray(items) ? items : [];
  const codes = inputItems.map((x) => x.item_code).filter(Boolean);

  if (!codes.length) {
    return {
      data: {
        material_status: 'NO_ITEMS',
        execution_status: 'BLOCKED',
        lines: [],
      },
      error: null,
    };
  }

  const { data: fgItems, error: fgErr } = await supabase
    .from('item_master')
    .select('id,item_code,item_name,pcs_per_set,planning_unit')
    .in('item_code', codes);

  if (fgErr) return { data: null, error: fgErr };

  const fgByCode = new Map((fgItems ?? []).map((x) => [x.item_code, x]));
  const fgIds = (fgItems ?? []).map((x) => x.id);

  const { data: headers, error: hErr } = await supabase
    .from('stage_recipe_headers')
    .select('id,fg_item_id,recipe_code,status'); // MATROOT: load all recipes for full-chain explosion to RM/BP | FIXB: status for active-only bridge

  if (hErr) return { data: null, error: hErr };

  const headerByFgId = new Map((headers ?? []).map((x) => [x.fg_item_id, x]));
  const recipeIds = (headers ?? []).map((x) => x.id);

  const { data: steps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select('id,recipe_id,step_no,output_item_id')
    .in('recipe_id', recipeIds);

  if (sErr) return { data: null, error: sErr };

  const stepIds = (steps ?? []).map((x) => x.id);

  const { data: inputs, error: iErr } = await supabase
    .from('stage_recipe_inputs')
    .select(`
      step_id,
      input_item_id,
      qty,
      qty_basis,
      uom_id,
      input_item:item_master(
        id,
        item_code,
        item_name,
        stage_type,
        is_manufactured,
        is_purchasable,
        is_stocked
      ),
      uom:uom_master(id,uom_code)
    `)
    .in('step_id', stepIds);

  if (iErr) return { data: null, error: iErr };

  const { data: uoms, error: uomErr } = await supabase
    .from('uom_master')
    .select('id,uom_code');

  if (uomErr) return { data: null, error: uomErr };

  const uomByCode = new Map((uoms ?? []).map((u) => [u.uom_code, u]));
  const itemLabelById = new Map();

  for (const item of fgItems ?? []) {
    itemLabelById.set(item.id, item.item_code || item.item_name || item.id);
  }

  for (const input of inputs ?? []) {
    if (input.input_item?.id) {
      itemLabelById.set(input.input_item.id, input.input_item.item_code || input.input_item.item_name || input.input_item.id);
    }
  }

  const stepByOutput = new Map();
  const inputsByStep = new Map();

  for (const step of steps ?? []) {
    stepByOutput.set(`${step.recipe_id}:${step.output_item_id}`, step);
  }

  for (const input of inputs ?? []) {
    if (!inputsByStep.has(input.step_id)) inputsByStep.set(input.step_id, []);
    inputsByStep.get(input.step_id).push(input);
  }

  // FIX-B: active-recipe output_item_id bridge. When a manufactured leaf is not
  // produced by a same-recipe childStep and not by an fg_item_id header, but IS
  // the output_item_id of a step in ANOTHER active recipe, recurse into it.
  // All recipe steps are already loaded (steps were fetched for every header id),
  // so no extra DB read is required here.
  const activeRecipeIds = new Set(
    (headers ?? [])
      .filter((h) => String(h.status || '').toLowerCase() === 'active')
      .map((h) => h.id)
  );
  const bridgeStepsByOutput = new Map(); // output_item_id -> [step,...] (active recipes only)
  for (const step of steps ?? []) {
    if (!activeRecipeIds.has(step.recipe_id)) continue;
    if (!bridgeStepsByOutput.has(step.output_item_id)) bridgeStepsByOutput.set(step.output_item_id, []);
    bridgeStepsByOutput.get(step.output_item_id).push(step);
  }
  const bridgeNotes = []; // FIXB: ambiguity / cycle diagnostics, surfaced via unresolved_items
  function resolveBridgeStep(itemId, pathKeysSoFar) {
    const producers = bridgeStepsByOutput.get(itemId) || [];
    if (!producers.length) return null;
    if (producers.length > 1) {
      bridgeNotes.push({ item_id: itemId, reason: 'AMBIGUOUS_PRODUCER' }); // FIXB ambiguity guard: do not pick silently
      return null;
    }
    // FIXB cross-recipe cycle guard: pathKeys are `${recipeId}:${itemId}`.
    const visitedItems = new Set((pathKeysSoFar || []).map((k) => String(k).split(':')[1]));
    if (visitedItems.has(String(itemId))) {
      bridgeNotes.push({ item_id: itemId, reason: 'RECIPE_CYCLE_BRIDGE' });
      return null;
    }
    return producers[0];
  }

  const materialMap = new Map();

  function addMaterial(inputItem, qty, uomId, uomCode, source) {
    const key = `${inputItem.id}:${uomId}`;
    const existing = materialMap.get(key) || {
      item_id: inputItem.id,
      item_code: inputItem.item_code,
      item_name: inputItem.item_name,
      stage_type: inputItem.stage_type,
      is_purchasable: inputItem.is_purchasable, /* MATCLASS */
      is_manufactured: inputItem.is_manufactured,
      is_stocked: inputItem.is_stocked,
      required_qty: 0,
      uom_id: uomId,
      required_uom: uomCode,
      sources: new Set(),
    };

    existing.required_qty += Number(qty || 0);
    existing.sources.add(source);
    materialMap.set(key, existing);
  }

  async function explode(recipeId, outputItemId, requiredQty, requiredUomId, requiredUomCode, sourceCode, pathKeys = [], depth = 0) {
    const pathKey = `${recipeId}:${outputItemId}`;

    if (pathKeys.includes(pathKey)) {
      const cyclePath = [...pathKeys, pathKey]
        .map((key) => itemLabelById.get(key.split(':')[1]) || key.split(':')[1])
        .join(' -> ');

      throw {
        code: 'VALIDATION_ERROR',
        message: `Recipe cycle detected while checking material availability: ${cyclePath}`,
      };
    }

    if (depth >= MAX_RECIPE_EXPLOSION_DEPTH) {
      throw {
        code: 'VALIDATION_ERROR',
        message: `Recipe explosion exceeded maximum depth of ${MAX_RECIPE_EXPLOSION_DEPTH}. Please check recipe stage links.`,
      };
    }

    const step = stepByOutput.get(pathKey);
    if (!step) return;

    const nextPathKeys = [...pathKeys, pathKey];
    const stepInputs = inputsByStep.get(step.id) || [];

    const hasBatchInputs = stepInputs.some((x) => String(x.qty_basis || '').toUpperCase() === 'PER_BATCH');

    if (hasBatchInputs) {
      const batchInputs = stepInputs.filter((x) => String(x.qty_basis || '').toUpperCase() === 'PER_BATCH');

      const baseUomId = batchInputs[0]?.uom_id;
      const baseUomCode = batchInputs[0]?.uom?.uom_code;
      const requiredInBase = await convertQty(requiredQty, requiredUomId, baseUomId);

      if (requiredInBase === null) {
        for (const input of batchInputs) {
          const fallbackQty = Number(input.qty || 0);
          addMaterial(input.input_item, fallbackQty, input.uom_id, input.uom?.uom_code, sourceCode);
          // PER_BATCH recursion fix (FIX-A): do not drop the chain just because
          // basis is PER_BATCH. Mirror the non-batch branch's recurse condition.
          const childStep = stepByOutput.get(`${recipeId}:${input.input_item_id}`);
          const subHeader = (!childStep && input.input_item?.is_manufactured) ? headerByFgId.get(input.input_item_id) : null;
          const bridgeStep = (!childStep && !subHeader && input.input_item?.is_manufactured)
            ? resolveBridgeStep(input.input_item_id, nextPathKeys) : null; // FIXB cross-recipe bridge
          if (input.input_item?.is_manufactured && (childStep || subHeader || bridgeStep)) {
            if (childStep) {
              await explode(recipeId, input.input_item_id, fallbackQty, input.uom_id, input.uom?.uom_code, sourceCode, nextPathKeys, depth + 1);
            } else if (subHeader) {
              await explode(subHeader.id, input.input_item_id, fallbackQty, input.uom_id, input.uom?.uom_code, sourceCode, nextPathKeys, depth + 1);
            } else {
              await explode(bridgeStep.recipe_id, input.input_item_id, fallbackQty, input.uom_id, input.uom?.uom_code, sourceCode, nextPathKeys, depth + 1);
            }
          }
        }
        return;
      }

      let totalBatch = 0;
      const convertedBatch = [];

      for (const input of batchInputs) {
        const componentQty = await convertQty(Number(input.qty || 0), input.uom_id, baseUomId);
        const safeQty = componentQty === null ? Number(input.qty || 0) : componentQty;
        totalBatch += safeQty;
        convertedBatch.push({ input, componentQty: safeQty });
      }

      for (const row of convertedBatch) {
        const ratio = totalBatch > 0 ? row.componentQty / totalBatch : 0;
        const reqQtyBase = requiredInBase * ratio;
        const reqQtyInputUom = await convertQty(reqQtyBase, baseUomId, row.input.uom_id);
        const finalQty = reqQtyInputUom ?? reqQtyBase;

        addMaterial(
          row.input.input_item,
          finalQty,
          row.input.uom_id,
          row.input.uom?.uom_code || baseUomCode,
          sourceCode
        );

        // PER_BATCH recursion fix (FIX-A): still recurse into manufactured/internal
        // inputs using the SAME computed qty. Mirror the non-batch branch.
        const childStep = stepByOutput.get(`${recipeId}:${row.input.input_item_id}`);
        const subHeader = (!childStep && row.input.input_item?.is_manufactured) ? headerByFgId.get(row.input.input_item_id) : null;
        const bridgeStep = (!childStep && !subHeader && row.input.input_item?.is_manufactured)
          ? resolveBridgeStep(row.input.input_item_id, nextPathKeys) : null; // FIXB cross-recipe bridge
        if (row.input.input_item?.is_manufactured && (childStep || subHeader || bridgeStep)) {
          if (childStep) {
            await explode(recipeId, row.input.input_item_id, finalQty, row.input.uom_id, row.input.uom?.uom_code || baseUomCode, sourceCode, nextPathKeys, depth + 1);
          } else if (subHeader) {
            await explode(subHeader.id, row.input.input_item_id, finalQty, row.input.uom_id, row.input.uom?.uom_code || baseUomCode, sourceCode, nextPathKeys, depth + 1);
          } else {
            await explode(bridgeStep.recipe_id, row.input.input_item_id, finalQty, row.input.uom_id, row.input.uom?.uom_code || baseUomCode, sourceCode, nextPathKeys, depth + 1);
          }
        }
      }

      return;
    }

    for (const input of stepInputs) {
      const inputRequiredQty = Number(requiredQty || 0) * Number(input.qty || 0);
      const inputItem = input.input_item;
      const inputUomId = input.uom_id;
      const inputUomCode = input.uom?.uom_code;

      const childStep = stepByOutput.get(`${recipeId}:${input.input_item_id}`);
      const subHeader = (!childStep && inputItem?.is_manufactured) ? headerByFgId.get(input.input_item_id) : null; // MATROOT
      const bridgeStep = (!childStep && !subHeader && inputItem?.is_manufactured)
        ? resolveBridgeStep(input.input_item_id, nextPathKeys) : null; // FIXB cross-recipe bridge

      if (inputItem?.is_manufactured && (childStep || subHeader || bridgeStep)) {
        // MATROOT: record the intermediate WIP requirement (secondary) then keep exploding to root RM/BP
        addMaterial(inputItem, inputRequiredQty, inputUomId, inputUomCode, sourceCode);
        if (childStep) {
          await explode(recipeId, input.input_item_id, inputRequiredQty, inputUomId, inputUomCode, sourceCode, nextPathKeys, depth + 1);
        } else if (subHeader) {
          await explode(subHeader.id, input.input_item_id, inputRequiredQty, inputUomId, inputUomCode, sourceCode, nextPathKeys, depth + 1);
        } else {
          await explode(bridgeStep.recipe_id, input.input_item_id, inputRequiredQty, inputUomId, inputUomCode, sourceCode, nextPathKeys, depth + 1);
        }
      } else {
        addMaterial(inputItem, inputRequiredQty, inputUomId, inputUomCode, sourceCode);
      }
    }
  }

  // MATSRC: direct-stage source for planned items with NO direct recipe header
  const noHeaderFgIds = fgIds.filter((id) => !headerByFgId.has(id));
  const outputStepByItem = new Map();
  const inputsByOutputStep = new Map();
  if (noHeaderFgIds.length) {
    const { data: oSteps, error: oStepErr } = await supabase
      .from('stage_recipe_steps')
      .select('id, recipe_id, output_item_id')
      .in('output_item_id', noHeaderFgIds);
    if (oStepErr) return { data: null, error: oStepErr };
    for (const st of oSteps ?? []) {
      if (!outputStepByItem.has(st.output_item_id)) outputStepByItem.set(st.output_item_id, st);
    }
    const oStepIds = (oSteps ?? []).map((st) => st.id);
    if (oStepIds.length) {
      const { data: oInputs, error: oInErr } = await supabase
        .from('stage_recipe_inputs')
        .select(`
          step_id,
          input_item_id,
          qty,
          qty_basis,
          uom_id,
          input_item:item_master(id,item_code,item_name,stage_type,is_manufactured,is_purchasable,is_stocked),
          uom:uom_master(id,uom_code)
        `)
        .in('step_id', oStepIds);
      if (oInErr) return { data: null, error: oInErr };
      for (const inp of oInputs ?? []) {
        if (!inputsByOutputStep.has(inp.step_id)) inputsByOutputStep.set(inp.step_id, []);
        inputsByOutputStep.get(inp.step_id).push(inp);
      }
    }
  }

  const unresolvedItems = []; // MATSRC
  try {
    for (const planItem of inputItems) {
      const fg = fgByCode.get(planItem.item_code);
      if (!fg) { unresolvedItems.push({ item_code: planItem.item_code, reason: 'ITEM_NOT_FOUND' }); continue; }

      const approvedQty = Number(planItem.approved_qty || planItem.suggested_qty || 0);
      const uomCode = String(planItem.uom_code || fg.planning_unit || 'SET').toUpperCase();
      const uom = uomByCode.get(uomCode);

      const header = headerByFgId.get(fg.id);
      if (header) {
        await explode(header.id, fg.id, approvedQty, uom?.id, uom?.uom_code || uomCode, planItem.item_code);
        continue;
      }

      // MATSRC: no direct header -> use the step whose output = planned item.
      // MRP-DEEP-SHORTAGE-1: when a direct input is itself manufactured, keep exploding to
      // RM/BP through its own recipe header (subHeader) or a unique active-recipe bridge, so
      // no-header SET/STK items surface deep BP/MIX/RM shortage (not just the first stage).
      const oStep = outputStepByItem.get(fg.id);
      const oInputs = oStep ? (inputsByOutputStep.get(oStep.id) || []) : [];
      if (oInputs.length) {
        for (const inp of oInputs) {
          if (!inp.input_item) continue;
          const reqQty = approvedQty * Number(inp.qty || 0);
          addMaterial(inp.input_item, reqQty, inp.uom_id, inp.uom?.uom_code, planItem.item_code);
          if (inp.input_item?.is_manufactured) {
            const subHeader = headerByFgId.get(inp.input_item_id);
            const bridgeStep = !subHeader ? resolveBridgeStep(inp.input_item_id, []) : null;
            if (subHeader) {
              await explode(subHeader.id, inp.input_item_id, reqQty, inp.uom_id, inp.uom?.uom_code, planItem.item_code, [], 0);
            } else if (bridgeStep) {
              await explode(bridgeStep.recipe_id, inp.input_item_id, reqQty, inp.uom_id, inp.uom?.uom_code, planItem.item_code, [], 0);
            }
          }
        }
      } else {
        unresolvedItems.push({ item_code: planItem.item_code, reason: oStep ? 'NO_STEP_INPUTS' : 'NO_REQUIREMENT_SOURCE' });
      }
    }
  } catch (err) {
    return { data: null, error: err };
  }

  const lines = [];
  const materialEntries = Array.from(materialMap.values());
  const stockInUomByKey = await getStockInUomBatch(materialEntries);

  for (const entry of materialEntries) {
    const availableQty = stockInUomByKey.get(`${entry.item_id}:${entry.uom_id || ''}`) ?? 0;
    const requiredQty = roundQty(entry.required_qty);
    const available = roundQty(availableQty);
    const shortage = roundQty(Math.max(0, requiredQty - available));

    lines.push({
      item_id: entry.item_id,
      item_code: entry.item_code,
      item_name: entry.item_name,
      stage_type: entry.stage_type,
      is_purchasable: entry.is_purchasable, /* MATCLASS */
      is_manufactured: entry.is_manufactured,
      is_stocked: entry.is_stocked,
      required_qty: requiredQty,
      required_uom: entry.required_uom,
      available_qty: available,
      shortage_qty: shortage,
      status: shortage > 0 ? 'SHORT' : 'AVAILABLE',
      sources: Array.from(entry.sources),
    });
  }

  lines.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'SHORT' ? -1 : 1;
    return String(a.item_code).localeCompare(String(b.item_code));
  });

  const shortageCount = lines.filter((x) => x.status === 'SHORT').length;

  // MATSRC: never report READY when there was no requirement source at all
  let material_status;
  let execution_status;
  if (lines.length === 0 && unresolvedItems.length > 0) {
    material_status = 'NEEDS_RECIPE';
    execution_status = 'BLOCKED';
  } else if (shortageCount > 0) {
    material_status = 'SHORTAGE';
    execution_status = 'BLOCKED';
  } else {
    material_status = 'READY';
    execution_status = 'MATERIAL_READY';
  }

  // MATROOT: group lines for two-section display
  // FIXC: shortage arrays contain ONLY actual shortages (shortage_qty > 0).
  const purchase_material_shortage = lines.filter((l) => l.is_purchasable && l.shortage_qty > 0);
  const internal_production_gap = lines.filter((l) => l.is_manufactured && !l.is_purchasable && l.shortage_qty > 0);
  // FIXC: available purchasable/root materials returned separately (not in shortage).
  const root_material_available = lines.filter((l) => l.is_purchasable && l.shortage_qty <= 0);

  return {
    data: {
      material_status,
      execution_status,
      shortage_count: shortageCount,
      unresolved_items: [...unresolvedItems, ...bridgeNotes], // FIXB: include AMBIGUOUS_PRODUCER / RECIPE_CYCLE_BRIDGE
      purchase_material_shortage,
      internal_production_gap,
      root_material_available, // FIXC
      lines,
    },
    error: null,
  };
}


export async function createPurchaseRequirementFromShortage(payload = {}, userId = null) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const shortageLines = lines.filter((line) => Number(line.shortage_qty || 0) > 0);

  if (!shortageLines.length) {
    return {
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'No shortage lines found to create purchase requirement.'
      }
    };
  }

  const prNo = `PR-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${Date.now().toString().slice(-5)}`;

  const { data: header, error: headerErr } = await supabase
    .from('purchase_requirements')
    .insert({
      pr_no: prNo,
      source_type: payload.source_type || 'MATERIAL_SHORTAGE',
      status: 'draft',
      material_status: payload.material_status || 'SHORTAGE',
      shortage_count: shortageLines.length,
      notes: payload.notes || 'Generated from tentative production plan material shortage.',
      created_by: userId,
      updated_by: userId
    })
    .select('id, pr_no, status, material_status, shortage_count')
    .single();

  if (headerErr) return { data: null, error: headerErr };

  const insertLines = shortageLines.map((line) => ({
    pr_id: header.id,
    item_id: line.item_id,
    item_code: line.item_code,
    item_name: line.item_name,
    stage_type: line.stage_type,
    required_qty: Number(line.required_qty || 0),
    available_qty: Number(line.available_qty || 0),
    shortage_qty: Number(line.shortage_qty || 0),
    uom_code: line.required_uom || line.uom_code,
    status: 'draft',
    source_item_codes: Array.isArray(line.sources) ? line.sources : [],
    notes: 'Generated from material shortage.'
  }));

  const { data: createdLines, error: lineErr } = await supabase
    .from('purchase_requirement_lines')
    .insert(insertLines)
    .select('id, item_code, item_name, shortage_qty, uom_code, status');

  if (lineErr) return { data: null, error: lineErr };

  return {
    data: {
      purchase_requirement: header,
      lines: createdLines || []
    },
    error: null
  };
}
