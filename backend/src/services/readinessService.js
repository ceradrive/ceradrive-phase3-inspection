/**
 * CERADRIVE ERP — Readiness Engine (READ-ONLY)
 *
 * Aggregates existing signals into a structured gap list + runtime for a given
 * scope (item | recipe | ppo | wo). No writes, no schema dependency. The runtime
 * engine (recipeCalculationService) is the authority on "is a standard missing";
 * this service adds the exact table.column + fix_link + severity for each gap.
 *
 * Fix links point ONLY to existing master routes:
 *   item    -> /masters/items/[id]#<column>
 *   machine -> /masters/machines/[id]#<column>
 *   die     -> /masters/dies/[id]
 *   slot    -> /masters/moulding-slots            (no [id] edit route confirmed yet)
 *   recipe  -> /stage-recipes/[id]
 *   process -> /masters/process-types/[id]
 */
import { supabase } from '../config/supabase.js';
import { calculateStepRuntime, calculateWorkOrderExpectedMinutes } from './recipeCalculationService.js';

// ── helpers ──────────────────────────────────────────────────────────────────
const num = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const isPos = (v) => num(v) > 0;
const upper = (v) => String(v || '').toUpperCase();

const STEP_SELECT = `
  id, recipe_id, step_no, output_item_id, process_type_id, machine_id, calculation_basis, output_basis_qty,
  output_item:item_master!stage_recipe_steps_output_item_id_fkey(id, item_code, item_name, stage_type, calculation_basis, weight_g, bp_weight_g, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set, cavity_count),
  process_type:process_types(id, type_code, type_name),
  machine:machine_master(id, machine_code, machine_name, capacity_basis, cycle_time_sec, pcs_per_cycle, pcs_per_hour, tray_capacity, batch_capacity_kg, setup_time_min, changeover_time_min, slots_count)
`;

function basisOf(step) {
  return upper(step?.calculation_basis || step?.machine?.capacity_basis);
}

function itemFix(item, col) {
  return item?.id ? `/masters/items/${item.id}#${col}` : '/masters/items';
}
function machineFix(machine, col) {
  return machine?.id ? `/masters/machines/${machine.id}#${col}` : '/masters/machines';
}

// Per-basis required field specs. Each returns a gap when its value is empty.
// `present(step)` decides satisfaction; `gap(step)` builds the GapObject.
function requiredFieldGaps(step) {
  const basis = basisOf(step);
  const m = step?.machine || null;
  const oi = step?.output_item || null;
  const gaps = [];

  const machineGap = (col, label) => ({
    area: 'MACHINE', entity_type: 'machine', entity_id: m?.id || null, entity_code: m?.machine_code || null,
    table_column: `machine_master.${col}`, status: 'MISSING', severity: 'BLOCKER',
    message: `${m?.machine_code || 'Machine'} ${label} missing`, required_by: basis,
    fix_link: machineFix(m, col), suggested_value: null, is_auto_derivable: false,
  });
  const itemGap = (col, label, severity = 'BLOCKER') => ({
    area: 'ITEM', entity_type: 'item', entity_id: oi?.id || null, entity_code: oi?.item_code || null,
    table_column: `item_master.${col}`, status: 'MISSING', severity,
    message: `${oi?.item_code || 'Item'} ${label} missing`, required_by: basis,
    fix_link: itemFix(oi, col), suggested_value: null, is_auto_derivable: false,
  });

  switch (basis) {
    case 'PCS_CYCLE':
      if (!isPos(m?.pcs_per_cycle)) gaps.push(machineGap('pcs_per_cycle', 'pcs per cycle'));
      if (!isPos(m?.cycle_time_sec)) gaps.push(machineGap('cycle_time_sec', 'cycle time'));
      break;
    case 'WEIGHT_BATCH':
      if (!isPos(m?.batch_capacity_kg)) gaps.push(machineGap('batch_capacity_kg', 'batch capacity (kg)'));
      if (!isPos(m?.cycle_time_sec)) gaps.push(machineGap('cycle_time_sec', 'cycle time'));
      if (upper(step?.process_type?.type_code) === 'SHOT_BLASTING' && !isPos(oi?.bp_weight_g)) {
        gaps.push(itemGap('bp_weight_g', 'BP weight (g)'));
      }
      break;
    case 'PCS_TRAY':
      if (!isPos(m?.tray_capacity) && !isPos(oi?.default_pcs_per_tray)) {
        gaps.push(machineGap('tray_capacity', 'tray capacity (or item pcs/tray)'));
      }
      if (!isPos(m?.cycle_time_sec)) gaps.push(machineGap('cycle_time_sec', 'cycle time'));
      break;
    case 'TRAY_BATCH':
      if (!isPos(m?.tray_capacity)) gaps.push(machineGap('tray_capacity', 'trays per batch'));
      if (!isPos(oi?.default_pcs_per_tray)) gaps.push(itemGap('default_pcs_per_tray', 'pcs per tray'));
      if (!isPos(m?.cycle_time_sec)) gaps.push(machineGap('cycle_time_sec', 'cycle/batch time'));
      break;
    case 'PCS_PER_HOUR':
      if (!isPos(m?.pcs_per_hour)) gaps.push(machineGap('pcs_per_hour', 'pcs per hour'));
      break;
    case 'PCS_CRATE':
      if (!isPos(m?.pcs_per_hour)) gaps.push(machineGap('pcs_per_hour', 'stacking rate (pcs/hour)'));
      if (!isPos(oi?.default_pcs_per_crate)) gaps.push(itemGap('default_pcs_per_crate', 'pcs per crate', 'WARNING'));
      break;
    case 'PCS_PER_MIN':
      if (!isPos(m?.pcs_per_hour)) gaps.push(machineGap('pcs_per_hour', 'rate (pcs/hour or pcs/min)'));
      break;
    case 'MANUAL':
      if (!isPos(m?.pcs_per_hour)) gaps.push(machineGap('pcs_per_hour', 'manual/labour rate'));
      break;
    default:
      break; // DIE_CAVITY handled separately (needs async die/slot lookup)
  }
  return gaps;
}

