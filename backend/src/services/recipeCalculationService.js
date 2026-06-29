import { supabase } from '../config/supabase.js';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value) {
  const n = num(value, 0);
  return n > 0 ? n : null;
}

function round(value, places = 2) {
  const n = num(value, 0);
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function ceilDiv(qty, capacity) {
  const q = num(qty, 0);
  const c = num(capacity, 0);
  if (q <= 0 || c <= 0) return null;
  return Math.ceil(q / c);
}

function codeOf(row, key = 'type_code') {
  return String(row?.[key] || '').toUpperCase();
}

function minutesFromCycle(count, cycleTimeSec) {
  const cycles = num(count, 0);
  const sec = num(cycleTimeSec, 0);
  if (cycles <= 0 || sec <= 0) return 0;
  return (cycles * sec) / 60;
}

function missingResult(basis, qtyUsed, reason, extra = {}) {
  return {
    expected_minutes: null,
    basis,
    qty_used: round(qtyUsed, 4),
    missing_standard: true,
    warnings: [reason],
    ...extra,
  };
}

function runtimeResult({ expectedMinutes, basis, qtyUsed, warnings = [], missingStandard = false, ...extra }) {
  return {
    expected_minutes: expectedMinutes == null ? null : Math.ceil(expectedMinutes),
    basis,
    qty_used: round(qtyUsed, 4),
    missing_standard: Boolean(missingStandard),
    warnings,
    ...extra,
  };
}

function setupMinutes(machine, override = {}) {
  return num(override.setup_time_min ?? machine?.setup_time_min, 0);
}

function changeoverMinutes(machine) {
  return num(machine?.changeover_time_min, 0);
}

function normalisedBasis(step, machine) {
  return String(step?.calculation_basis || machine?.capacity_basis || '').toUpperCase();
}

function inputFormulaTotal(inputs) {
  return (inputs || [])
    .filter((input) => String(input.qty_basis || '').toUpperCase() === 'PER_BATCH')
    .reduce((sum, input) => sum + num(input.qty, 0), 0);
}

function displayQty(qty, uomCode) {
  const code = String(uomCode || '').toUpperCase();
  const n = num(qty, 0);

  if (['G', 'GM', 'GRM', 'GRAM', 'GRAMS'].includes(code) && Math.abs(n) >= 1000) {
    return { quantity: round(n / 1000, 4), uom_code: 'KG' };
  }

  return { quantity: round(n, 4), uom_code: code };
}

export function calculateStepRequirements(recipeStep, outputQty, runtime = {}) {
  const qtyUsed = num(outputQty, 0);
  const inputs = recipeStep?.inputs || [];
  const processCode = codeOf(recipeStep?.process || recipeStep?.process_type || {}, 'type_code');
  const basis = normalisedBasis(recipeStep, recipeStep?.machine);
  const formulaTotal = inputFormulaTotal(inputs);

  return inputs.map((input) => {
    const inputQty = num(input.qty, 0);
    const qtyBasis = String(input.qty_basis || 'PER_OUTPUT').toUpperCase();
    const uomCode = codeOf(input.uom || {}, 'uom_code');
    let requiredQty = 0;

    if (qtyBasis === 'FIXED') {
      requiredQty = inputQty;
    } else if (qtyBasis === 'PER_BATCH') {
      if (basis === 'WEIGHT_BATCH' && processCode === 'MIXING' && formulaTotal > 0) {
        requiredQty = qtyUsed * (inputQty / formulaTotal);
      } else if (runtime.batches) {
        requiredQty = inputQty * runtime.batches;
      } else {
        requiredQty = inputQty;
      }
    } else {
      requiredQty = qtyUsed * inputQty;
    }

    const disp = displayQty(requiredQty, uomCode);

    return {
      input_item_id: input.input_item_id,
      input_item_code: input.input_item?.item_code || null,
      input_item_name: input.input_item?.item_name || null,
      qty_basis: qtyBasis,
      required_qty: round(requiredQty, 4),
      uom_code: uomCode,
      display_required_qty: disp.quantity,
      display_uom_code: disp.uom_code,
    };
  });
}

async function resolveMouldingCapacity({ machine, outputItem }) {
  const machineId = machine?.id;
  const outputItemId = outputItem?.id;
  const machineCycleSec = positive(machine?.cycle_time_sec);
  const machineSetupMin = num(machine?.setup_time_min, 0);
  const fallbackCavity = positive(outputItem?.cavity_count);

  if (!machineId) {
    return {
      capacity: fallbackCavity,
      cycle_time_sec: machineCycleSec,
      setup_time_min: machineSetupMin,
      warnings: fallbackCavity ? ['Machine not selected; using item cavity fallback.'] : ['Machine not selected for moulding.'],
    };
  }

  const { data: setups, error: setupErr } = await supabase
    .from('moulding_slot_setups')
    .select('id, machine_id, slot_a_die_id, slot_b_die_id, cycle_time_sec, setup_time_min, heating_time_min, is_active')
    .eq('machine_id', machineId)
    .eq('is_active', true);

  if (setupErr) throw setupErr;

  const dieIds = [...new Set((setups || []).flatMap((s) => [s.slot_a_die_id, s.slot_b_die_id]).filter(Boolean))];

  const { data: compatRows, error: compatErr } = outputItemId
    ? await supabase
        .from('die_compatibility')
        .select('die_id, machine_id, item_id, is_preferred, is_active')
        .eq('item_id', outputItemId)
        .eq('machine_id', machineId)
        .eq('is_active', true)
    : { data: [], error: null };

  if (compatErr) throw compatErr;

  const compatibleDieIds = new Set((compatRows || []).map((row) => row.die_id).filter(Boolean));

  if (dieIds.length) {
    const { data: dies, error: dieErr } = await supabase
      .from('die_master')
      .select('id, die_code, num_impressions, is_active')
      .in('id', dieIds)
      .eq('is_active', true);

    if (dieErr) throw dieErr;

    const dieMap = new Map((dies || []).map((die) => [die.id, die]));
    let best = null;

    for (const setup of setups || []) {
      const slotDies = [setup.slot_a_die_id, setup.slot_b_die_id]
        .filter(Boolean)
        .map((dieId) => dieMap.get(dieId))
        .filter(Boolean)
        .filter((die) => !compatibleDieIds.size || compatibleDieIds.has(die.id));

      const capacity = slotDies.reduce((sum, die) => sum + num(die.num_impressions, 0), 0);
      if (capacity <= 0) continue;

      const candidate = {
        capacity,
        cycle_time_sec: positive(setup.cycle_time_sec) || machineCycleSec,
        setup_time_min: num(setup.setup_time_min, machineSetupMin),
        slot_setup_id: setup.id,
        die_ids: slotDies.map((die) => die.id),
      };

      if (!best || candidate.capacity > best.capacity) best = candidate;
    }

    if (best) {
      return { ...best, warnings: [] };
    }
  }

  if (outputItemId) {
    const { data: compat, error: dieCompatErr } = await supabase
      .from('die_compatibility')
      .select('die_id, is_preferred')
      .eq('item_id', outputItemId)
      .eq('machine_id', machineId)
      .eq('is_active', true)
      .order('is_preferred', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dieCompatErr) throw dieCompatErr;

    if (compat?.die_id) {
      const { data: die, error: dieErr } = await supabase
        .from('die_master')
        .select('id, num_impressions')
        .eq('id', compat.die_id)
        .eq('is_active', true)
        .maybeSingle();

      if (dieErr) throw dieErr;
      const capacity = positive(die?.num_impressions);
      if (capacity) {
        return {
          capacity,
          cycle_time_sec: machineCycleSec,
          setup_time_min: machineSetupMin,
          die_ids: [die.id],
          warnings: ['No active slot setup found; using die compatibility capacity.'],
        };
      }
    }
  }

  return {
    capacity: fallbackCavity,
    cycle_time_sec: machineCycleSec,
    setup_time_min: machineSetupMin,
    warnings: fallbackCavity ? ['Using item cavity fallback.'] : ['Moulding die cavity standard missing.'],
  };
}

export async function calculateStepRuntime(recipeStep, outputQty, options = {}) {
  const qtyUsed = num(outputQty, 0);
  const machine = options.machine || recipeStep?.machine || null;
  const outputItem = options.outputItem || recipeStep?.output_item || recipeStep?.outputItem || null;
  const process = options.process || recipeStep?.process || recipeStep?.process_type || null;
  const inputs = recipeStep?.inputs || [];
  const processCode = codeOf(process, 'type_code');
  const basis = normalisedBasis(recipeStep, machine);

  if (qtyUsed <= 0) return missingResult(basis, qtyUsed, 'No loggable quantity available.');
  if (!basis) return missingResult('MISSING', qtyUsed, 'Calculation basis missing.');

  const setup = setupMinutes(machine);
  const changeover = changeoverMinutes(machine);
  const cycleTimeSec = positive(machine?.cycle_time_sec);

  if (basis === 'WEIGHT_BATCH' && processCode === 'SHOT_BLASTING') {
    const bpInput = inputs.find((input) => positive(input.input_item?.bp_weight_g));
    const bpWeightG = positive(bpInput?.input_item?.bp_weight_g || outputItem?.bp_weight_g || outputItem?.weight_g);
    const capacityKg = positive(machine?.batch_capacity_kg || machine?.planning_capacity || machine?.rated_capacity);

    if (!bpWeightG) return missingResult(basis, qtyUsed, 'BP weight standard missing for shot blasting.');
    if (!capacityKg) return missingResult(basis, qtyUsed, 'Machine batch capacity KG missing for shot blasting.');
    if (!cycleTimeSec) return missingResult(basis, qtyUsed, 'Machine cycle time missing for shot blasting.');

    const batchPcs = Math.floor((capacityKg * 1000) / bpWeightG);
    if (batchPcs <= 0) return missingResult(basis, qtyUsed, 'Shot blasting batch PCS could not be calculated.');

    const batches = ceilDiv(qtyUsed, batchPcs);
    const expected = setup + changeover + minutesFromCycle(batches, cycleTimeSec);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      batches,
      capacity_used: batchPcs,
      batch_capacity_kg: capacityKg,
      bp_weight_g: bpWeightG,
      cycle_time_sec: cycleTimeSec,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'WEIGHT_BATCH') {
    const capacityKg = positive(machine?.batch_capacity_kg || machine?.planning_capacity || machine?.rated_capacity);
    if (!capacityKg) return missingResult(basis, qtyUsed, 'Machine batch capacity KG missing.');
    if (!cycleTimeSec) return missingResult(basis, qtyUsed, 'Machine cycle time missing.');

    const batches = ceilDiv(qtyUsed, capacityKg);
    const expected = setup + changeover + minutesFromCycle(batches, cycleTimeSec);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      batches,
      capacity_used: capacityKg,
      cycle_time_sec: cycleTimeSec,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'PCS_CYCLE') {
    const pcsPerCycle = positive(machine?.pcs_per_cycle);
    if (!pcsPerCycle) return missingResult(basis, qtyUsed, 'Machine PCS per cycle missing.');
    if (!cycleTimeSec) return missingResult(basis, qtyUsed, 'Machine cycle time missing.');

    const cycles = ceilDiv(qtyUsed, pcsPerCycle);
    const expected = setup + changeover + minutesFromCycle(cycles, cycleTimeSec);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      cycles,
      capacity_used: pcsPerCycle,
      cycle_time_sec: cycleTimeSec,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'PCS_TRAY') {
    const pcsPerTray = positive(machine?.tray_capacity || outputItem?.default_pcs_per_tray);
    if (!pcsPerTray) return missingResult(basis, qtyUsed, 'PCS per tray standard missing.');
    if (!cycleTimeSec) return missingResult(basis, qtyUsed, 'Machine cycle time missing.');

    const trays = ceilDiv(qtyUsed, pcsPerTray);
    const expected = setup + changeover + minutesFromCycle(trays, cycleTimeSec);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      trays,
      capacity_used: pcsPerTray,
      cycle_time_sec: cycleTimeSec,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'DIE_CAVITY') {
    const resolved = await resolveMouldingCapacity({ machine, outputItem });
    const cavity = positive(resolved.capacity);
    const resolvedCycleSec = positive(resolved.cycle_time_sec);
    const resolvedSetup = num(resolved.setup_time_min, setup);

    if (!cavity) return missingResult(basis, qtyUsed, 'Moulding cavity standard missing.', { warnings: resolved.warnings || [] });
    if (!resolvedCycleSec) return missingResult(basis, qtyUsed, 'Moulding cycle time missing.', { warnings: resolved.warnings || [] });

    const cycles = ceilDiv(qtyUsed, cavity);
    const expected = resolvedSetup + changeover + minutesFromCycle(cycles, resolvedCycleSec);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      cycles,
      capacity_used: cavity,
      cycle_time_sec: resolvedCycleSec,
      setup_minutes: resolvedSetup,
      changeover_minutes: changeover,
      slot_setup_id: resolved.slot_setup_id || null,
      die_ids: resolved.die_ids || [],
      warnings: resolved.warnings || [],
    });
  }

  if (basis === 'PCS_PER_HOUR') {
    const pcsPerHour = positive(machine?.pcs_per_hour);
    if (!pcsPerHour) return missingResult(basis, qtyUsed, 'PCS per hour standard missing.');

    const expected = setup + changeover + ((qtyUsed / pcsPerHour) * 60);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      capacity_used: pcsPerHour,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'TRAY_BATCH') {
    const trayCapacity = positive(machine?.tray_capacity);
    const pcsPerTray = positive(outputItem?.default_pcs_per_tray);
    if (!trayCapacity) return missingResult(basis, qtyUsed, 'Machine tray capacity missing.');
    if (!pcsPerTray) return missingResult(basis, qtyUsed, 'Item PCS per tray standard missing.');
    if (!cycleTimeSec) return missingResult(basis, qtyUsed, 'Machine cycle time missing.');

    const capacityPcs = trayCapacity * pcsPerTray;
    const batches = ceilDiv(qtyUsed, capacityPcs);
    const expected = setup + changeover + minutesFromCycle(batches, cycleTimeSec);

    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      batches,
      trays_per_batch: trayCapacity,
      pcs_per_tray: pcsPerTray,
      capacity_used: capacityPcs,
      cycle_time_sec: cycleTimeSec,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'PCS_CRATE') {
    const pcsPerHour = positive(machine?.pcs_per_hour);
    const pcsPerCrate = positive(outputItem?.default_pcs_per_crate);
    const crates = pcsPerCrate ? ceilDiv(qtyUsed, pcsPerCrate) : null;

    if (!pcsPerHour) {
      return missingResult(basis, qtyUsed, 'Stacking time standard missing.', { crates, capacity_used: pcsPerCrate });
    }

    const expected = setup + changeover + ((qtyUsed / pcsPerHour) * 60);
    return runtimeResult({
      expectedMinutes: expected,
      basis,
      qtyUsed,
      crates,
      capacity_used: pcsPerHour,
      pcs_per_crate: pcsPerCrate,
      setup_minutes: setup,
      changeover_minutes: changeover,
    });
  }

  if (basis === 'PCS_PER_MIN') {
    const pcsPerMin = positive(machine?.pcs_per_min || (positive(machine?.pcs_per_hour) ? num(machine.pcs_per_hour) / 60 : null));
    if (!pcsPerMin) return missingResult(basis, qtyUsed, 'PCS per minute standard missing.');

    const expected = setup + changeover + (qtyUsed / pcsPerMin);
    return runtimeResult({ expectedMinutes: expected, basis, qtyUsed, capacity_used: pcsPerMin, setup_minutes: setup, changeover_minutes: changeover });
  }

  if (basis === 'MANUAL') {
    const pcsPerHour = positive(machine?.pcs_per_hour);
    if (!pcsPerHour) return missingResult(basis, qtyUsed, 'Manual/labour time standard missing.');

    const expected = setup + changeover + ((qtyUsed / pcsPerHour) * 60);
    return runtimeResult({ expectedMinutes: expected, basis, qtyUsed, capacity_used: pcsPerHour, setup_minutes: setup, changeover_minutes: changeover });
  }

  return missingResult(basis, qtyUsed, `Unsupported calculation basis: ${basis}`);
}

