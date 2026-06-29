/**
 * CERADRIVE ERP — Stage Manufacturing Recipe Service
 *
 * Factory-friendly setup layer for production planning:
 * output SFG/FG + input items + process + machine + calculation basis.
 * This does not post inventory and does not generate Work Orders.
 */

import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase.js';
import { calculateStepRuntime } from './recipeCalculationService.js';
function sanitizeOrSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[,%_()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


const CALC_BASIS = [
  'WEIGHT_BATCH', 'PCS_TRAY', 'DIE_CAVITY', 'PCS_CYCLE',
  'PCS_PER_HOUR', 'PCS_PER_MIN', 'PCS_CRATE', 'TRAY_BATCH', 'MANUAL',
];
const STATUS = ['draft', 'active', 'inactive', 'superseded'];
const MAKE_POLICY = ['MAKE_TO_STOCK', 'MAKE_TO_ORDER'];
const PLANNING_UNIT = ['PCS', 'SET', 'KG', 'TRAY', 'CRATE'];
const QTY_BASIS = ['PER_OUTPUT', 'PER_SET', 'PER_BATCH', 'FIXED'];

const HEADER_COLS = `
  id, recipe_code, recipe_name, fg_item_id, planning_unit, make_policy, status, notes,
  recipe_family_code, version_number, root_recipe_id, supersedes_recipe_id,
  activated_at, activated_by, superseded_at, superseded_by,
  created_at, updated_at,
  fg_item:item_master!stage_recipe_headers_fg_item_id_fkey(id, item_code, item_name)
`;

function cleanText(v) { return typeof v === 'string' ? v.trim() : v; }
function nullable(v) { return v === undefined || v === null || v === '' ? null : v; }
function bool(v, fallback = false) { return v === undefined ? fallback : Boolean(v); }
function num(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw { code: 'VALIDATION_ERROR', message: 'Numeric field contains invalid value.' };
  return n;
}
function intNum(v, fallback = null) {
  const n = num(v, fallback);
  if (n === null) return n;
  if (!Number.isInteger(n)) throw { code: 'VALIDATION_ERROR', message: 'Step number must be a whole number.' };
  return n;
}
function ensureIn(list, value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (!list.includes(value)) throw { code: 'VALIDATION_ERROR', message: `${label} is invalid.` };
  return value;
}

function deriveFgItemIdFromSingleStepOutput(steps = []) {
  const outputIds = [...new Set((steps || []).map((step) => nullable(step?.output_item_id)).filter(Boolean))];
  return outputIds.length === 1 ? outputIds[0] : null;
}

function applyFallbackFgItemId(headerPayload, steps = []) {
  if (headerPayload?.fg_item_id) return headerPayload;
  const fallbackFgItemId = deriveFgItemIdFromSingleStepOutput(steps);
  return fallbackFgItemId ? { ...headerPayload, fg_item_id: fallbackFgItemId } : headerPayload;
}

async function ensureHeaderFgItemIdFromExistingSteps(recipeId) {
  const { data: header, error: hErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, fg_item_id')
    .eq('id', recipeId)
    .maybeSingle();

  if (hErr) throw hErr;
  if (!header || header.fg_item_id) return header?.fg_item_id || null;

  const { data: steps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select('output_item_id')
    .eq('recipe_id', recipeId);

  if (sErr) throw sErr;

  const fallbackFgItemId = deriveFgItemIdFromSingleStepOutput(steps || []);
  if (!fallbackFgItemId) return null;

  const { error: uErr } = await supabase
    .from('stage_recipe_headers')
    .update({ fg_item_id: fallbackFgItemId, updated_at: new Date().toISOString() })
    .eq('id', recipeId);

  if (uErr) throw uErr;
  return fallbackFgItemId;
}

function normaliseHeader(body, userId, isCreate = true) {
  const recipe_code = cleanText(body.recipe_code || '').toUpperCase();
  const recipe_name = cleanText(body.recipe_name || '');
  if (!recipe_code) throw { code: 'VALIDATION_ERROR', message: 'Recipe code is required.' };
  if (!recipe_name) throw { code: 'VALIDATION_ERROR', message: 'Recipe name is required.' };

  return {
    recipe_code,
    recipe_name,
    fg_item_id:    nullable(body.fg_item_id),
    planning_unit: ensureIn(PLANNING_UNIT, nullable(body.planning_unit), 'Planning unit'),
    make_policy:   ensureIn(MAKE_POLICY, nullable(body.make_policy), 'Make policy'),
    status:        ensureIn(STATUS, body.status || 'draft', 'Status') || 'draft',
    notes:         nullable(cleanText(body.notes || '')),
    ...(isCreate ? { created_by: userId } : { updated_by: userId, updated_at: new Date().toISOString() }),
  };
}

function normaliseStep(step, index) {
  if (!step.output_item_id) throw { code: 'VALIDATION_ERROR', message: 'Every stage needs an output item.' };
  const step_no = intNum(step.step_no, index + 1);
  if (step_no <= 0) throw { code: 'VALIDATION_ERROR', message: 'Step number must be greater than 0.' };

  const output_basis_qty = num(step.output_basis_qty, 1);
  if (!(output_basis_qty > 0)) throw { code: 'VALIDATION_ERROR', message: 'To make quantity must be greater than 0.' };

  return {
    step_no,
    output_item_id:       step.output_item_id,
    output_basis_qty,
    output_basis_uom_id:  nullable(step.output_basis_uom_id),
    process_type_id:      nullable(step.process_type_id),
    machine_id:           nullable(step.machine_id),
    calculation_basis:    ensureIn(CALC_BASIS, nullable(step.calculation_basis), 'Calculation basis'),
    qc_required:          bool(step.qc_required, false),
    fpa_required:         bool(step.fpa_required, false),
    dependency_step_no:   intNum(step.dependency_step_no, null),
    notes:                nullable(cleanText(step.notes || '')),
  };
}

function normaliseInput(input) {
  if (!input.input_item_id) throw { code: 'VALIDATION_ERROR', message: 'Every input row needs an input item.' };
  const qty = num(input.qty, 1);
  if (qty < 0) throw { code: 'VALIDATION_ERROR', message: 'Input quantity cannot be negative.' };
  return {
    input_item_id: input.input_item_id,
    qty,
    uom_id: nullable(input.uom_id),
    qty_basis: ensureIn(QTY_BASIS, input.qty_basis || 'PER_OUTPUT', 'Quantity basis') || 'PER_OUTPUT',
    notes: nullable(cleanText(input.notes || '')),
  };
}

function assertNoDuplicateSteps(steps) {
  const seen = new Set();
  for (const s of steps) {
    if (seen.has(s.step_no)) throw { code: 'VALIDATION_ERROR', message: `Duplicate step number ${s.step_no}.` };
    seen.add(s.step_no);
  }
}

export async function searchItems({ search, limit = 100 } = {}) {
  const safeLimit = Math.min(Number(limit) || 100, 500);
  let q = supabase
    .from('item_master')
    .select('id, item_code, item_name, uom_id, stage_type, make_policy, planning_unit, calculation_basis, weight_g, bp_weight_g, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set, cavity_count')
    .eq('is_active', true)
    .order('item_code', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`item_code.ilike.%${safeSearch}%,item_name.ilike.%${safeSearch}%`);
  const { data, error } = await q;
  return { data: data ?? null, error };
}

export async function listProcessTypes() {
  const { data, error } = await supabase
    .from('process_types')
    .select('id, type_code, type_name, seq_no')
    .eq('is_active', true)
    .order('seq_no', { ascending: true });
  return { data: data ?? null, error };
}

export async function listMachines() {
  const { data, error } = await supabase
    .from('machine_master')
    .select('id, machine_code, machine_name, capacity_basis, planning_capacity, capacity_uom, cycle_time_sec, pcs_per_cycle, pcs_per_hour, tray_capacity, batch_capacity_kg, slots_count')
    .eq('is_active', true)
    .order('machine_code', { ascending: true });
  return { data: data ?? null, error };
}

export async function listStageRecipes({ search, status, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const from = (Number(page) - 1) * safeLimit;
  const to = from + safeLimit - 1;
  let q = supabase
    .from('stage_recipe_headers')
    .select(HEADER_COLS, { count: 'exact' })
    .order('recipe_code', { ascending: true })
    .range(from, to);
  if (status && status !== 'current' && status !== 'all') {
    q = q.eq('status', status);
  } else if (!status || status === 'current') {
    q = q.neq('status', 'superseded');
  }
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`recipe_code.ilike.%${safeSearch}%,recipe_name.ilike.%${safeSearch}%`);
  const { data, error, count } = await q;
  return { data: data ?? null, count, error };
}

export async function getStageRecipeById(id) {
  const { data: header, error: hErr } = await supabase
    .from('stage_recipe_headers')
    .select(HEADER_COLS)
    .eq('id', id)
    .maybeSingle();
  if (hErr || !header) return { data: null, error: hErr ?? { code: 'NOT_FOUND', message: 'Stage recipe not found.' } };

  const { data: steps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select(`
      id, recipe_id, step_no, output_item_id, output_basis_qty, output_basis_uom_id, process_type_id, machine_id, calculation_basis,
      qc_required, fpa_required, dependency_step_no, notes,
      output_basis_uom:uom_master!stage_recipe_steps_output_basis_uom_id_fkey(id, uom_code, uom_name),
      output_item:item_master!stage_recipe_steps_output_item_id_fkey(id, item_code, item_name, stage_type, calculation_basis, weight_g, bp_weight_g, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set, cavity_count),
      process_type:process_types(id, type_code, type_name),
      machine:machine_master(id, machine_code, machine_name, capacity_basis, planning_capacity, capacity_uom, cycle_time_sec, pcs_per_cycle, pcs_per_hour, tray_capacity, batch_capacity_kg, slots_count)
    `)
    .eq('recipe_id', id)
    .order('step_no', { ascending: true });
  if (sErr) return { data: null, error: sErr };

  const stepIds = (steps ?? []).map((s) => s.id);
  let inputs = [];
  if (stepIds.length) {
    const { data: rows, error: iErr } = await supabase
      .from('stage_recipe_inputs')
      .select(`
        id, step_id, input_item_id, qty, uom_id, qty_basis, notes,
        uom:uom_master(id, uom_code, uom_name),
        input_item:item_master!stage_recipe_inputs_input_item_id_fkey(id, item_code, item_name, uom_id, stage_type, weight_g, bp_weight_g, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set)
      `)
      .in('step_id', stepIds)
      .order('created_at', { ascending: true });
    if (iErr) return { data: null, error: iErr };
    inputs = rows ?? [];
  }

  const byStep = new Map();
  for (const input of inputs) {
    if (!byStep.has(input.step_id)) byStep.set(input.step_id, []);
    byStep.get(input.step_id).push(input);
  }

  let versions = [];
  if (header.root_recipe_id) {
    const { data: versionRows, error: vErr } = await supabase
      .from('stage_recipe_headers')
      .select('id, recipe_code, recipe_name, status, version_number, root_recipe_id, supersedes_recipe_id, created_at, activated_at, superseded_at')
      .eq('root_recipe_id', header.root_recipe_id)
      .order('version_number', { ascending: true });
    if (vErr) return { data: null, error: vErr };
    versions = versionRows ?? [];
  }

  return { data: { ...header, versions, steps: (steps ?? []).map((s) => ({ ...s, inputs: byStep.get(s.id) ?? [] })) }, error: null };
}

async function insertSteps(recipeId, steps = []) {
  const normalised = steps.map(normaliseStep);
  assertNoDuplicateSteps(normalised);
  if (!normalised.length) return;

  for (let i = 0; i < normalised.length; i += 1) {
    const stepPayload = { ...normalised[i], recipe_id: recipeId };
    const { data: step, error: sErr } = await supabase
      .from('stage_recipe_steps')
      .insert(stepPayload)
      .select('id')
      .single();
    if (sErr) throw sErr;

    const inputRows = (steps[i].inputs ?? []).filter((r) => r?.input_item_id).map((r) => ({ ...normaliseInput(r), step_id: step.id }));
    if (inputRows.length) {
      const { error: iErr } = await supabase.from('stage_recipe_inputs').insert(inputRows);
      if (iErr) throw iErr;
    }
  }
}

async function snapshotRecipeRows(recipeId) {
  const { data: header, error: hErr } = await supabase
    .from('stage_recipe_headers')
    .select('*')
    .eq('id', recipeId)
    .single();
  if (hErr) throw hErr;

  const { data: steps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select('*')
    .eq('recipe_id', recipeId)
    .order('step_no', { ascending: true });
  if (sErr) throw sErr;

  const stepIds = (steps ?? []).map((step) => step.id);
  const { data: inputs, error: iErr } = stepIds.length
    ? await supabase
        .from('stage_recipe_inputs')
        .select('*')
        .in('step_id', stepIds)
    : { data: [], error: null };
  if (iErr) throw iErr;

  return { header, steps: steps ?? [], inputs: inputs ?? [] };
}

async function restoreRecipeSnapshot(snapshot, userId) {
  if (!snapshot?.header?.id) return;

  await deleteGeneratedBomsForRecipe(snapshot.header.id).catch(() => {});

  const headerRestore = { ...snapshot.header, updated_by: userId, updated_at: new Date().toISOString() };
  delete headerRestore.created_at;

  await supabase
    .from('stage_recipe_headers')
    .update(headerRestore)
    .eq('id', snapshot.header.id);

  await supabase.from('stage_recipe_steps').delete().eq('recipe_id', snapshot.header.id);

  const stepIdMap = new Map();

  for (const oldStep of snapshot.steps || []) {
    const { id: oldStepId, created_at, updated_at, ...stepPayload } = oldStep;
    const { data: newStep, error: stepErr } = await supabase
      .from('stage_recipe_steps')
      .insert(stepPayload)
      .select('id')
      .single();

    if (stepErr) throw stepErr;
    stepIdMap.set(oldStepId, newStep.id);
  }

  const inputRows = [];
  for (const oldInput of snapshot.inputs || []) {
    const newStepId = stepIdMap.get(oldInput.step_id);
    if (!newStepId) continue;

    const { id, created_at, updated_at, ...inputPayload } = oldInput;
    inputRows.push({ ...inputPayload, step_id: newStepId });
  }

  if (inputRows.length) {
    const { error: inputErr } = await supabase
      .from('stage_recipe_inputs')
      .insert(inputRows);

    if (inputErr) throw inputErr;
  }

  await syncGeneratedBomsForRecipe(snapshot.header.id, userId);
}


async function getManufacturingBomTypeId() {
  const { data: exact, error: exactErr } = await supabase
    .from('bom_types')
    .select('id')
    .eq('is_active', true)
    .ilike('type_code', 'MFG')
    .maybeSingle();
  if (exactErr) throw exactErr;
  if (exact?.id) return exact.id;

  const { data: fallback, error: fallbackErr } = await supabase
    .from('bom_types')
    .select('id')
    .eq('is_active', true)
    .order('type_name', { ascending: true })
    .limit(1);
  if (fallbackErr) throw fallbackErr;
  if (!fallback?.[0]?.id) throw { code: 'VALIDATION_ERROR', message: 'Active BOM type not found. Create/activate a BOM type first.' };
  return fallback[0].id;
}

async function deleteGeneratedBomsForRecipe(recipeId) {
  const { data: boms, error: listErr } = await supabase
    .from('bom_headers')
    .select('id, generated_from_recipe_step_id')
    .eq('is_system_generated', true)
    .eq('generated_from_recipe_id', recipeId);
  if (listErr) throw listErr;

  const ids = (boms ?? []).map((b) => b.id);
  if (!ids.length) return;

  const { error: lineErr } = await supabase.from('bom_lines').delete().in('bom_id', ids);
  if (lineErr) throw lineErr;

  // Only delete BOM headers that were created for this recipe step.
  // If Recipe Builder reused an existing BOM and only stamped trace fields,
  // keep the header and clear the trace instead of deleting the master BOM.
  const reusableHeaderIds = (boms ?? []).filter((b) => !b.generated_from_recipe_step_id).map((b) => b.id);
  const generatedHeaderIds = (boms ?? []).filter((b) => b.generated_from_recipe_step_id).map((b) => b.id);

  if (generatedHeaderIds.length) {
    const { error: headerErr } = await supabase.from('bom_headers').delete().in('id', generatedHeaderIds);
    if (headerErr) throw headerErr;
  }

  if (reusableHeaderIds.length) {
    const { error: clearErr } = await supabase
      .from('bom_headers')
      .update({
        generated_from_recipe_id: null,
        generated_from_recipe_step_id: null,
        generated_at: null,
      })
      .in('id', reusableHeaderIds);
    if (clearErr) throw clearErr;
  }
}

export async function syncGeneratedBomsForRecipe(recipeId, userId) {
  const { data: header, error: hErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, recipe_code, recipe_name, status')
    .eq('id', recipeId)
    .single();
  if (hErr || !header) throw hErr ?? { code: 'NOT_FOUND', message: 'Stage recipe not found for BOM generation.' };

  const { data: steps, error: sErr } = await supabase
    .from('stage_recipe_steps')
    .select('id, step_no, output_item_id, output_basis_qty, output_basis_uom_id')
    .eq('recipe_id', recipeId)
    .order('step_no', { ascending: true });
  if (sErr) throw sErr;

  await deleteGeneratedBomsForRecipe(recipeId);

  const stepIds = (steps ?? []).map((s) => s.id);
  if (!stepIds.length) return;

  const { data: inputs, error: iErr } = await supabase
    .from('stage_recipe_inputs')
    .select(`
      id, step_id, input_item_id, qty, uom_id, qty_basis, notes,
      uom:uom_master(id, uom_code, uom_name),
      input_item:item_master!stage_recipe_inputs_input_item_id_fkey(id, item_code, item_name, uom_id)
    `)
    .in('step_id', stepIds);
  if (iErr) throw iErr;

  const byStep = new Map();
  for (const input of inputs ?? []) {
    if (!byStep.has(input.step_id)) byStep.set(input.step_id, []);
    byStep.get(input.step_id).push(input);
  }

  const bomTypeId = await getManufacturingBomTypeId();
  const bomStatus = header.status === 'active' ? 'active' : 'draft';

  for (const step of steps ?? []) {
    const stepInputs = (byStep.get(step.id) ?? []).filter((i) => i.input_item_id);
    if (!stepInputs.length) continue;

    for (const input of stepInputs) {
      if (input.input_item_id === step.output_item_id) {
        throw { code: 'VALIDATION_ERROR', message: `Recipe step ${step.step_no}: output item cannot also be an input item.` };
      }
      const lineUomId = input.uom_id || input.input_item?.uom_id;
      if (!lineUomId) {
        throw { code: 'VALIDATION_ERROR', message: `Recipe step ${step.step_no}: input item ${input.input_item?.item_code ?? ''} has no recipe/input UOM or item base UOM.` };
      }
    }

    const { data: existingBoms, error: existingBomErr } = await supabase
      .from('bom_headers')
      .select('id, status, created_at, is_system_generated, generated_from_recipe_step_id, generated_from_recipe_id')
      .eq('item_id', step.output_item_id);
    if (existingBomErr) throw existingBomErr;

    // RB-0A ownership safety: a system-generated BOM is owned by exactly one recipe step
    // (unique index bom_headers_generated_recipe_step_uq). Reuse ONLY the BOM already owned
    // by THIS step. Never adopt a manual BOM or a generated BOM owned by another step.
    const ownedByThisStep = (existingBoms ?? []).find(
      (b) => b.is_system_generated === true && b.generated_from_recipe_step_id === step.id
    ) ?? null;

    const manualBomExists = (existingBoms ?? []).some((b) => b.is_system_generated !== true);

    if (!ownedByThisStep && manualBomExists) {
      throw new Error('Manual BOM already exists for this item. Resolve in BOM Master before generating from Recipe Builder.');
    }

    const reusableBom = ownedByThisStep;

    let bom = reusableBom ? { id: reusableBom.id } : null;

    if (reusableBom) {
      const { error: traceErr } = await supabase
        .from('bom_headers')
        .update({
          is_system_generated: true,
          generated_from_recipe_id: recipeId,
          generated_from_recipe_step_id: step.id,
          generated_at: new Date().toISOString(),
          notes: `Linked to stage recipe ${header.recipe_code}, step ${step.step_no}. Edit Recipe Builder, not BOM.`,
        })
        .eq('id', reusableBom.id);
      if (traceErr) throw traceErr;

      const { error: clearLinesErr } = await supabase
        .from('bom_lines')
        .delete()
        .eq('bom_id', reusableBom.id);
      if (clearLinesErr) throw clearLinesErr;
    } else {
      const { data: createdBom, error: bomErr } = await supabase
        .from('bom_headers')
        .insert({
          item_id: step.output_item_id,
          bom_type_id: bomTypeId,
          status: bomStatus,
          effective_date: new Date().toISOString().slice(0, 10),
          notes: `Auto-generated from stage recipe ${header.recipe_code}, step ${step.step_no}. Edit Recipe Builder, not BOM.`,
          is_system_generated: true,
          generated_from_recipe_id: recipeId,
          generated_from_recipe_step_id: step.id,
          generated_at: new Date().toISOString(),
          created_by: userId,
        })
        .select('id')
        .single();
      if (bomErr) throw bomErr;
      bom = createdBom;
    }

    const outputBasisQty = num(step.output_basis_qty, 1);
    if (!(outputBasisQty > 0)) {
      throw { code: 'VALIDATION_ERROR', message: `Recipe step ${step.step_no}: To make quantity must be greater than 0.` };
    }

    const lineRows = stepInputs.map((input, idx) => {
      const qtyBasis = String(input.qty_basis || 'PER_OUTPUT').toUpperCase();
      const rawQty = num(input.qty, 1);
      const bomQty = qtyBasis === 'PER_BATCH'
        ? rawQty / outputBasisQty
        : rawQty;

      if (!(bomQty > 0)) {
        throw { code: 'VALIDATION_ERROR', message: `Recipe step ${step.step_no}: generated BOM quantity must be greater than 0.` };
      }

      return {
        bom_id: bom.id,
        component_item_id: input.input_item_id,
        quantity: bomQty,
        uom_id: input.uom_id || input.input_item.uom_id,
        scrap_factor: 0,
        is_optional: false,
        is_active: true,
        line_seq: idx + 1,
        component_type: 'RECIPE_INPUT',
        notes: [input.notes, `Qty basis: ${input.qty_basis || 'PER_OUTPUT'}`, qtyBasis === 'PER_BATCH' ? `Output basis: ${outputBasisQty}` : null].filter(Boolean).join(' | ') || null,
        created_by: userId,
      };
    });

    const { error: lineErr } = await supabase.from('bom_lines').insert(lineRows);
    if (lineErr) throw lineErr;
  }
}

export async function createStageRecipe(body, userId) {
  try {
    const headerPayload = applyFallbackFgItemId(normaliseHeader(body, userId, true), body.steps ?? []);
    const { data: existing } = await supabase
      .from('stage_recipe_headers')
      .select('id')
      .eq('recipe_code', headerPayload.recipe_code)
      .maybeSingle();
    if (existing) throw { code: 'CONFLICT', message: `Recipe code '${headerPayload.recipe_code}' already exists.` };

    const recipeId = randomUUID();
    const versionPayload = {
      ...headerPayload,
      id: recipeId,
      recipe_family_code: headerPayload.recipe_code,
      version_number: 1,
      root_recipe_id: recipeId,
      status: 'draft',
      activated_at: null,
      activated_by: null,
    };

    const { data: header, error: hErr } = await supabase
      .from('stage_recipe_headers')
      .insert(versionPayload)
      .select('id')
      .single();
    if (hErr) throw hErr;

    try {
      await insertSteps(header.id, body.steps ?? []);
    } catch (err) {
      await supabase.from('stage_recipe_headers').delete().eq('id', header.id);
      throw err;
    }

    return getStageRecipeById(header.id);
  } catch (err) {
    return { data: null, error: err };
  }
}

function stripVersionSuffix(code) {
  return String(code || '').replace(/_V\d+$/i, '');
}

async function nextRecipeVersion(rootRecipeId) {
  const { data, error } = await supabase
    .from('stage_recipe_headers')
    .select('version_number')
    .eq('root_recipe_id', rootRecipeId)
    .order('version_number', { ascending: false })
    .limit(1);
  if (error) throw error;
  return Number(data?.[0]?.version_number || 1) + 1;
}

export async function copyStageRecipeToDraft(id, userId) {
  try {
    const snapshot = await snapshotRecipeRows(id);
    const oldHeader = snapshot.header;
    if (!oldHeader?.id) throw { code: 'NOT_FOUND', message: 'Stage recipe not found.' };

    const baseCode = `${oldHeader.recipe_code}_COPY`;
    let newCode = baseCode;
    for (let n = 2; n < 1000; n += 1) {
      const { data: existing, error: existingErr } = await supabase
        .from('stage_recipe_headers')
        .select('id')
        .eq('recipe_code', newCode)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing?.id) break;
      newCode = `${baseCode}_${n}`;
    }

    const newId = randomUUID();
    const copyNote = `Copied from ${oldHeader.recipe_code}.`;
    const {
      id: oldId,
      created_at,
      updated_at,
      created_by,
      updated_by,
      activated_at,
      activated_by,
      superseded_at,
      superseded_by,
      ...copyHeader
    } = oldHeader;

    const headerPayload = applyFallbackFgItemId({
      ...copyHeader,
      id: newId,
      recipe_code: newCode,
      recipe_name: `${oldHeader.recipe_name || oldHeader.recipe_code} (Copy)`,
      recipe_family_code: newCode,
      status: 'draft',
      version_number: 1,
      root_recipe_id: newId,
      supersedes_recipe_id: null,
      activated_at: null,
      activated_by: null,
      superseded_at: null,
      superseded_by: null,
      created_by: userId,
      updated_by: null,
      updated_at: null,
      notes: oldHeader.notes ? `${copyNote} ${oldHeader.notes}` : copyNote,
    }, snapshot.steps || []);

    const { error: hErr } = await supabase.from('stage_recipe_headers').insert(headerPayload);
    if (hErr) throw hErr;

    const stepIdMap = new Map();
    for (const oldStep of snapshot.steps || []) {
      const { id: oldStepId, created_at: sCreated, updated_at: sUpdated, ...stepPayload } = oldStep;
      const { data: newStep, error: sErr } = await supabase
        .from('stage_recipe_steps')
        .insert({ ...stepPayload, recipe_id: newId })
        .select('id')
        .single();
      if (sErr) throw sErr;
      stepIdMap.set(oldStepId, newStep.id);
    }

    const inputRows = [];
    for (const oldInput of snapshot.inputs || []) {
      const newStepId = stepIdMap.get(oldInput.step_id);
      if (!newStepId) continue;
      const { id: inputId, created_at: iCreated, updated_at: iUpdated, ...inputPayload } = oldInput;
      inputRows.push({ ...inputPayload, step_id: newStepId });
    }

    if (inputRows.length) {
      const { error: iErr } = await supabase.from('stage_recipe_inputs').insert(inputRows);
      if (iErr) throw iErr;
    }

    return getStageRecipeById(newId);
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function copyStageRecipeToSku(id, mapping, userId) {
  try {
    const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
    if (!isPlainObject(mapping)) throw { code: 'VALIDATION_ERROR', message: 'mapping must be an object.' };

    const outputItemId = mapping.outputItemId;
    const stepOutputMap = mapping.stepOutputMap ?? {};
    const inputMap = mapping.inputMap ?? {};

    if (!isPlainObject(stepOutputMap)) throw { code: 'VALIDATION_ERROR', message: 'stepOutputMap must be an object (item-id -> item-id).' };
    if (!isPlainObject(inputMap)) throw { code: 'VALIDATION_ERROR', message: 'inputMap must be an object (item-id -> item-id).' };
    if (!outputItemId || typeof outputItemId !== 'string') throw { code: 'VALIDATION_ERROR', message: 'outputItemId is required.' };

    const snapshot = await snapshotRecipeRows(id);
    const oldHeader = snapshot.header;
    if (!oldHeader?.id) throw { code: 'NOT_FOUND', message: 'Stage recipe not found.' };

    const steps = snapshot.steps ?? [];
    const inputs = snapshot.inputs ?? [];

    if (steps.some((s) => s.output_item_id == null)) throw { code: 'VALIDATION_ERROR', message: 'A source step has no output item; cannot map.' };
    if (inputs.some((i) => i.input_item_id == null)) throw { code: 'VALIDATION_ERROR', message: 'A source input has no input item; cannot map.' };

    const srcStepOutIds = [...new Set(steps.map((s) => s.output_item_id))];
    const srcInputIds = [...new Set(inputs.map((i) => i.input_item_id))];

    const missingStepOut = srcStepOutIds.filter((x) => !(x in stepOutputMap));
    if (missingStepOut.length) throw { code: 'VALIDATION_ERROR', message: `Unmapped step output item(s): ${missingStepOut.join(', ')}` };

    const missingInput = srcInputIds.filter((x) => !(x in inputMap));
    if (missingInput.length) throw { code: 'VALIDATION_ERROR', message: `Unmapped input item(s): ${missingInput.join(', ')}` };

    const unknownStepKeys = Object.keys(stepOutputMap).filter((k) => !srcStepOutIds.includes(k));
    if (unknownStepKeys.length) throw { code: 'VALIDATION_ERROR', message: `stepOutputMap has item(s) not in this recipe: ${unknownStepKeys.join(', ')}` };

    const unknownInputKeys = Object.keys(inputMap).filter((k) => !srcInputIds.includes(k));
    if (unknownInputKeys.length) throw { code: 'VALIDATION_ERROR', message: `inputMap has item(s) not in this recipe: ${unknownInputKeys.join(', ')}` };

    const badStepVals = Object.entries(stepOutputMap).filter(([, v]) => !v || typeof v !== 'string').map(([k]) => k);
    if (badStepVals.length) throw { code: 'VALIDATION_ERROR', message: `stepOutputMap has invalid target item id for source: ${badStepVals.join(', ')}` };

    const badInputVals = Object.entries(inputMap).filter(([, v]) => !v || typeof v !== 'string').map(([k]) => k);
    if (badInputVals.length) throw { code: 'VALIDATION_ERROR', message: `inputMap has invalid target item id for source: ${badInputVals.join(', ')}` };

    const targetIds = [...new Set([outputItemId, ...Object.values(stepOutputMap), ...Object.values(inputMap)])];
    const { data: foundItems, error: itemErr } = await supabase
      .from('item_master')
      .select('id, item_code')
      .in('id', targetIds);
    if (itemErr) throw itemErr;

    const foundIds = new Set((foundItems ?? []).map((r) => r.id));
    const missingTargets = targetIds.filter((x) => !foundIds.has(x));
    if (missingTargets.length) throw { code: 'VALIDATION_ERROR', message: `Target item(s) not found in item_master: ${missingTargets.join(', ')}` };

    const targetOutput = (foundItems ?? []).find((r) => r.id === outputItemId);
    const targetCode = String(targetOutput?.item_code ?? '').toUpperCase();
    if (!targetCode) throw { code: 'VALIDATION_ERROR', message: 'Target output item has no item_code.' };

    const baseCode = `${targetCode}_COPY`;
    let newCode = baseCode;
    for (let n = 2; n < 1000; n += 1) {
      const { data: existing, error: existingErr } = await supabase
        .from('stage_recipe_headers')
        .select('id')
        .eq('recipe_code', newCode)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing?.id) break;
      newCode = `${baseCode}_${n}`;
    }

    const newId = randomUUID();
    const copyNote = `Copied from ${oldHeader.recipe_code} to SKU ${targetCode}.`;
    const {
      id: oldId,
      created_at,
      updated_at,
      created_by,
      updated_by,
      activated_at,
      activated_by,
      superseded_at,
      superseded_by,
      ...copyHeader
    } = oldHeader;

    const headerPayload = applyFallbackFgItemId({
      ...copyHeader,
      id: newId,
      recipe_code: newCode,
      recipe_name: `${targetCode} (Copy of ${oldHeader.recipe_code})`,
      recipe_family_code: newCode,
      fg_item_id: outputItemId,
      status: 'draft',
      version_number: 1,
      root_recipe_id: newId,
      supersedes_recipe_id: null,
      activated_at: null,
      activated_by: null,
      superseded_at: null,
      superseded_by: null,
      created_by: userId,
      updated_by: null,
      updated_at: null,
      notes: oldHeader.notes ? `${copyNote} ${oldHeader.notes}` : copyNote,
    }, steps);

    const { error: hErr } = await supabase.from('stage_recipe_headers').insert(headerPayload);
    if (hErr) throw hErr;

    try {
      const stepIdMap = new Map();

      for (const oldStep of steps) {
        const { id: oldStepId, created_at: sCreated, updated_at: sUpdated, ...stepPayload } = oldStep;
        const { data: newStep, error: sErr } = await supabase
          .from('stage_recipe_steps')
          .insert({ ...stepPayload, output_item_id: stepOutputMap[oldStep.output_item_id], recipe_id: newId })
          .select('id')
          .single();
        if (sErr) throw sErr;
        stepIdMap.set(oldStepId, newStep.id);
      }

      const inputRows = [];
      for (const oldInput of inputs) {
        const newStepId = stepIdMap.get(oldInput.step_id);
        if (!newStepId) continue;

        const { id: inputId, created_at: iCreated, updated_at: iUpdated, ...inputPayload } = oldInput;
        inputRows.push({
          ...inputPayload,
          input_item_id: inputMap[oldInput.input_item_id],
          step_id: newStepId,
        });
      }

      if (inputRows.length) {
        const { error: iErr } = await supabase.from('stage_recipe_inputs').insert(inputRows);
        if (iErr) throw iErr;
      }
    } catch (childErr) {
      await supabase.from('stage_recipe_headers').delete().eq('id', newId);
      throw childErr;
    }

    return getStageRecipeById(newId);
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function copyStageRecipeToManySkus(id, mappings, userId) {
  try {
    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw { code: 'VALIDATION_ERROR', message: 'mappings must be a non-empty array.' };
    }

    const results = [];

    for (const mapping of mappings) {
      const outputItemId = (mapping && typeof mapping === 'object' && !Array.isArray(mapping))
        ? mapping.outputItemId
        : undefined;

      const { data, error } = await copyStageRecipeToSku(id, mapping, userId);

      if (error) {
        results.push({
          ok: false,
          outputItemId: outputItemId ?? null,
          recipeId: null,
          recipeCode: null,
          error: {
            code: error.code ?? 'INTERNAL_ERROR',
            message: error.message ?? String(error),
          },
        });
      } else {
        results.push({
          ok: true,
          outputItemId: outputItemId ?? data?.fg_item_id ?? null,
          recipeId: data?.id ?? null,
          recipeCode: data?.recipe_code ?? null,
          error: null,
        });
      }
    }

    const created = results.filter((r) => r.ok).length;
    return { data: { results, created, failed: results.length - created }, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}



export async function createNewVersionStageRecipe(id, userId) {
  try {
    const snapshot = await snapshotRecipeRows(id);
    const oldHeader = snapshot.header;
    if (!oldHeader?.id) throw { code: 'NOT_FOUND', message: 'Stage recipe not found.' };
    if (oldHeader.status === 'draft') throw { code: 'CONFLICT', message: 'Draft recipe can be edited directly. New version is only for active/inactive recipes.' };

    const rootRecipeId = oldHeader.root_recipe_id || oldHeader.id;
    const familyCode = oldHeader.recipe_family_code || stripVersionSuffix(oldHeader.recipe_code);

    const { data: existingDraft, error: draftErr } = await supabase
      .from('stage_recipe_headers')
      .select('id')
      .eq('root_recipe_id', rootRecipeId)
      .eq('supersedes_recipe_id', oldHeader.id)
      .eq('status', 'draft')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draftErr) throw draftErr;
    if (existingDraft?.id) return getStageRecipeById(existingDraft.id);

    const nextVersion = await nextRecipeVersion(rootRecipeId);
    const newId = randomUUID();
    const newCode = `${familyCode}_V${nextVersion}`;

    const { data: codeExists } = await supabase
      .from('stage_recipe_headers')
      .select('id')
      .eq('recipe_code', newCode)
      .maybeSingle();
    if (codeExists?.id) return getStageRecipeById(codeExists.id);

    const { id: oldId, created_at, updated_at, created_by, updated_by, activated_at, activated_by, superseded_at, superseded_by, ...copyHeader } = oldHeader;
    const headerPayload = applyFallbackFgItemId({
      ...copyHeader,
      id: newId,
      recipe_code: newCode,
      recipe_name: `${oldHeader.recipe_name} V${nextVersion}`,
      status: 'draft',
      recipe_family_code: familyCode,
      version_number: nextVersion,
      root_recipe_id: rootRecipeId,
      supersedes_recipe_id: oldHeader.id,
      activated_at: null,
      activated_by: null,
      superseded_at: null,
      superseded_by: null,
      created_by: userId,
      updated_by: null,
      updated_at: null,
    }, snapshot.steps || []);

    const { error: hErr } = await supabase.from('stage_recipe_headers').insert(headerPayload);
    if (hErr) throw hErr;

    const stepIdMap = new Map();
    for (const oldStep of snapshot.steps || []) {
      const { id: oldStepId, created_at: sCreated, updated_at: sUpdated, ...stepPayload } = oldStep;
      const { data: newStep, error: sErr } = await supabase
        .from('stage_recipe_steps')
        .insert({ ...stepPayload, recipe_id: newId })
        .select('id')
        .single();
      if (sErr) throw sErr;
      stepIdMap.set(oldStepId, newStep.id);
    }

    const inputRows = [];
    for (const oldInput of snapshot.inputs || []) {
      const newStepId = stepIdMap.get(oldInput.step_id);
      if (!newStepId) continue;
      const { id: inputId, created_at: iCreated, updated_at: iUpdated, ...inputPayload } = oldInput;
      inputRows.push({ ...inputPayload, step_id: newStepId });
    }

    if (inputRows.length) {
      const { error: iErr } = await supabase.from('stage_recipe_inputs').insert(inputRows);
      if (iErr) throw iErr;
    }

    return getStageRecipeById(newId);
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function activateStageRecipe(id, userId) {
  try {
    const { data: target, error: tErr } = await supabase
      .from('stage_recipe_headers')
      .select('id, status, root_recipe_id, recipe_family_code, version_number')
      .eq('id', id)
      .maybeSingle();
    if (tErr || !target) throw { code: 'NOT_FOUND', message: 'Stage recipe not found.' };
    if (target.status !== 'draft') throw { code: 'CONFLICT', message: 'Only draft recipe versions can be activated.' };

    await ensureHeaderFgItemIdFromExistingSteps(id);

    const now = new Date().toISOString();
    const rootRecipeId = target.root_recipe_id || target.id;

    const { data: oldActive, error: oldErr } = await supabase
      .from('stage_recipe_headers')
      .select('id')
      .eq('root_recipe_id', rootRecipeId)
      .eq('status', 'active');
    if (oldErr) throw oldErr;

    const oldActiveIds = (oldActive || []).map((r) => r.id).filter((oldId) => oldId !== id);
    if (oldActiveIds.length) {
      const { error: supErr } = await supabase
        .from('stage_recipe_headers')
        .update({ status: 'superseded', superseded_at: now, superseded_by: userId, updated_by: userId, updated_at: now })
        .in('id', oldActiveIds);
      if (supErr) throw supErr;

      for (const oldId of oldActiveIds) {
        await deleteGeneratedBomsForRecipe(oldId).catch(() => {});
      }
    }

    const { error: actErr } = await supabase
      .from('stage_recipe_headers')
      .update({ status: 'active', activated_at: now, activated_by: userId, updated_by: userId, updated_at: now })
      .eq('id', id);
    if (actErr) throw actErr;

    await syncGeneratedBomsForRecipe(id, userId);
    return getStageRecipeById(id);
  } catch (err) {
    return { data: null, error: err };
  }
}


export async function updateStageRecipe(id, body, userId) {
  let snapshot = null;

  try {
    const { data: existing, error: eErr } = await supabase
      .from('stage_recipe_headers')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (eErr || !existing) throw { code: 'NOT_FOUND', message: 'Stage recipe not found.' };
    if (existing.status === 'active') throw { code: 'CONFLICT', message: 'Active recipe cannot be edited directly. Create a new version first.' };
    if (existing.status === 'superseded') throw { code: 'CONFLICT', message: 'Superseded recipe cannot be edited.' };
    if (String(body.status || '').toLowerCase() === 'active') {
      throw { code: 'CONFLICT', message: 'Use Activate Version button to activate a recipe.' };
    }

    snapshot = await snapshotRecipeRows(id);

    const headerPayload = applyFallbackFgItemId(normaliseHeader(body, userId, false), body.steps ?? []);
    const { error: hErr } = await supabase
      .from('stage_recipe_headers')
      .update(headerPayload)
      .eq('id', id);
    if (hErr) throw hErr;

    // V1 replace-steps behavior with compensation rollback if any insert/sync fails.
    const { error: delErr } = await supabase.from('stage_recipe_steps').delete().eq('recipe_id', id);
    if (delErr) throw delErr;

    try {
      await insertSteps(id, body.steps ?? []);
    } catch (err) {
      await restoreRecipeSnapshot(snapshot, userId);
      throw err;
    }

    return getStageRecipeById(id);
  } catch (err) {
    if (snapshot) {
      try {
        await restoreRecipeSnapshot(snapshot, userId);
      } catch (restoreErr) {
        console.error('Failed to restore stage recipe snapshot after update error:', restoreErr);
      }
    }

    return { data: null, error: err };
  }
}

export async function deleteStageRecipe(id) {
  try {
    await deleteGeneratedBomsForRecipe(id);
    const { error } = await supabase.from('stage_recipe_headers').delete().eq('id', id);
    return { data: error ? null : { id, deleted: true }, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 8Y-8A Recipe Builder Preview (read-only).
// Does NOT save, post inventory, or generate/modify BOM.
// Input requirement rules (locked DP decisions):
//   FIXED      = input qty (unscaled).                                  [DP2]
//   PER_OUTPUT = input qty x preview output qty.
//   PER_SET    = treated same as PER_OUTPUT.                            [DP3]
//   PER_BATCH  = preview output qty x input qty / output_basis_qty.
// Runtime is taken from the shared engine (recipeCalculationService
// .calculateStepRuntime) — no runtime math is reinvented here.
// TODO(8Y-8A/DP2): generated-BOM sync (syncGeneratedBomsForRecipe) currently
// scales FIXED-basis inputs per output. That FIXED behaviour should be reviewed
// separately; it is intentionally NOT changed in this preview-only task.
// ---------------------------------------------------------------------------

const PREVIEW_MACHINE_COLS =
  'id, machine_code, machine_name, capacity_basis, planning_capacity, rated_capacity, capacity_uom, ' +
  'cycle_time_sec, setup_time_min, changeover_time_min, pcs_per_cycle, pcs_per_hour, tray_capacity, ' +
  'batch_capacity_kg, slots_count, capacity_tolerance_percent';

const PREVIEW_ITEM_COLS =
  'id, item_code, item_name, uom_id, stage_type, weight_g, bp_weight_g, default_pcs_per_tray, ' +
  'default_pcs_per_crate, pcs_per_set, cavity_count';

function previewRound(value) {
  const nVal = Number(value);
  if (!Number.isFinite(nVal)) return null;
  return Math.round(nVal * 10000) / 10000;
}

function previewDisplayQty(qty, uomCode) {
  const code = String(uomCode || '').toUpperCase();
  const nQty = Number(qty);
  if (!Number.isFinite(nQty)) return { qty: null, uom: code };
  if (['G', 'GM', 'GRM', 'GRAM', 'GRAMS'].includes(code) && Math.abs(nQty) >= 1000) {
    return { qty: previewRound(nQty / 1000), uom: 'KG' };
  }
  return { qty: previewRound(nQty), uom: code };
}

function previewFormatRuntime(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '—';
  const total = Math.max(0, Math.ceil(Number(minutes)));
  if (total < 60) return `${total} min`;
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

export async function previewStageRecipe(body = {}) {
  try {
    const previewQty = num(body.preview_qty, null);
    if (!(previewQty > 0)) {
      throw { code: 'VALIDATION_ERROR', message: 'Preview quantity must be greater than 0.' };
    }

    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (!steps.length) {
      return {
        data: { preview_qty: previewQty, rows: [], summary: { step_count: 0, total_runtime_minutes: 0, missing_runtime_count: 0 } },
        error: null,
      };
    }

    const itemIds = new Set();
    const machineIds = new Set();
    const processIds = new Set();
    const uomIds = new Set();
    for (const s of steps) {
      if (s.output_item_id) itemIds.add(s.output_item_id);
      if (s.machine_id) machineIds.add(s.machine_id);
      if (s.process_type_id) processIds.add(s.process_type_id);
      if (s.output_basis_uom_id) uomIds.add(s.output_basis_uom_id);
      for (const inp of s.inputs ?? []) {
        if (inp?.input_item_id) itemIds.add(inp.input_item_id);
        if (inp?.uom_id) uomIds.add(inp.uom_id);
      }
    }

    const [itemRes, machineRes, processRes, uomRes] = await Promise.all([
      itemIds.size
        ? supabase.from('item_master').select(PREVIEW_ITEM_COLS).in('id', [...itemIds])
        : { data: [], error: null },
      machineIds.size
        ? supabase.from('machine_master').select(PREVIEW_MACHINE_COLS).in('id', [...machineIds])
        : { data: [], error: null },
      processIds.size
        ? supabase.from('process_types').select('id, type_code, type_name').in('id', [...processIds])
        : { data: [], error: null },
      uomIds.size
        ? supabase.from('uom_master').select('id, uom_code, uom_name').in('id', [...uomIds])
        : { data: [], error: null },
    ]);
    if (itemRes.error) throw itemRes.error;
    if (machineRes.error) throw machineRes.error;
    if (processRes.error) throw processRes.error;
    if (uomRes.error) throw uomRes.error;

    const itemMap = new Map((itemRes.data ?? []).map((r) => [r.id, r]));
    const machineMap = new Map((machineRes.data ?? []).map((r) => [r.id, r]));
    const processMap = new Map((processRes.data ?? []).map((r) => [r.id, r]));
    const uomMap = new Map((uomRes.data ?? []).map((r) => [r.id, r]));

    const rows = [];
    let totalRuntime = 0;
    let missingCount = 0;

    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i];
      const stepNo = intNum(s.step_no, i + 1);
      const outputItem = s.output_item_id ? itemMap.get(s.output_item_id) ?? null : null;
      const machine = s.machine_id ? machineMap.get(s.machine_id) ?? null : null;
      const process = s.process_type_id ? processMap.get(s.process_type_id) ?? null : null;
      const outputUom = s.output_basis_uom_id ? uomMap.get(s.output_basis_uom_id) ?? null : null;
      const outputBasisQty = num(s.output_basis_qty, 1);

      // DP1: per-step independent preview — each step previewed at preview_qty.
      const outputQty = previewQty;

      const rawInputs = (s.inputs ?? []).filter((inp) => inp?.input_item_id);

      const inputs = rawInputs.map((inp) => {
        const inItem = itemMap.get(inp.input_item_id) ?? null;
        const inUom = inp.uom_id ? uomMap.get(inp.uom_id) ?? null : null;
        const uomCode = inUom?.uom_code ?? '';
        const qty = num(inp.qty, 0);
        const qtyBasis = String(inp.qty_basis || 'PER_OUTPUT').toUpperCase();

        let requiredQty = null;
        let issue = null;
        if (qtyBasis === 'FIXED') {
          requiredQty = qty;
        } else if (qtyBasis === 'PER_BATCH') {
          if (outputBasisQty > 0) requiredQty = outputQty * (qty / outputBasisQty);
          else issue = 'To make (output basis) qty must be greater than 0.';
        } else {
          // PER_OUTPUT and PER_SET both scale per output unit.
          requiredQty = outputQty * qty;
        }

        const disp = requiredQty === null ? { qty: null, uom: uomCode } : previewDisplayQty(requiredQty, uomCode);
        return {
          item_code: inItem?.item_code ?? null,
          item_name: inItem?.item_name ?? null,
          required_qty: previewRound(requiredQty),
          uom_code: uomCode,
          display_qty: disp.qty,
          display_uom_code: disp.uom,
          qty_basis: qtyBasis,
          ...(issue ? { issue } : {}),
        };
      });

      const recipeStep = {
        calculation_basis: s.calculation_basis || null,
        inputs: rawInputs.map((inp) => ({
          input_item_id: inp.input_item_id,
          qty: num(inp.qty, 0),
          qty_basis: String(inp.qty_basis || 'PER_OUTPUT').toUpperCase(),
          uom: inp.uom_id ? { uom_code: uomMap.get(inp.uom_id)?.uom_code ?? '' } : null,
          input_item: itemMap.get(inp.input_item_id) ?? null,
        })),
        machine,
        output_item: outputItem,
        process,
      };

      let runtime;
      try {
        const rt = await calculateStepRuntime(recipeStep, outputQty, { machine, process, outputItem });
        const expected = rt?.expected_minutes ?? null;
        const missing = Boolean(rt?.missing_standard) || expected === null;
        runtime = {
          expected_minutes: expected,
          display_runtime: previewFormatRuntime(expected),
          missing_standard: missing,
          missing_reason: missing ? (rt?.warnings?.[0] ?? 'Required standard missing.') : null,
          basis: rt?.basis ?? (s.calculation_basis || machine?.capacity_basis || null),
          warnings: rt?.warnings ?? [],
        };
        if (!missing && Number.isFinite(Number(expected))) totalRuntime += Number(expected);
        else missingCount += 1;
      } catch (rtErr) {
        runtime = {
          expected_minutes: null,
          display_runtime: '—',
          missing_standard: true,
          missing_reason: rtErr?.message ?? 'Runtime calculation failed.',
          basis: s.calculation_basis || machine?.capacity_basis || null,
          warnings: [],
        };
        missingCount += 1;
      }

      rows.push({
        step_no: stepNo,
        output_item_code: outputItem?.item_code ?? null,
        output_item_name: outputItem?.item_name ?? null,
        output_qty: previewRound(outputQty),
        output_uom_code: outputUom?.uom_code ?? '',
        inputs,
        runtime,
      });
    }

    return {
      data: {
        preview_qty: previewQty,
        rows,
        summary: {
          step_count: rows.length,
          total_runtime_minutes: Math.ceil(totalRuntime),
          missing_runtime_count: missingCount,
        },
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err };
  }
}