async function dieCavityGaps(step) {
  const basis = basisOf(step);
  if (basis !== 'DIE_CAVITY') return [];
  const oi = step?.output_item || null;
  const gaps = [];

  // die linked to this output item?
  const { data: compat } = await supabase
    .from('die_compatibility')
    .select('die_id, machine_id, is_active')
    .eq('item_id', step.output_item_id)
    .eq('is_active', true);

  const dieIds = [...new Set((compat || []).map((c) => c.die_id).filter(Boolean))];

  if (!dieIds.length) {
    // no die -> may still fall back to item.cavity_count
    if (!isPos(oi?.cavity_count)) {
      gaps.push({
        area: 'DIE', entity_type: 'item', entity_id: oi?.id || null, entity_code: oi?.item_code || null,
        table_column: 'die_compatibility(item_id,die_id)', status: 'MISSING', severity: 'BLOCKER',
        message: `${oi?.item_code || 'Item'} has no compatible die and no cavity_count fallback`,
        required_by: basis, fix_link: oi?.id ? `/masters/items/${oi.id}#cavity_count` : '/masters/dies',
        suggested_value: null, is_auto_derivable: false,
      });
    }
    return gaps;
  }

  const { data: dies } = await supabase
    .from('die_master').select('id, die_code, num_impressions').in('id', dieIds);
  const die = (dies || []).find((d) => isPos(d.num_impressions)) || (dies || [])[0] || null;

  if (!die || !isPos(die.num_impressions)) {
    gaps.push({
      area: 'DIE', entity_type: 'die', entity_id: die?.id || null, entity_code: die?.die_code || null,
      table_column: 'die_master.num_impressions', status: 'MISSING', severity: 'BLOCKER',
      message: `${die?.die_code || 'Die'} cavity (num_impressions) missing`, required_by: basis,
      fix_link: die?.id ? `/masters/dies/${die.id}#num_impressions` : '/masters/dies',
      suggested_value: null, is_auto_derivable: false,
    });
  }

  // slot cycle time for any mounted die
  const { data: slots } = await supabase
    .from('moulding_slot_setups')
    .select('id, machine_id, cycle_time_sec, slot_a_die_id, slot_b_die_id, is_active')
    .eq('is_active', true)
    .in('slot_a_die_id', dieIds);
  const { data: slotsB } = await supabase
    .from('moulding_slot_setups')
    .select('id, machine_id, cycle_time_sec, slot_a_die_id, slot_b_die_id, is_active')
    .eq('is_active', true)
    .in('slot_b_die_id', dieIds);
  const allSlots = [...(slots || []), ...(slotsB || [])];
  const slotWithCycle = allSlots.find((s) => isPos(s.cycle_time_sec));

  if (!allSlots.length) {
    gaps.push({
      area: 'SLOT', entity_type: 'slot', entity_id: null, entity_code: die?.die_code || null,
      table_column: 'moulding_slot_setups(machine_id,slot_die_id,cycle_time_sec)', status: 'MISSING',
      severity: 'BLOCKER', message: `Die ${die?.die_code || ''} is not mounted on any moulding machine slot`,
      required_by: basis, fix_link: '/masters/moulding-slots', suggested_value: null, is_auto_derivable: false,
    });
  } else if (!slotWithCycle) {
    gaps.push({
      area: 'SLOT', entity_type: 'slot', entity_id: allSlots[0].id, entity_code: die?.die_code || null,
      table_column: 'moulding_slot_setups.cycle_time_sec', status: 'MISSING', severity: 'BLOCKER',
      message: `Moulding slot cycle time missing for die ${die?.die_code || ''}`, required_by: basis,
      fix_link: '/masters/moulding-slots', suggested_value: null, is_auto_derivable: false,
    });
  }
  return gaps;
}