async function producedQtyForWo(woId) {
  const { data: logs, error } = await supabase
    .from('production_logs')
    .select('good_qty, entry_type, correction_delta_good_qty')
    .eq('wo_id', woId);

  if (error) throw error;

  return (logs || []).reduce((sum, log) => {
    if (log.entry_type === 'CORRECTION') return sum + num(log.correction_delta_good_qty, 0);
    return sum + num(log.good_qty, 0);
  }, 0);
}

async function fetchWorkOrderRecipeStep(wo, machineId) {
  const outputItemId = wo.stage_output_item_id || wo.item_id;

  const { data: line, error: lineErr } = wo.source_ppo_line_id
    ? await supabase
        .from('production_plan_order_lines')
        .select('id, item_id')
        .eq('id', wo.source_ppo_line_id)
        .maybeSingle()
    : { data: null, error: null };

  if (lineErr) throw lineErr;

  const fgItemId = line?.item_id || wo.item_id;

  const { data: recipes, error: recipeErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, fg_item_id, recipe_code, status')
    .eq('fg_item_id', fgItemId)
    .order('status', { ascending: true })
    .limit(5);

  if (recipeErr) throw recipeErr;

  const recipe = (recipes || []).find((r) => r.status === 'active') || (recipes || [])[0];
  if (!recipe?.id) return { recipe: null, step: null };

  const { data: step, error: stepErr } = await supabase
    .from('stage_recipe_steps')
    .select('id, recipe_id, step_no, output_item_id, process_type_id, machine_id, calculation_basis')
    .eq('recipe_id', recipe.id)
    .eq('process_type_id', wo.process_type_id)
    .eq('output_item_id', outputItemId)
    .maybeSingle();

  if (stepErr) throw stepErr;
  if (!step?.id) return { recipe, step: null };

  const { data: inputs, error: inputErr } = await supabase
    .from('stage_recipe_inputs')
    .select('id, step_id, input_item_id, qty, uom_id, qty_basis, input_item:item_master!stage_recipe_inputs_input_item_id_fkey(id, item_code, item_name, weight_g, bp_weight_g, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set), uom:uom_master(id, uom_code)')
    .eq('step_id', step.id);

  if (inputErr) throw inputErr;

  /* P3H-ASSIGN-MACHINE-GUARD */
  const machineLookupId = machineId || step.machine_id || null;
  const [{ data: machine, error: machineErr }, { data: process, error: processErr }, { data: outputItem, error: outputErr }] = await Promise.all([
    machineLookupId
      ? supabase
          .from('machine_master')
          .select('id, machine_code, machine_name, capacity_basis, planning_capacity, rated_capacity, capacity_uom, cycle_time_sec, setup_time_min, changeover_time_min, pcs_per_cycle, pcs_per_hour, tray_capacity, batch_capacity_kg, slots_count, capacity_tolerance_percent')
          .eq('id', machineLookupId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('process_types').select('id, type_code, type_name').eq('id', step.process_type_id).maybeSingle(),
    supabase
      .from('item_master')
      .select('id, item_code, item_name, weight_g, bp_weight_g, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set, cavity_count')
      .eq('id', outputItemId)
      .maybeSingle(),
  ]);

  if (machineErr) throw machineErr;
  if (processErr) throw processErr;
  if (outputErr) throw outputErr;

  return {
    recipe,
    step: {
      ...step,
      inputs: inputs || [],
      machine,
      process,
      output_item: outputItem,
    },
  };
}

export async function calculateWorkOrderExpectedMinutes(woId, options = {}) {
  try {
    const { data: wo, error: woErr } = await supabase
      .from('wo_headers')
      .select('id, wo_number, item_id, stage_output_item_id, source_ppo_line_id, source_ppo_id, process_type_id, planned_qty, ready_to_start_qty')
      .eq('id', woId)
      .maybeSingle();

    if (woErr) throw woErr;
    if (!wo?.id) return { data: null, error: { code: 'NOT_FOUND', message: 'Work Order not found.' } };

    const producedQty = await producedQtyForWo(wo.id);
    const plannedQty = num(wo.planned_qty, 0);
    const readyToStartQty = num(wo.ready_to_start_qty, 0);
    const remainingPlannedQty = Math.max(0, plannedQty - producedQty);
    const remainingReadyQty = Math.max(0, readyToStartQty - producedQty);
    const qtyUsed = Math.max(0, Math.min(remainingPlannedQty, remainingReadyQty));

    const { recipe, step } = await fetchWorkOrderRecipeStep(wo, options.machineId || null);

    if (!recipe?.id) {
      return { data: missingResult('MISSING', qtyUsed, 'Recipe not found for Work Order.'), error: null };
    }

    if (!step?.id) {
      return { data: missingResult('MISSING', qtyUsed, 'Recipe step mapping missing for Work Order.'), error: null };
    }

    const runtime = await calculateStepRuntime(step, qtyUsed, {
      machine: step.machine,
      process: step.process,
      outputItem: step.output_item,
    });

    return {
      data: {
        ...runtime,
        wo_id: wo.id,
        wo_number: wo.wo_number,
        produced_qty: round(producedQty, 4),
        planned_qty: round(plannedQty, 4),
        ready_to_start_qty: round(readyToStartQty, 4),
        remaining_ready_qty: round(remainingReadyQty, 4),
        recipe_id: recipe.id,
        recipe_code: recipe.recipe_code,
        recipe_step_id: step.id,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err };
  }
}