function classificationGaps(step) {
  // STK must never be a press/cavity stage.
  const stage = upper(step?.output_item?.stage_type);
  const basis = basisOf(step);
  if (stage === 'STK' && (basis === 'DIE_CAVITY' || basis === 'PCS_CYCLE')) {
    return [{
      area: 'CLASSIFICATION', entity_type: 'recipe_step', entity_id: step.id, entity_code: step?.output_item?.item_code || null,
      table_column: 'stage_recipe_steps.calculation_basis', status: 'WRONG', severity: 'BLOCKER',
      message: 'STK is direct production and must not use a press/cavity basis', required_by: basis,
      fix_link: `/stage-recipes/${step.recipe_id}`, suggested_value: null, is_auto_derivable: false,
    }];
  }
  return [];
}

async function evaluateStep(step, qtyHint) {
  const gaps = [];
  const basis = basisOf(step);

  if (!step?.machine_id) {
    gaps.push({
      area: 'MACHINE', entity_type: 'recipe_step', entity_id: step.id, entity_code: step?.output_item?.item_code || null,
      table_column: 'stage_recipe_steps.machine_id', status: 'MISSING', severity: 'BLOCKER',
      message: 'No machine assigned to this recipe step', required_by: basis || 'ANY',
      fix_link: `/stage-recipes/${step.recipe_id}`, suggested_value: null, is_auto_derivable: false,
    });
  }
  if (!basis) {
    gaps.push({
      area: 'BASIS', entity_type: 'recipe_step', entity_id: step.id, entity_code: step?.output_item?.item_code || null,
      table_column: 'stage_recipe_steps.calculation_basis', status: 'MISSING', severity: 'BLOCKER',
      message: 'Calculation basis not set for this step', required_by: 'ANY',
      fix_link: `/stage-recipes/${step.recipe_id}`, suggested_value: null, is_auto_derivable: false,
    });
  }

  gaps.push(...requiredFieldGaps(step));
  gaps.push(...(await dieCavityGaps(step)));
  gaps.push(...classificationGaps(step));

  // runtime via the engine (authority on missing standards + the number)
  const qty = Math.max(1, num(qtyHint) || num(step?.output_basis_qty) || 1);
  let runtime = null;
  try {
    runtime = await calculateStepRuntime(step, qty, {
      machine: step.machine, process: step.process_type, outputItem: step.output_item,
    });
  } catch {
    runtime = null;
  }

  // If the engine reports a missing standard we did not catch structurally, surface it.
  if (runtime?.missing_standard && !gaps.some((g) => g.severity === 'BLOCKER')) {
    gaps.push({
      area: 'BASIS', entity_type: 'recipe_step', entity_id: step.id, entity_code: step?.output_item?.item_code || null,
      table_column: 'stage_recipe_steps', status: 'MISSING', severity: 'BLOCKER',
      message: (runtime.warnings && runtime.warnings[0]) || 'Standard missing for runtime', required_by: basis,
      fix_link: `/stage-recipes/${step.recipe_id}`, suggested_value: null, is_auto_derivable: false,
    });
  }

  return {
    step_id: step.id,
    step_no: step.step_no,
    process: step?.process_type?.type_code || null,
    output_item: step?.output_item?.item_code || null,
    basis,
    gaps,
    runtime: runtime
      ? {
          expected_minutes: runtime.expected_minutes ?? null,
          missing_standard: Boolean(runtime.missing_standard),
          confidence: runtime.missing_standard ? 'LOW' : 'MED',
          basis: runtime.basis,
          cycle_time_sec: runtime.cycle_time_sec ?? null,
          capacity_used: runtime.capacity_used ?? null,
          warnings: runtime.warnings || [],
        }
      : null,
  };
}

function rollup(scope, id, code, stepResults, woRuntime) {
  const gaps = stepResults.flatMap((s) => s.gaps);
  const blocker_count = gaps.filter((g) => g.severity === 'BLOCKER').length;
  const warning_count = gaps.filter((g) => g.severity === 'WARNING').length;
  const info_count = gaps.filter((g) => g.severity === 'INFO').length;
  const ready = blocker_count === 0;

  const firstBlocker = gaps.find((g) => g.severity === 'BLOCKER') || null;
  const next_action = firstBlocker
    ? { key: 'FIX_SETUP', label: 'Fix setup', target: firstBlocker.fix_link, enabled: true, reason: firstBlocker.message }
    : { key: scope === 'wo' ? 'ASSIGN_AND_START' : 'READY', label: scope === 'wo' ? 'Assign & start' : 'Ready', target: null, enabled: true, reason: 'All standards present' };

  const expected = woRuntime != null
    ? woRuntime
    : stepResults.reduce((sum, s) => sum + (s.runtime?.expected_minutes || 0), 0) || null;

  return {
    scope, id, code, ready, blocker_count, warning_count, info_count,
    next_action,
    runtime: {
      expected_minutes: expected,
      confidence: ready ? 'MED' : 'LOW',
      explanation: ready
        ? 'All required standards present; estimate from recipe steps.'
        : `${blocker_count} blocker(s) prevent a reliable estimate.`,
    },
    steps: stepResults,
    gaps,
  };
}

// ── scope resolvers ──────────────────────────────────────────────────────────
async function stepsForRecipe(recipeId) {
  const { data, error } = await supabase.from('stage_recipe_steps').select(STEP_SELECT).eq('recipe_id', recipeId).order('step_no');
  if (error) return { error };
  return { data: data || [] };
}

async function stepsForItem(itemId) {
  // every recipe step that PRODUCES this item
  const { data, error } = await supabase.from('stage_recipe_steps').select(STEP_SELECT).eq('output_item_id', itemId).order('step_no');
  if (error) return { error };
  return { data: data || [] };
}

async function evalScope(scope, id) {
  if (scope === 'recipe') {
    const { data: header } = await supabase.from('stage_recipe_headers').select('id, recipe_code').eq('id', id).maybeSingle();
    const { data: steps, error } = await stepsForRecipe(id);
    if (error) return { error };
    const results = [];
    for (const s of steps) results.push(await evaluateStep(s, null));
    return { data: rollup('recipe', id, header?.recipe_code || null, results, null) };
  }

  if (scope === 'item') {
    const { data: item } = await supabase.from('item_master').select('id, item_code').eq('id', id).maybeSingle();
    const { data: steps, error } = await stepsForItem(id);
    if (error) return { error };
    const results = [];
    for (const s of steps) results.push(await evaluateStep(s, null));
    return { data: rollup('item', id, item?.item_code || null, results, null) };
  }

  if (scope === 'wo') {
    const { data: wo, error } = await supabase
      .from('wo_headers')
      .select('id, wo_number, item_id, stage_output_item_id, process_type_id, planned_qty')
      .eq('id', id).maybeSingle();
    if (error) return { error };
    if (!wo?.id) return { notFound: true };

    const outputItemId = wo.stage_output_item_id || wo.item_id;
    const { data: steps } = await supabase
      .from('stage_recipe_steps').select(STEP_SELECT)
      .eq('process_type_id', wo.process_type_id).eq('output_item_id', outputItemId);

    const results = [];
    for (const s of steps || []) results.push(await evaluateStep(s, wo.planned_qty));

    // authoritative WO runtime via the engine
    let woRuntime = null;
    try {
      const calc = await calculateWorkOrderExpectedMinutes(wo.id);
      if (calc && !calc.error && calc.data && calc.data.expected_minutes != null) woRuntime = Number(calc.data.expected_minutes);
    } catch { woRuntime = null; }

    return { data: rollup('wo', id, wo.wo_number || null, results, woRuntime) };
  }

  if (scope === 'ppo') {
    const { data: wos, error } = await supabase
      .from('wo_headers').select('id, wo_number').eq('source_ppo_id', id).order('wo_number');
    if (error) return { error };
    const children = [];
    let blockers = 0;
    let totalMin = 0;
    for (const w of wos || []) {
      const r = await evalScope('wo', w.id);
      if (r.data) { children.push(r.data); blockers += r.data.blocker_count; totalMin += r.data.runtime?.expected_minutes || 0; }
    }
    return {
      data: {
        scope: 'ppo', id, code: null, ready: blockers === 0, blocker_count: blockers,
        warning_count: children.reduce((s, c) => s + c.warning_count, 0), info_count: 0,
        next_action: blockers ? { key: 'FIX_SETUP', label: 'Fix setup', target: null, enabled: true, reason: `${blockers} blocker(s) across work orders` }
                              : { key: 'GENERATE_WOS', label: 'Proceed', target: null, enabled: true, reason: 'All work orders ready' },
        runtime: { expected_minutes: totalMin || null, confidence: blockers ? 'LOW' : 'MED', explanation: 'Sum of child work-order estimates.' },
        work_orders: children,
        gaps: children.flatMap((c) => c.gaps),
      },
    };
  }

  return { invalidScope: true };
}

export async function getReadiness(scope, id) {
  const allowed = ['item', 'recipe', 'ppo', 'wo'];
  if (!allowed.includes(scope)) return { data: null, error: { code: 'VALIDATION_ERROR', message: `Invalid scope '${scope}'. Use item|recipe|ppo|wo.` } };
  try {
    const r = await evalScope(scope, id);
    if (r.invalidScope) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid scope.' } };
    if (r.notFound) return { data: null, error: { code: 'NOT_FOUND', message: `${scope} not found.` } };
    if (r.error) return { data: null, error: r.error };
    return { data: r.data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// ── Inbox: read-only bounded scan of open work ───────────────────────────────
const OPEN_WO_STATUS = ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'WO_DRAFTED', 'BLOCKED'];
const INBOX_DEFAULT_SCOPES = ['wo', 'recipe'];
const INBOX_LIMIT_DEFAULT = 25;
const INBOX_LIMIT_MAX = 100;

// Candidate ids per scope. Any DB error degrades that scope to empty (never fatal).
async function inboxCandidates(scope, limit) {
  try {
    if (scope === 'wo') {
      const { data, error } = await supabase.from('wo_headers').select('id')
        .in('status', OPEN_WO_STATUS).order('created_at', { ascending: false }).limit(limit);
      if (error) return [];
      return (data || []).map((r) => r.id);
    }
    if (scope === 'recipe') {
      const { data, error } = await supabase.from('stage_recipe_headers').select('id')
        .eq('status', 'active').order('created_at', { ascending: false }).limit(limit);
      if (error) return [];
      return (data || []).map((r) => r.id);
    }
    if (scope === 'ppo') {
      const { data, error } = await supabase.from('production_plan_orders').select('id')
        .order('created_at', { ascending: false }).limit(limit);
      if (error) return [];
      return (data || []).map((r) => r.id);
    }
    if (scope === 'item') {
      const { data, error } = await supabase.from('item_master').select('id')
        .eq('is_manufactured', true).order('created_at', { ascending: false }).limit(limit);
      if (error) return [];
      return (data || []).map((r) => r.id);
    }
  } catch {
    return [];
  }
  return [];
}

export async function getInbox(opts = {}) {
  const status = ['blocker', 'warning', 'all'].includes(opts.status) ? opts.status : 'blocker';
  let scopes = Array.isArray(opts.scopes) && opts.scopes.length
    ? opts.scopes.filter((s) => ['wo', 'recipe', 'ppo', 'item'].includes(s))
    : INBOX_DEFAULT_SCOPES;
  if (!scopes.length) scopes = INBOX_DEFAULT_SCOPES;

  let limit = Number(opts.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = INBOX_LIMIT_DEFAULT;
  limit = Math.min(limit, INBOX_LIMIT_MAX);

  const cards = [];
  const scanned = {};
  try {
    for (const scope of scopes) {
      const ids = await inboxCandidates(scope, limit);
      scanned[scope] = ids.length;
      for (const id of ids) {
        const r = await getReadiness(scope, id);
        if (r.error || !r.data) continue;
        const c = r.data;
        const keep = status === 'all'
          ? true
          : status === 'warning'
            ? (c.blocker_count > 0 || c.warning_count > 0)
            : (c.blocker_count > 0);
        if (keep) cards.push(c);
      }
    }
  } catch (error) {
    return { data: null, error };
  }

  cards.sort((a, b) => (b.blocker_count - a.blocker_count) || (b.warning_count - a.warning_count));
  return { data: { status, scopes, scanned, count: cards.length, cards }, error: null };
}
