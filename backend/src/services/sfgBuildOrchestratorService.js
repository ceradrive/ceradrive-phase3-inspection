/**
 * CERADRIVE ERP — SFG Build Orchestrator (P-SFG-2A-1)
 *
 * Single shared generator entry used by BOTH the manual wizard and (future) Excel import.
 *
 * 2A-1 SCOPE = previewBuild() ONLY. Read-only.
 *   - resolveContext(): SELECT-only master lookups (item_master, machine_master, die_master).
 *   - assemblePreview(): pure core (sfgBuildPreviewCore) — items/recipe/BOM/routing/links/blocks.
 *   - machine_time: shared engine recipeCalculationService.calculateStepRuntime (no math reinvented).
 *
 * commitBuild() is intentionally NOT IMPLEMENTED in this phase and throws.
 * There are NO insert/update/upsert/delete/rpc calls anywhere in this file.
 */

import { supabase } from '../config/supabase.js';
import { assemblePreview, ABSTRACT_STAGE_EDGES, activeStageEdges } from './sfgBuildPreviewCore.js';
import { calculateStepRuntime } from './recipeCalculationService.js';
import { createStageRecipe, syncGeneratedBomsForRecipe } from './stageRecipeService.js';
import { createRouting } from './routingService.js';
import { FEATURE_FLAGS } from '../config/featureFlags.js';

// Master gate. When enabled it also un-gates every sub-slice for the orchestrated run.
function fullGenerateEnabled() {
  return FEATURE_FLAGS.sfg_full_generate_enabled === true || process.env.SFG_FULL_GENERATE_ENABLED === 'true';
}
// Commit is gated. Stays false in committed code; enable per-run via env for tests only.
function commitEnabled() {
  return FEATURE_FLAGS.sfg_commit_enabled === true || process.env.SFG_COMMIT_ENABLED === 'true' || fullGenerateEnabled();
}
function recipeCommitEnabled() {
  return FEATURE_FLAGS.sfg_recipe_commit_enabled === true || process.env.SFG_RECIPE_COMMIT_ENABLED === 'true' || fullGenerateEnabled();
}
function recipeActivateEnabled() {
  return FEATURE_FLAGS.sfg_recipe_activate_enabled === true || process.env.SFG_RECIPE_ACTIVATE_ENABLED === 'true' || fullGenerateEnabled();
}
function bomCommitEnabled() {
  return FEATURE_FLAGS.sfg_bom_commit_enabled === true || process.env.SFG_BOM_COMMIT_ENABLED === 'true' || fullGenerateEnabled();
}
function routingCommitEnabled() {
  return FEATURE_FLAGS.sfg_routing_commit_enabled === true || process.env.SFG_ROUTING_COMMIT_ENABLED === 'true' || fullGenerateEnabled();
}
function linksCommitEnabled() {
  return FEATURE_FLAGS.sfg_links_commit_enabled === true || process.env.SFG_LINKS_COMMIT_ENABLED === 'true' || fullGenerateEnabled();
}
export { commitEnabled, recipeCommitEnabled, recipeActivateEnabled, bomCommitEnabled, routingCommitEnabled, linksCommitEnabled, fullGenerateEnabled };

// calculation_basis values accepted by stage_recipe_steps (preview PER_OUTPUT/PER_SET -> MANUAL for draft)
const RECIPE_CALC_BASIS = new Set(['WEIGHT_BATCH', 'PCS_TRAY', 'DIE_CAVITY', 'PCS_CYCLE', 'PCS_PER_HOUR', 'PCS_PER_MIN', 'PCS_CRATE', 'TRAY_BATCH', 'MANUAL']);
const RECIPE_NOT_WRITTEN = Object.freeze(['recipe_activation', 'bom', 'routing', 'fg_sfg_links', 'inventory']);

function up(v) { return String(v ?? '').trim().toUpperCase(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function pos(v) { const n = num(v); return n != null && n > 0 ? n : null; }
function isUuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }

/* SFG-MTS-MTO-SPLIT-1 (merged) — Patch 1: split SFG generation at the STK boundary
 * into a MAKE_TO_STOCK recipe/routing keyed on the STK item and a MAKE_TO_ORDER
 * recipe/routing keyed on the final SET item. DRAFTS ONLY — no timing/standards
 * persistence, default moulding machine binding (Patch 2A), no activation change, no IPP shortcut,
 * no SET-routing-borrow. Legacy single recipe/routing fallback when no STK boundary. */

// strip an "SR-" prefix to derive the base SKU code for split recipe codes.
function recipeBaseCode(preview, rc) {
  const raw = up(rc?.recipe_code || preview?.parent_sku || 'SFG');
  return raw.startsWith('SR-') ? raw.slice(3) : raw;
}

// STK boundary detect: explicit stage_code OR an output item code containing _STK.
function isStkRecipeStep(step) {
  return up(step?.stage_code) === 'STK' || /_STK/.test(up(step?.output_item_code || ''));
}

function renumberRecipeSteps(steps = []) {
  return (steps || []).map((step, idx) => ({ ...step, step_no: idx + 1 }));
}

// draft routing-step capability flags by process (heuristic defaults; reviewed/edited
// in Routing later; NOT master-driven — refine from process master in a follow-up).
function processRequirementFlags(processCode) {
  const code = up(processCode);
  return {
    machine_required: !['MANUAL', 'PACKING'].includes(code),
    die_required: code === 'MOULDING',
    labour_required: ['STACKING', 'PRINTING', 'RIVETING', 'SHRINK_WRAP', 'PACKING'].includes(code),
    qc_required: false,
  };
}

// Positional split at the STK step: steps[0..stk] -> MTS (fg=STK, MAKE_TO_STOCK),
// steps[stk+1..end] -> MTO (fg=SET, MAKE_TO_ORDER). Returns { specs:[], error } when
// there is no STK boundary -> caller falls back to the legacy single recipe/routing.
function buildSplitRecipeSpecs(preview, rc) {
  const allSteps = Array.isArray(rc?.steps) ? rc.steps : [];
  if (!preview?.parent_sku || !rc?.recipe_code || !allSteps.length) return { specs: [], error: 'NO_RECIPE' };

  const stkIdx = allSteps.findIndex(isStkRecipeStep);
  if (stkIdx < 0) return { specs: [], error: 'STK_STEP_MISSING' };

  const mtsSteps = renumberRecipeSteps(allSteps.slice(0, stkIdx + 1));
  const mtoSteps = renumberRecipeSteps(allSteps.slice(stkIdx + 1));
  const stkCode = up(mtsSteps[mtsSteps.length - 1]?.output_item_code);
  const setCode = up(preview.parent_sku);
  if (!stkCode) return { specs: [], error: 'STK_OUTPUT_MISSING' };
  if (!mtoSteps.length) return { specs: [], error: 'MTO_STEPS_MISSING' };

  const base = recipeBaseCode(preview, rc);
  return {
    error: null,
    boundary: { stk_item_code: stkCode, set_item_code: setCode, mts_steps: mtsSteps.length, mto_steps: mtoSteps.length },
    specs: [
      { kind: 'MTS_STK', recipe_code: `SR-${stkCode}-MTS`, recipe_name: `${stkCode} MTS recipe`, fg_item_code: stkCode, fg_stage_code: 'STK', make_policy: 'MAKE_TO_STOCK', planning_unit: 'PCS', steps: mtsSteps },
      { kind: 'MTO_SET', recipe_code: `SR-${base}-MTO`, recipe_name: `${setCode} MTO recipe`, fg_item_code: setCode, fg_stage_code: 'SET', make_policy: 'MAKE_TO_ORDER', planning_unit: 'PCS', steps: mtoSteps },
    ],
  };
}

function collectRecipeSpecCodes(specs = []) {
  const set = new Set();
  for (const spec of specs) {
    set.add(up(spec.fg_item_code));
    for (const s of (spec.steps || [])) {
      set.add(up(s.output_item_code));
      for (const i of (s.inputs || [])) set.add(up(i.input_item_code));
    }
  }
  return [...set].filter(Boolean);
}


function recipeSpecsForPreview(preview = {}) {
  const rc = preview?.recipe;
  if (!rc || !rc.recipe_code || !(rc.steps || []).length) return { specs: [], split: null, recipe_code: null };
  const split = buildSplitRecipeSpecs(preview, rc);
  if (!split.error && split.specs.length) return { specs: split.specs, split, recipe_code: rc.recipe_code };
  return {
    specs: [{
      kind: 'LEGACY_SET',
      recipe_code: rc.recipe_code,
      recipe_name: `${preview.parent_sku || recipeBaseCode(preview, rc)} recipe`,
      fg_item_code: preview.parent_sku,
      fg_stage_code: 'SET',
      make_policy: 'MAKE_TO_ORDER',
      planning_unit: 'PCS',
      steps: rc.steps || [],
    }],
    split: null,
    recipe_code: rc.recipe_code,
  };
}

async function activateOneRecipeByCode(recipeCode, userId, notWritten) {
  const { data: rec, error: rErr } = await supabase
    .from('stage_recipe_headers')
    .select('id, status, root_recipe_id')
    .eq('recipe_code', recipeCode)
    .maybeSingle();
  if (rErr) return { data: null, error: { code: rErr.code || 'INTERNAL_ERROR', message: rErr.message } };
  if (!rec) return { data: { committed: false, reason: 'RECIPE_MISSING', recipe_code: recipeCode, not_written: notWritten }, error: null };
  if (rec.status === 'active') {
    return { data: { committed: true, recipe: { action: 'USE_EXISTING', id: rec.id, recipe_code: recipeCode, status: 'active' }, superseded: [] }, error: null };
  }
  if (rec.status !== 'draft') {
    return { data: { committed: false, reason: 'NOT_DRAFT', recipe_code: recipeCode, status: rec.status, not_written: notWritten }, error: null };
  }

  const now = new Date().toISOString();
  const root = rec.root_recipe_id || rec.id;
  const { data: oldActive, error: oErr } = await supabase
    .from('stage_recipe_headers')
    .select('id')
    .eq('root_recipe_id', root)
    .eq('status', 'active');
  if (oErr) return { data: null, error: { code: oErr.code || 'INTERNAL_ERROR', message: oErr.message } };
  const oldIds = (oldActive || []).map((r) => r.id).filter((i) => i !== rec.id);
  if (oldIds.length) {
    const { error: supErr } = await supabase
      .from('stage_recipe_headers')
      .update({ status: 'superseded', superseded_at: now, superseded_by: userId, updated_by: userId, updated_at: now })
      .in('id', oldIds);
    if (supErr) return { data: null, error: { code: supErr.code || 'INTERNAL_ERROR', message: supErr.message } };
  }

  const { error: actErr } = await supabase
    .from('stage_recipe_headers')
    .update({ status: 'active', activated_at: now, activated_by: userId, updated_by: userId, updated_at: now })
    .eq('id', rec.id);
  if (actErr) return { data: null, error: { code: actErr.code || 'INTERNAL_ERROR', message: actErr.message } };
  return { data: { committed: true, recipe: { action: 'ACTIVATED', id: rec.id, recipe_code: recipeCode, status: 'active' }, superseded: oldIds }, error: null };
}

async function activeRecipesForSpecs(specs = [], notWritten) {
  const codes = [...new Set((specs || []).map((s) => up(s.recipe_code)).filter(Boolean))];
  if (!codes.length) return { data: null, error: null, missing: [], inactive: [] };
  const { data, error } = await supabase
    .from('stage_recipe_headers')
    .select('id, recipe_code, status')
    .in('recipe_code', codes);
  if (error) return { data: null, error: { code: error.code || 'INTERNAL_ERROR', message: error.message } };
  const byCode = new Map((data || []).map((r) => [up(r.recipe_code), r]));
  const missing = codes.filter((c) => !byCode.has(c));
  const inactive = codes.filter((c) => byCode.has(c) && byCode.get(c).status !== 'active');
  if (missing.length) return { data: null, error: null, missing, inactive: [] };
  if (inactive.length) return { data: null, error: null, missing: [], inactive };
  return { data: codes.map((c) => byCode.get(c)), error: null, missing: [], inactive: [] };
}

// SFG-P2D-NO-MACHINE-IN-SFG: SFG Builder does not bind recipe step machines.
// Recipe Builder / Routing / WO planning own machine selection.

// param-based wip_produced: each boundary FG stage (STK for MTS, SET for MTO) is the
// deliverable -> wip_produced=false; all upstream stages are WIP=true. Plus per-process
// capability flags.
function buildRoutingStepsForSpec(spec, idByCode, ptByCode) {
  const missingPt = [];
  const steps = (spec.steps || []).map((s, idx) => {
    const ptId = ptByCode.get(up(s.process_code)) || null;
    if (!ptId) missingPt.push(s.process_code);
    const firstInput = (s.inputs || [])[0];
    return {
      seq_no: idx + 1,
      step_name: String(s.process_code || `STEP_${idx + 1}`),
      process_type_id: ptId,
      input_item_id: firstInput ? (idByCode.get(up(firstInput.input_item_code)) || null) : null,
      output_item_id: idByCode.get(up(s.output_item_code)) || null,
      wip_produced: up(s.stage_code) !== up(spec.fg_stage_code),
      ...processRequirementFlags(s.process_code),
    };
  });
  return { steps, missingPt };
}

// create or reuse ONE draft recipe for a split spec (idempotent on recipe_code).
async function createOrReuseSplitRecipe(spec, idByCode, ptByCode, uomByCode, uomPCS, userId) {
  const { data: existRec } = await supabase
    .from('stage_recipe_headers')
    .select('id, status, recipe_code')
    .eq('recipe_code', spec.recipe_code)
    .maybeSingle();
  if (existRec) {
    return { action: 'USE_EXISTING', id: existRec.id, recipe_code: spec.recipe_code, status: existRec.status, kind: spec.kind, fg_item_code: spec.fg_item_code, steps_count: spec.steps.length };
  }
  const steps = (spec.steps || []).map((s, idx) => ({
    step_no: idx + 1,
    output_item_id: idByCode.get(up(s.output_item_code)),
    output_basis_qty: 1,
    output_basis_uom_id: uomPCS,
    process_type_id: ptByCode.get(up(s.process_code)) || null,
    machine_id: null, // SFG-P2D-NO-MACHINE-IN-SFG: machine binding belongs to Recipe Builder / WO planning.
    calculation_basis: RECIPE_CALC_BASIS.has(s.calculation_basis) ? s.calculation_basis : 'MANUAL',
    inputs: (s.inputs || []).map((i) => ({
      input_item_id: idByCode.get(up(i.input_item_code)),
      qty: i.qty != null ? i.qty : 1,
      uom_id: uomByCode.get(up(i.uom)) || null,
      qty_basis: i.qty_basis || 'PER_OUTPUT',
    })),
  }));
  const recipeBody = {
    recipe_code: spec.recipe_code,
    recipe_name: spec.recipe_name,
    fg_item_id: idByCode.get(up(spec.fg_item_code)),
    planning_unit: spec.planning_unit || 'PCS',
    make_policy: spec.make_policy,
    status: 'draft',
    steps,
  };
  const { data: created, error: cErr } = await createStageRecipe(recipeBody, userId);
  if (cErr) {
    if (cErr.code === 'CONFLICT') {
      const { data: ex2 } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', spec.recipe_code).maybeSingle();
      return { action: 'USE_EXISTING', id: ex2?.id ?? null, recipe_code: spec.recipe_code, status: ex2?.status ?? 'draft', kind: spec.kind, fg_item_code: spec.fg_item_code, steps_count: steps.length };
    }
    throw { code: cErr.code || 'INTERNAL_ERROR', message: cErr.message || String(cErr) };
  }
  return { action: 'CREATED', id: created?.data?.id || created?.id || null, recipe_code: spec.recipe_code, status: 'draft', kind: spec.kind, fg_item_code: spec.fg_item_code, steps_count: steps.length };
}

// ─── read-only context resolution (SELECT only) ──────────────────────────────
async function resolveContext(body) {
  const variantRows = Array.isArray(body.bp_variants) ? body.bp_variants : [];
  const bpCodes = variantRows.map((r) => up(r.bp_item_code)).filter(Boolean);
  const mixCode = up(body.mix_formula_code || body.mix_item_code);

  // candidate stage item codes that the build WOULD touch (for CREATE/USE_EXISTING probe)
  const core = up(body.sku_code).replace(/^[A-Z]+/, '');
  const fam = up(body.product_family);
  const famPrefix = fam ? `${fam}_` : '';
  const candidateCodes = new Set([up(body.sku_code)]); // SET = sku_code (no family prefix)
  for (const e of ABSTRACT_STAGE_EDGES) {
    if (e.stage_code === 'SET') continue;
    const prefixed = `${famPrefix}${e.stage_code}${core}`; // FAMILY_STAGE+core
    candidateCodes.add(up(prefixed));
    candidateCodes.add(up(`${prefixed}I`));
    candidateCodes.add(up(`${prefixed}O`));
  }
  const probeCodes = [...new Set([...candidateCodes, ...bpCodes, mixCode].filter(Boolean))];

  // 1) existing items (any of the probe codes already in item_master)
  const { data: existRows, error: existErr } = probeCodes.length
    ? await supabase.from('item_master').select('id, item_code, is_purchasable, is_active, stage_type').in('item_code', probeCodes)
    : { data: [], error: null };
  if (existErr) throw existErr;

  const existingItemCodes = new Set((existRows || []).filter((r) => r.is_active !== false).map((r) => up(r.item_code)));
  const existingItemStage = new Map((existRows || []).filter((r) => r.is_active !== false).map((r) => [up(r.item_code), r.stage_type ? up(r.stage_type) : null]));
  const rmPurchasableCodes = new Set((existRows || []).filter((r) => r.is_purchasable === true).map((r) => up(r.item_code)));

  // 2) shared MIX item (resolve by code; must be active)
  let mixItem = null;
  if (mixCode) {
    const { data: mixRow, error: mixErr } = await supabase
      .from('item_master')
      .select('id, item_code, item_name, is_active, stage_type')
      .eq('item_code', mixCode)
      .maybeSingle();
    if (mixErr) throw mixErr;
    if (mixRow && mixRow.is_active !== false) mixItem = { id: mixRow.id, item_code: up(mixRow.item_code) };
  }

  // 3) SFG-P2D-NO-MACHINE-IN-SFG: SFG Builder no longer resolves/selects machines.
  return { existingItemCodes, existingItemStage, rmPurchasableCodes, mixItem, machine: null };
}

// ─── machine-time estimate via the shared engine (NO reinvented math) ─────────
// Builds synthetic machine + output_item objects from the wizard body so that
// calculateStepRuntime performs NO database reads (machine.id is null ->
// resolveMouldingCapacity short-circuits to the supplied cavity/cycle fallback).
async function machineTimeEstimate(body, edges, selectedMachine = null) {
  const qty = pos(body.preview_qty) || 1000;
  const out = [];
  // SFG-P2D-NO-MACHINE-IN-SFG: no machine selected/displayed in SFG preview.
  const selMachineCode = null;
  const machineSelected = false;

  // stage-specific tray standards (NOT one generic field)
  const acbpTray = pos(body.acbp_pcs_per_tray);
  const acbpCycleSec = pos(body.acbp_tray_cycle_sec);
  const pwcTray = pos(body.pwc_pcs_per_tray);
  const pwcCycleSec = pos(body.pwc_tray_cycle_sec);
  const curTray = pos(body.cur_pcs_per_tray);
  const curTraysBatch = pos(body.cur_trays_per_batch);
  const curCycleSec = pos(body.cur_cycle_time_min) != null ? pos(body.cur_cycle_time_min) * 60 : null; // FIXED min/batch -> sec

  for (const e of edges) {
    if (e.stage_code === 'PF' || e.stage_code === 'SET' || e.stage_code === 'PRT' || e.stage_code === 'RIV' || e.stage_code === 'SHK') {
      // PF (PCS_CYCLE machine-driven) & MANUAL finishing — shown only when explicit rate provided; skip from time grid
      if (e.stage_code !== 'PF') { /* MANUAL stages: optional, no standard from wizard */ }
      continue;
    }

    // per-stage cycle (sec) and capacities
    const cycleSec =
      e.stage_code === 'MLD' ? pos(body.moulding_cycle_time_sec)
      : e.stage_code === 'SBBP' ? pos(body.shot_blast_cycle_sec)
      : e.stage_code === 'ACBP' ? acbpCycleSec
      : e.stage_code === 'PWC' ? pwcCycleSec
      : e.stage_code === 'CUR' ? curCycleSec
      : null;

    const stagePcsPerTray =
      e.stage_code === 'ACBP' ? acbpTray
      : e.stage_code === 'PWC' ? pwcTray
      : e.stage_code === 'CUR' ? curTray
      : null;
    const stageTraysPerBatch = e.stage_code === 'CUR' ? curTraysBatch : null; // only CUR is TRAY_BATCH

    const machine = {
      id: null,
      cycle_time_sec: cycleSec,
      setup_time_min: e.stage_code === 'MLD' ? (num(body.moulding_setup_time_min) ?? 0) : 0,
      changeover_time_min: 0,
      pcs_per_cycle: pos(body.pcs_per_cycle),
      pcs_per_hour:
        e.stage_code === 'GRD' ? pos(body.grinding_pcs_per_hour)
        : e.stage_code === 'STK' ? pos(body.stacking_pcs_per_hour)
        : null,
      tray_capacity: stageTraysPerBatch, // TRAY_BATCH (CUR): machine.tray_capacity = trays per batch
      batch_capacity_kg: e.stage_code === 'SBBP' ? pos(body.shot_blast_batch_kg) : null,
    };

    const outputItem = {
      id: null,
      cavity_count: e.stage_code === 'MLD' ? pos(body.die_cavities) : null,
      default_pcs_per_tray: stagePcsPerTray, // PCS_TRAY & TRAY_BATCH read pcs/tray from item
      default_pcs_per_crate: pos(body.pcs_per_crate),
      weight_g: null,
      bp_weight_g: null,
    };

    // SBBP shot-blasting needs the BP weight on an input item
    const inputs = [];
    if (e.stage_code === 'SBBP') {
      const v0 = (Array.isArray(body.bp_variants) ? body.bp_variants : [])[0] || {};
      inputs.push({ input_item: { bp_weight_g: pos(v0.bp_weight_g) }, qty: 1, qty_basis: 'PER_OUTPUT' });
    }

    const recipeStep = {
      calculation_basis: e.basis,
      machine,
      output_item: outputItem,
      process_type: { type_code: e.process_code },
      inputs,
    };

    let r;
    try {
      r = await calculateStepRuntime(recipeStep, qty, { machine, outputItem, process: { type_code: e.process_code } });
    } catch (err) {
      r = { expected_minutes: null, basis: e.basis, missing_standard: true, warnings: [String(err?.message || err)] };
    }

    // DISPLAY-only source resolution; never alters expected_minutes.
    // SFG-P2D-NO-MACHINE-IN-SFG: do not display or bind machines in SFG.
    let warnings = r?.warnings || [];
    let cavity_source = null;
    const displayMachineSelected = machineSelected && (e.stage_code === 'MLD' || e.basis === 'DIE_CAVITY');
    if (e.stage_code === 'MLD') {
      cavity_source = pos(body.die_cavities) ? 'user/die cavities' : 'item fallback';
      if (displayMachineSelected) {
        // user picked a moulding machine -> drop engine's DB-fallback noise only for moulding
        warnings = warnings.filter((w) => !/machine not selected|item cavity fallback|using item cavity|no active slot setup/i.test(String(w)));
      }
    }

    out.push({
      stage_code: e.stage_code,
      process_code: e.process_code,
      basis: e.basis,
      qty_used: qty,
      machine_code: displayMachineSelected ? selMachineCode : null,
      machine_selected: displayMachineSelected,
      cavity_source,
      expected_minutes: r?.expected_minutes ?? null,
      missing_standard: Boolean(r?.missing_standard),
      warnings,
    });
  }
  return out;
}

// ─── PUBLIC: preview (read-only) ─────────────────────────────────────────────
export async function previewBuild(body = {}) {
  try {
    const ctx = await resolveContext(body);
    const preview = assemblePreview(body, ctx);

    const activeEdges = activeStageEdges(body);
    preview.machine_time = await machineTimeEstimate(body, activeEdges, ctx.machine);

    preview.resolved = {
      mix_item: ctx.mixItem?.item_code ?? null,
      preferred_machine: ctx.machine?.machine_code ?? null,
      existing_probe_count: ctx.existingItemCodes.size,
    };
    return { data: preview, error: null };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

// ─── PUBLIC: commit (NOT exposed / NOT implemented in 2A-1) ───────────────────
// ─── master lookups for item creation (SELECT only) ─────────────────────────
async function lookupMasterMaps() {
  const [typesRes, catsRes, uomsRes] = await Promise.all([
    supabase.from('item_types').select('id, type_code').eq('is_active', true),
    supabase.from('item_categories').select('id, category_code').eq('is_active', true),
    supabase.from('uom_master').select('id, uom_code').eq('is_active', true),
  ]);
  if (typesRes.error) throw typesRes.error;
  if (catsRes.error) throw catsRes.error;
  if (uomsRes.error) throw uomsRes.error;
  const m = (rows, key) => new Map((rows || []).map((r) => [up(r[key]), r.id]));
  return {
    typeByCode: m(typesRes.data, 'type_code'),
    catByCode: m(catsRes.data, 'category_code'),
    uomByCode: m(uomsRes.data, 'uom_code'),
  };
}

// ─── PUBLIC: commit — 2A-2-alpha ITEMS-ONLY (flag-gated; idempotent) ─────────
// Creates item_master rows for generated SFG/WIP stage items + the final SET (FG).
// Does NOT write recipe / BOM / routing / fg_sfg_links / inventory.
// BP/MIX are pre-existing and never auto-created.
export async function commitBuild(body = {}, userId = null) {
  if (!commitEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_commit_enabled is false — commit is gated.' } };
  }
  try {
    // 1) server re-run preview — never trust frontend; block-gate
    const { data: preview, error: pErr } = await previewBuild(body);
    if (pErr) return { data: null, error: pErr };
    if (!preview.can_generate) {
      return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, summary: preview.summary, not_written: NOT_WRITTEN }, error: null };
    }

    // 2) resolve masters
    const maps = await lookupMasterMaps();
    const typeSFG = maps.typeByCode.get('SFG');
    const typeFG = maps.typeByCode.get('FG');
    const catSFG = maps.catByCode.get('SFG');
    const catPREFORM = maps.catByCode.get('PREFORM');
    const catFG = maps.catByCode.get('FG') || maps.catByCode.get('FINISHED_GOOD') || maps.catByCode.get('FINISHED') || catSFG;
    const uomPCS = maps.uomByCode.get('PCS');
    const missing = [];
    if (!typeSFG) missing.push('item_type SFG');
    if (!typeFG) missing.push('item_type FG');
    if (!catSFG) missing.push('item_category SFG');
    if (!catPREFORM) missing.push('item_category PREFORM');
    if (!uomPCS) missing.push('uom PCS');
    if (missing.length) return { data: { committed: false, reason: 'MASTER_MISSING', missing, not_written: NOT_WRITTEN }, error: null };

    // 3) targets = generated WIP + final SET (FG). RM/MIX sources are pre-existing, never created.
    const targets = preview.items.filter((i) => i.source === 'GENERATED' || i.source === 'FG');
    const codes = targets.map((i) => i.item_code);
    const { data: existRows, error: exErr } = codes.length
      ? await supabase.from('item_master').select('id, item_code, stage_type, item_type_id, is_active').in('item_code', codes)
      : { data: [], error: null };
    if (exErr) return { data: null, error: { code: exErr.code || 'INTERNAL_ERROR', message: exErr.message } };
    const existByCode = new Map((existRows || []).map((r) => [up(r.item_code), r]));

    const results = [];
    const code_to_id = {};
    let created = 0, use_existing = 0, blocked = 0;

    for (const it of targets) {
      const code = up(it.item_code);
      const isSet = it.stage_type === 'SET';
      const expectStage = up(it.stage_type);
      const ex = existByCode.get(code);

      if (ex) {
        const stageOk = up(ex.stage_type) === expectStage;
        const typeOk = ex.item_type_id == null || ex.item_type_id === (isSet ? typeFG : typeSFG);
        if (stageOk && typeOk) {
          results.push({ item_code: it.item_code, action: 'USE_EXISTING', id: ex.id });
          code_to_id[it.item_code] = ex.id;
          use_existing++;
        } else {
          results.push({ item_code: it.item_code, action: 'BLOCK', reason: `exists with wrong ${stageOk ? 'type' : 'stage'} (stage_type=${ex.stage_type})` });
          blocked++;
        }
        continue;
      }

      const payload = {
        item_code: it.item_code,
        item_name: it.item_name,
        item_type_id: isSet ? typeFG : typeSFG,
        category_id: it.stage_code === 'PF' ? catPREFORM : (isSet ? catFG : catSFG),
        uom_id: uomPCS,
        purchase_uom_id: null,
        sales_uom_id: null,
        is_active: true,
        is_purchasable: false,
        is_sellable: isSet,
        is_manufactured: true,
        is_stocked: true,
        make_policy: it.make_policy || (isSet ? 'MAKE_TO_ORDER' : 'MAKE_TO_STOCK'),
        planning_unit: 'PCS',
        stage_type: it.stage_type,
        formulation_code: preview.parent_sku,
        notes: `Auto-created by SFG Builder commit (2A-2-alpha, ITEMS-only) for ${preview.parent_sku}`,
        created_by: userId,
      };

      const { data: ins, error: insErr } = await supabase.from('item_master').insert(payload).select('id, item_code').single();
      if (insErr) {
        if (insErr.code === '23505') {
          // race: code created concurrently — resolve + verify, never duplicate
          const { data: fb } = await supabase.from('item_master').select('id, stage_type').eq('item_code', it.item_code).maybeSingle();
          if (fb && up(fb.stage_type) === expectStage) {
            results.push({ item_code: it.item_code, action: 'USE_EXISTING', id: fb.id });
            code_to_id[it.item_code] = fb.id;
            use_existing++;
          } else {
            results.push({ item_code: it.item_code, action: 'BLOCK', reason: 'concurrent insert with wrong stage' });
            blocked++;
          }
        } else {
          results.push({ item_code: it.item_code, action: 'ERROR', reason: insErr.message });
          blocked++;
        }
        continue;
      }
      results.push({ item_code: it.item_code, action: 'CREATED', id: ins.id });
      code_to_id[it.item_code] = ins.id;
      created++;
    }

    const bp_weight_seed = await seedBpWeightsFromSfg(body);
    const item_standard_seed = await seedItemStandardsFromSfg(preview, body);

    return {
      data: {
        committed: blocked === 0,
        phase: '2A-2-alpha ITEMS-only',
        parent_sku: preview.parent_sku,
        product_family: preview.product_family,
        summary: { created, use_existing, blocked },
        items: results,
        code_to_id,
        sources_pre_existing: preview.items.filter((i) => i.source === 'RM' || i.source === 'SHARED_FAMILY').map((i) => i.item_code),
        bp_weight_seed,
        item_standard_seed,
        not_written: NOT_WRITTEN,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

const NOT_WRITTEN = Object.freeze(['stage_recipe', 'bom', 'routing', 'fg_sfg_links', 'inventory', 'production_plan']);


async function seedBpWeightsFromSfg(body = {}) {
  // SFG-SEQ-BP-SEED-1: BP weight is an item standard. SFG seeds it once into
  // item_master.bp_weight_g; runtime/Recipe Builder then read item_master, not SFG.
  const rows = Array.isArray(body.bp_variants) ? body.bp_variants : [];
  const wanted = new Map();
  for (const row of rows) {
    const code = up(row?.bp_item_code);
    const wt = pos(row?.bp_weight_g);
    if (code && wt != null) wanted.set(code, wt);
  }
  if (!wanted.size) return [];

  const { data: existing, error } = await supabase
    .from('item_master')
    .select('id, item_code, bp_weight_g')
    .in('item_code', [...wanted.keys()]);
  if (error) throw error;

  const results = [];
  for (const row of existing || []) {
    const code = up(row.item_code);
    const wt = wanted.get(code);
    if (wt == null) continue;
    if (row.bp_weight_g != null && Number(row.bp_weight_g) > 0) {
      results.push({ item_code: row.item_code, action: 'KEEP_EXISTING', bp_weight_g: row.bp_weight_g });
      continue;
    }
    const { error: upErr } = await supabase
      .from('item_master')
      .update({ bp_weight_g: wt })
      .eq('id', row.id);
    if (upErr) throw upErr;
    results.push({ item_code: row.item_code, action: 'SEEDED', bp_weight_g: wt });
  }
  return results;
}

function buildItemStandardSeedMap(preview = {}, body = {}) {
  // SFG-STANDARDS-SEED-1: SKU fit standards seed once into item_master.
  // SFG remains a scaffold; runtime/Recipe Builder read item_master, not SFG.
  const wanted = new Map();
  const set = (itemCode, field, value) => {
    const code = up(itemCode);
    const v = pos(value);
    if (!code || v == null) return;
    const row = wanted.get(code) || {};
    row[field] = v;
    wanted.set(code, row);
  };

  for (const item of preview.items || []) {
    const stage = up(item?.stage_code);
    const code = up(item?.item_code);
    if (stage === 'ACBP') set(code, 'default_pcs_per_tray', body.acbp_pcs_per_tray);
    if (stage === 'PWC') set(code, 'default_pcs_per_tray', body.pwc_pcs_per_tray);
    if (stage === 'CUR') set(code, 'default_pcs_per_tray', body.cur_pcs_per_tray);
    if (stage === 'STK') set(code, 'default_pcs_per_crate', body.pcs_per_crate);
    if (stage === 'SET') set(code, 'pcs_per_set', body.pcs_per_set);
  }

  return wanted;
}

async function seedItemStandardsFromSfg(preview = {}, body = {}) {
  const wanted = buildItemStandardSeedMap(preview, body);
  if (!wanted.size) return [];

  const { data: existing, error } = await supabase
    .from('item_master')
    .select('id, item_code, default_pcs_per_tray, default_pcs_per_crate, pcs_per_set')
    .in('item_code', [...wanted.keys()]);
  if (error) throw error;

  const results = [];
  for (const row of existing || []) {
    const code = up(row.item_code);
    const seed = wanted.get(code) || {};
    const patch = {};

    for (const field of ['default_pcs_per_tray', 'default_pcs_per_crate', 'pcs_per_set']) {
      const v = seed[field];
      if (v != null && !(row[field] != null && Number(row[field]) > 0)) patch[field] = v;
    }

    if (!Object.keys(patch).length) {
      results.push({ item_code: row.item_code, action: 'KEEP_EXISTING' });
      continue;
    }

    const { error: upErr } = await supabase
      .from('item_master')
      .update(patch)
      .eq('id', row.id);
    if (upErr) throw upErr;
    results.push({ item_code: row.item_code, action: 'SEEDED', ...patch });
  }
  return results;
}

// ─── PUBLIC: commit DRAFT RECIPE — 2A-2-gamma (flag-gated; idempotent) ───────
// Creates stage_recipe_headers + steps + inputs as DRAFT only.
// Does NOT activate, NOT sync BOM, NOT write routing/links/inventory/items.
// Requires the SET + all generated WIP items to ALREADY exist (2A-2-alpha first).
export async function commitRecipeDraft(body = {}, userId = null) {
  if (!recipeCommitEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_recipe_commit_enabled is false — recipe commit is gated.' } };
  }
  try {
    // 1) server re-run preview — block-gate
    const { data: preview, error: pErr } = await previewBuild(body);
    if (pErr) return { data: null, error: pErr };
    if (!preview.can_generate) {
      return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, not_written: RECIPE_NOT_WRITTEN }, error: null };
    }
    const rc = preview.recipe;
    if (!rc || !rc.recipe_code || !(rc.steps || []).length) {
      return { data: { committed: false, reason: 'NO_RECIPE', not_written: RECIPE_NOT_WRITTEN }, error: null };
    }

    // 2) all recipe item codes (outputs + inputs) must already exist
    const codeSet = new Set();
    for (const s of rc.steps) { codeSet.add(up(s.output_item_code)); for (const i of (s.inputs || [])) codeSet.add(up(i.input_item_code)); }
    const codes = [...codeSet];
    const { data: imRows, error: imErr } = await supabase.from('item_master').select('id, item_code').in('item_code', codes);
    if (imErr) return { data: null, error: { code: imErr.code || 'INTERNAL_ERROR', message: imErr.message } };
    const idByCode = new Map((imRows || []).map((r) => [up(r.item_code), r.id]));
    const missing = codes.filter((c) => !idByCode.has(c));
    if (missing.length) {
      return { data: { committed: false, reason: 'ITEMS_MISSING', missing, hint: 'run 2A-2-alpha ITEMS commit first', not_written: RECIPE_NOT_WRITTEN }, error: null };
    }

    // 3) masters: process_types + uom (SELECT only)
    const [ptRes, uomRes] = await Promise.all([
      supabase.from('process_types').select('id, type_code').eq('is_active', true),
      supabase.from('uom_master').select('id, uom_code').eq('is_active', true),
    ]);
    if (ptRes.error) return { data: null, error: { code: ptRes.error.code || 'INTERNAL_ERROR', message: ptRes.error.message } };
    if (uomRes.error) return { data: null, error: { code: uomRes.error.code || 'INTERNAL_ERROR', message: uomRes.error.message } };
    const ptByCode = new Map((ptRes.data || []).map((r) => [up(r.type_code), r.id]));
    const uomByCode = new Map((uomRes.data || []).map((r) => [up(r.uom_code), r.id]));
    const uomPCS = uomByCode.get('PCS') || null;

    // SFG-P2D-NO-MACHINE-IN-SFG: SFG generate does not validate or bind machines.

    // 4) PATCH SFG-MTS-MTO-SPLIT-1 (merged) — split at STK boundary into MTS(STK,
    //    MAKE_TO_STOCK) + MTO(SET, MAKE_TO_ORDER) draft recipes (distinct codes
    //    SR-<STK>-MTS / SR-<SET>-MTO). Legacy single recipe when no STK boundary.
    const split = buildSplitRecipeSpecs(preview, rc);

    if (!split.error && split.specs.length) {
      const recipes = [];
      for (const spec of split.specs) {
        recipes.push(await createOrReuseSplitRecipe(spec, idByCode, ptByCode, uomByCode, uomPCS, userId));
      }
      const mto = recipes.find((r) => r.kind === 'MTO_SET') || recipes[recipes.length - 1];
      return {
        data: {
          committed: true,
          split: true,
          phase: '2A-2-gamma SPLIT DRAFT RECIPES',
          boundary: split.boundary,
          recipes,
          recipe: mto, // backward-compatible descriptor (.action) for full-generate summary
          steps_count: recipes.reduce((n, r) => n + (r.steps_count || 0), 0),
          not_written: RECIPE_NOT_WRITTEN,
        },
        error: null,
      };
    }

    // legacy single recipe (no STK boundary) — original behaviour preserved
    const recipeCode = rc.recipe_code;
    const { data: existRec } = await supabase.from('stage_recipe_headers').select('id, status, recipe_code').eq('recipe_code', recipeCode).maybeSingle();
    if (existRec) {
      return { data: { committed: true, split: false, recipe: { action: 'USE_EXISTING', id: existRec.id, recipe_code: recipeCode, status: existRec.status }, steps_count: rc.steps.length, not_written: RECIPE_NOT_WRITTEN }, error: null };
    }
    const steps = rc.steps.map((s, idx) => ({
      step_no: s.step_no || idx + 1,
      output_item_id: idByCode.get(up(s.output_item_code)),
      output_basis_qty: 1,
      output_basis_uom_id: uomPCS,
      process_type_id: ptByCode.get(up(s.process_code)) || null,
      machine_id: null, // SFG-P2D-NO-MACHINE-IN-SFG: machine binding belongs to Recipe Builder / WO planning.
      calculation_basis: RECIPE_CALC_BASIS.has(s.calculation_basis) ? s.calculation_basis : 'MANUAL',
      inputs: (s.inputs || []).map((i) => ({
        input_item_id: idByCode.get(up(i.input_item_code)),
        qty: i.qty != null ? i.qty : 1,
        uom_id: uomByCode.get(up(i.uom)) || null,
        qty_basis: i.qty_basis || 'PER_OUTPUT',
      })),
    }));
    const recipeBody = {
      recipe_code: recipeCode,
      recipe_name: `${preview.parent_sku} ${preview.product_family || ''} recipe`.trim(),
      fg_item_id: idByCode.get(up(preview.parent_sku)),
      planning_unit: 'PCS',
      make_policy: 'MAKE_TO_ORDER',
      status: 'draft',
      steps,
    };
    const { data: created, error: cErr } = await createStageRecipe(recipeBody, userId);
    if (cErr) {
      if (cErr.code === 'CONFLICT') {
        const { data: ex2 } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', recipeCode).maybeSingle();
        return { data: { committed: true, split: false, recipe: { action: 'USE_EXISTING', id: ex2?.id ?? null, recipe_code: recipeCode, status: ex2?.status ?? 'draft' }, steps_count: steps.length, not_written: RECIPE_NOT_WRITTEN }, error: null };
      }
      return { data: null, error: { code: cErr.code || 'INTERNAL_ERROR', message: cErr.message || String(cErr) } };
    }
    const newId = created?.data?.id || created?.id || null;
    return { data: { committed: true, split: false, recipe: { action: 'CREATED', id: newId, recipe_code: recipeCode, status: 'draft' }, steps_count: steps.length, not_written: RECIPE_NOT_WRITTEN }, error: null };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

const ACTIVATE_NOT_WRITTEN = Object.freeze(['items', 'draft_recipe', 'bom', 'routing', 'fg_sfg_links', 'inventory']);

// ─── PUBLIC: ACTIVATE recipe — 2A-2-delta (flag-gated; idempotent; NO BOM) ──
// Flips the matching DRAFT recipe (SR-<SKU>) to active + supersedes prior active versions.
// Header-only update. Deliberately does NOT sync/generate BOM (that is a later slice),
// and writes NO items/routing/links/inventory.
export async function commitRecipeActivate(body = {}, userId = null) {
  if (!recipeActivateEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_recipe_activate_enabled is false — activation is gated.' } };
  }
  try {
    // 1) server re-run preview — block-gate
    const { data: preview, error: pErr } = await previewBuild(body);
    if (pErr) return { data: null, error: pErr };
    if (!preview.can_generate) {
      return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, not_written: ACTIVATE_NOT_WRITTEN }, error: null };
    }

    // SFG-FLOW-ANCHOR-1: split-aware activation. The preview recipe is a display
    // skeleton, but generation creates SR-<STK>-MTS + SR-<SET>-MTO after the STK
    // boundary. Activate those real draft recipes; do not look for old SR-<SET>.
    const { specs, split, recipe_code: previewRecipeCode } = recipeSpecsForPreview(preview);
    if (!specs.length) return { data: { committed: false, reason: 'NO_RECIPE', not_written: ACTIVATE_NOT_WRITTEN }, error: null };

    const recipes = [];
    for (const spec of specs) {
      const res = await activateOneRecipeByCode(spec.recipe_code, userId, ACTIVATE_NOT_WRITTEN);
      if (res.error) return res;
      if (!res.data?.committed) {
        return { data: { ...res.data, missing_recipe_code: spec.recipe_code, expected_recipe_codes: specs.map((x) => x.recipe_code), not_written: ACTIVATE_NOT_WRITTEN }, error: null };
      }
      recipes.push({ ...res.data.recipe, kind: spec.kind, fg_item_code: spec.fg_item_code, steps_count: spec.steps.length, superseded: res.data.superseded || [] });
    }

    const mto = recipes.find((r) => r.kind === 'MTO_SET') || recipes[recipes.length - 1];
    return {
      data: {
        committed: true,
        split: !!split,
        phase: split ? '2A-2-delta SPLIT ACTIVATE RECIPES' : '2A-2-delta ACTIVATE RECIPE',
        preview_recipe_code: previewRecipeCode,
        boundary: split?.boundary || null,
        recipes,
        recipe: mto,
        not_written: ACTIVATE_NOT_WRITTEN,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

const BOM_NOT_WRITTEN = Object.freeze(['items', 'recipe_create', 'recipe_activate', 'routing', 'fg_sfg_links', 'inventory']);

// ─── PUBLIC: BOM auto-generation — 2A-2-epsilon (flag-gated; idempotent) ─────
// Generates bom_headers/bom_lines from the ACTIVE recipe via the reused, ownership-safe
// syncGeneratedBomsForRecipe (delete-own + rebuild; never touches manual BOMs).
// Writes NO items/recipe/routing/links/inventory.
export async function commitRecipeBom(body = {}, userId = null) {
  if (!bomCommitEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_bom_commit_enabled is false — BOM generation is gated.' } };
  }
  try {
    // 1) server re-run preview — block-gate
    const { data: preview, error: pErr } = await previewBuild(body);
    if (pErr) return { data: null, error: pErr };
    if (!preview.can_generate) {
      return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, not_written: BOM_NOT_WRITTEN }, error: null };
    }

    // SFG-FLOW-ANCHOR-1: BOMs follow the real generated recipes. In split mode,
    // generate/sync BOM for BOTH SR-<STK>-MTS and SR-<SET>-MTO.
    const { specs, split, recipe_code: previewRecipeCode } = recipeSpecsForPreview(preview);
    if (!specs.length) return { data: { committed: false, reason: 'NO_RECIPE', not_written: BOM_NOT_WRITTEN }, error: null };

    const active = await activeRecipesForSpecs(specs, BOM_NOT_WRITTEN);
    if (active.error) return { data: null, error: active.error };
    if (active.missing?.length) return { data: { committed: false, reason: 'RECIPE_MISSING', missing: active.missing, expected_recipe_codes: specs.map((s) => s.recipe_code), hint: 'run recipe draft first', not_written: BOM_NOT_WRITTEN }, error: null };
    if (active.inactive?.length) return { data: { committed: false, reason: 'RECIPE_NOT_ACTIVE', inactive: active.inactive, hint: 'run recipe activate first', not_written: BOM_NOT_WRITTEN }, error: null };

    const boms = [];
    for (const rec of active.data || []) {
      const { data: preBoms, error: preErr } = await supabase
        .from('bom_headers')
        .select('id')
        .eq('generated_from_recipe_id', rec.id);
      if (preErr) return { data: null, error: { code: preErr.code || 'INTERNAL_ERROR', message: preErr.message } };
      const hadBefore = (preBoms || []).length;

      await syncGeneratedBomsForRecipe(rec.id, userId);

      const { data: postBoms } = await supabase.from('bom_headers').select('id').eq('generated_from_recipe_id', rec.id);
      const headerIds = (postBoms || []).map((b) => b.id);
      let lines = 0;
      if (headerIds.length) {
        const { data: lineRows } = await supabase.from('bom_lines').select('id').in('bom_id', headerIds);
        lines = (lineRows || []).length;
      }
      boms.push({ action: hadBefore ? 'USE_EXISTING' : 'GENERATED', recipe_code: rec.recipe_code, recipe_id: rec.id, headers: headerIds.length, lines });
    }

    const mto = boms.find((b) => /-MTO$/i.test(b.recipe_code)) || boms[boms.length - 1];
    return {
      data: {
        committed: true,
        split: !!split,
        phase: split ? '2A-2-epsilon SPLIT BOMS' : '2A-2-epsilon BOM',
        preview_recipe_code: previewRecipeCode,
        boundary: split?.boundary || null,
        boms,
        bom: mto,
        not_written: BOM_NOT_WRITTEN,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

const ROUTING_NOT_WRITTEN = Object.freeze(['items', 'recipe', 'bom', 'fg_sfg_links', 'inventory']);

// ─── PUBLIC: ROUTING creation — 2A-2-zeta (flag-gated; idempotent) ──────────
// PATCH SFG-MTS-MTO-SPLIT-1 (merged): emits TWO draft routings — MTS keyed on the STK
// item, MTO keyed on the final SET item. SPLIT path is DECOUPLED (no recipe-active/BOM
// gate) so ONE commit yields both routing drafts. LEGACY path (no STK boundary) keeps
// the original active-recipe + BOM gate. Reuses routingService.createRouting.
export async function commitRouting(body = {}, userId = null) {
  if (!routingCommitEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_routing_commit_enabled is false — routing is gated.' } };
  }
  try {
    // 1) server re-run preview — block-gate
    const { data: preview, error: pErr } = await previewBuild(body);
    if (pErr) return { data: null, error: pErr };
    if (!preview.can_generate) return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, not_written: ROUTING_NOT_WRITTEN }, error: null };
    const rc = preview.recipe;
    if (!rc || !rc.recipe_code || !(rc.steps || []).length) return { data: { committed: false, reason: 'NO_RECIPE', not_written: ROUTING_NOT_WRITTEN }, error: null };
    const recipeCode = rc.recipe_code;

    // 2) PATCH SFG-MTS-MTO-SPLIT-1 (merged) — resolve items + masters once, then branch.
    const split = buildSplitRecipeSpecs(preview, rc);

    // resolve item ids (outputs + inputs) — must already exist
    const codeSet = new Set([up(preview.parent_sku)]);
    for (const s of rc.steps) { codeSet.add(up(s.output_item_code)); for (const i of (s.inputs || [])) codeSet.add(up(i.input_item_code)); }
    const codes = [...codeSet];
    const { data: imRows, error: imErr } = await supabase.from('item_master').select('id, item_code').in('item_code', codes);
    if (imErr) return { data: null, error: { code: imErr.code || 'INTERNAL_ERROR', message: imErr.message } };
    const idByCode = new Map((imRows || []).map((r) => [up(r.item_code), r.id]));
    const missing = codes.filter((c) => !idByCode.has(c));
    if (missing.length) return { data: { committed: false, reason: 'ITEMS_MISSING', missing, not_written: ROUTING_NOT_WRITTEN }, error: null };

    // masters: process_types + routing_type (prefer STANDARD)
    const [ptRes, rtRes] = await Promise.all([
      supabase.from('process_types').select('id, type_code').eq('is_active', true),
      supabase.from('routing_types').select('id, type_code, type_name').eq('is_active', true),
    ]);
    if (ptRes.error) return { data: null, error: { code: ptRes.error.code || 'INTERNAL_ERROR', message: ptRes.error.message } };
    if (rtRes.error) return { data: null, error: { code: rtRes.error.code || 'INTERNAL_ERROR', message: rtRes.error.message } };
    const ptByCode = new Map((ptRes.data || []).map((r) => [up(r.type_code), r.id]));
    const rts = rtRes.data || [];
    const routingType = rts.find((r) => up(r.type_code) === 'STANDARD') || rts.find((r) => /FINAL|PAD|SFG|FG|MANUF|PROD/i.test(`${r.type_code} ${r.type_name}`)) || rts[0] || null;
    if (!routingType) return { data: { committed: false, reason: 'ROUTING_TYPE_MISSING', not_written: ROUTING_NOT_WRITTEN }, error: null };

    if (!split.error && split.specs.length) {
      // SPLIT PATH (decoupled — no recipe-active/BOM gate). Atomic process-type
      // pre-check across BOTH routings before any write.
      const routingSpecs = split.specs.map((spec) => ({ spec, ...buildRoutingStepsForSpec(spec, idByCode, ptByCode) }));
      const missingPt = [...new Set(routingSpecs.flatMap((r) => r.missingPt).filter(Boolean))];
      if (missingPt.length) return { data: { committed: false, reason: 'PROCESS_TYPE_MISSING', missing: missingPt, not_written: ROUTING_NOT_WRITTEN }, error: null };

      const routings = [];
      for (const rs of routingSpecs) {
        const itemId = idByCode.get(up(rs.spec.fg_item_code)) || null;
        if (!itemId) return { data: { committed: false, reason: 'ITEMS_MISSING', missing: [rs.spec.fg_item_code], not_written: ROUTING_NOT_WRITTEN }, error: null };
        const { data: existRt } = await supabase.from('routing_headers').select('id, status').eq('item_id', itemId).eq('routing_type_id', routingType.id);
        if ((existRt || []).length) {
          routings.push({ action: 'USE_EXISTING', id: existRt[0].id, item_id: itemId, item_code: rs.spec.fg_item_code, kind: rs.spec.kind, routing_type: routingType.type_code, status: existRt[0].status, steps: rs.steps.length });
          continue;
        }
        const { data: created, error: cErr } = await createRouting({ item_id: itemId, routing_type_id: routingType.id, steps: rs.steps }, userId);
        if (cErr) {
          if (cErr.code === '23505') {
            const { data: ex2 } = await supabase.from('routing_headers').select('id, status').eq('item_id', itemId).eq('routing_type_id', routingType.id);
            routings.push({ action: 'USE_EXISTING', id: ex2?.[0]?.id ?? null, item_id: itemId, item_code: rs.spec.fg_item_code, kind: rs.spec.kind, routing_type: routingType.type_code, status: ex2?.[0]?.status ?? 'draft', steps: rs.steps.length });
            continue;
          }
          return { data: null, error: { code: cErr.code || 'INTERNAL_ERROR', message: cErr.message || String(cErr) } };
        }
        routings.push({ action: 'CREATED', id: created?.data?.id || created?.id || null, item_id: itemId, item_code: rs.spec.fg_item_code, kind: rs.spec.kind, routing_type: routingType.type_code, status: 'draft', steps: rs.steps.length });
      }
      const mto = routings.find((r) => r.kind === 'MTO_SET') || routings[routings.length - 1];
      return { data: { committed: true, split: true, phase: '2A-2-zeta SPLIT DRAFT ROUTINGS', boundary: split.boundary, routings, routing: mto, not_written: ROUTING_NOT_WRITTEN }, error: null };
    }

    // ── LEGACY PATH (no STK boundary) — original single SET routing + active/BOM gate ──
    const { data: rec, error: rErr } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', recipeCode).maybeSingle();
    if (rErr) return { data: null, error: { code: rErr.code || 'INTERNAL_ERROR', message: rErr.message } };
    if (!rec) return { data: { committed: false, reason: 'RECIPE_MISSING', hint: 'run gamma draft first', not_written: ROUTING_NOT_WRITTEN }, error: null };
    if (rec.status !== 'active') return { data: { committed: false, reason: 'RECIPE_NOT_ACTIVE', status: rec.status, hint: 'run delta activate first', not_written: ROUTING_NOT_WRITTEN }, error: null };
    const { data: bomRows, error: bErr } = await supabase.from('bom_headers').select('id').eq('generated_from_recipe_id', rec.id);
    if (bErr) return { data: null, error: { code: bErr.code || 'INTERNAL_ERROR', message: bErr.message } };
    if (!(bomRows || []).length) return { data: { committed: false, reason: 'BOM_MISSING', hint: 'run epsilon BOM first', not_written: ROUTING_NOT_WRITTEN }, error: null };
    const setId = idByCode.get(up(preview.parent_sku));
    const { data: existRt } = await supabase.from('routing_headers').select('id, status').eq('item_id', setId).eq('routing_type_id', routingType.id);
    if ((existRt || []).length) {
      return { data: { committed: true, split: false, routing: { action: 'USE_EXISTING', id: existRt[0].id, item_id: setId, routing_type: routingType.type_code, status: existRt[0].status }, not_written: ROUTING_NOT_WRITTEN }, error: null };
    }
    const legacyMissingPt = [];
    const steps = rc.steps.map((s, idx) => {
      const ptId = ptByCode.get(up(s.process_code)) || null;
      if (!ptId) legacyMissingPt.push(s.process_code);
      const firstInput = (s.inputs || [])[0];
      return {
        seq_no: s.step_no || idx + 1,
        step_name: String(s.process_code || `STEP_${idx + 1}`),
        process_type_id: ptId,
        input_item_id: firstInput ? (idByCode.get(up(firstInput.input_item_code)) || null) : null,
        output_item_id: idByCode.get(up(s.output_item_code)) || null,
        wip_produced: up(s.stage_code) !== 'SET',
      };
    });
    if (legacyMissingPt.length) return { data: { committed: false, reason: 'PROCESS_TYPE_MISSING', missing: [...new Set(legacyMissingPt)], not_written: ROUTING_NOT_WRITTEN }, error: null };
    const { data: created, error: cErr } = await createRouting({ item_id: setId, routing_type_id: routingType.id, steps }, userId);
    if (cErr) {
      if (cErr.code === '23505') {
        const { data: ex2 } = await supabase.from('routing_headers').select('id, status').eq('item_id', setId).eq('routing_type_id', routingType.id);
        return { data: { committed: true, split: false, routing: { action: 'USE_EXISTING', id: ex2?.[0]?.id ?? null, item_id: setId, routing_type: routingType.type_code, status: ex2?.[0]?.status ?? 'draft' }, not_written: ROUTING_NOT_WRITTEN }, error: null };
      }
      return { data: null, error: { code: cErr.code || 'INTERNAL_ERROR', message: cErr.message || String(cErr) } };
    }
    const newId = created?.data?.id || created?.id || null;
    return { data: { committed: true, split: false, routing: { action: 'CREATED', id: newId, item_id: setId, routing_type: routingType.type_code, status: 'draft', steps: steps.length }, not_written: ROUTING_NOT_WRITTEN }, error: null };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

const LINKS_NOT_WRITTEN = Object.freeze(['items', 'recipe', 'bom', 'routing', 'inventory']);

// ─── PUBLIC: FG-SFG LINKS — 2A-2-eta (flag-gated; idempotent) ───────────────
// Upserts fg_sfg_item_links (UNIQUE fg_item_id,sfg_item_id) linking the SET FG to its
// generated SFG/WIP stage items. Requires items + active recipe + BOM + routing.
// Writes NO items/recipe/bom/routing changes, no inventory.
export async function commitFgLinks(body = {}, userId = null) {
  if (!linksCommitEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_links_commit_enabled is false — links are gated.' } };
  }
  try {
    // 1) server re-run preview — block-gate
    const { data: preview, error: pErr } = await previewBuild(body);
    if (pErr) return { data: null, error: pErr };
    if (!preview.can_generate) return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, not_written: LINKS_NOT_WRITTEN }, error: null };
    const { specs, split } = recipeSpecsForPreview(preview);
    if (!specs.length) return { data: { committed: false, reason: 'NO_RECIPE', not_written: LINKS_NOT_WRITTEN }, error: null };
    const linkSpecs = preview.links || [];
    if (!linkSpecs.length) return { data: { committed: false, reason: 'NO_LINKS', not_written: LINKS_NOT_WRITTEN }, error: null };

    // 2) SFG-FLOW-ANCHOR-1: require the real generated recipe anchors to be active
    // and have BOMs. In split mode this means BOTH MTS(STK) and MTO(SET), not old SR-<SET>.
    const active = await activeRecipesForSpecs(specs, LINKS_NOT_WRITTEN);
    if (active.error) return { data: null, error: active.error };
    if (active.missing?.length) return { data: { committed: false, reason: 'RECIPE_MISSING', missing: active.missing, expected_recipe_codes: specs.map((s) => s.recipe_code), not_written: LINKS_NOT_WRITTEN }, error: null };
    if (active.inactive?.length) return { data: { committed: false, reason: 'RECIPE_NOT_ACTIVE', inactive: active.inactive, not_written: LINKS_NOT_WRITTEN }, error: null };

    const recipeIds = (active.data || []).map((r) => r.id);
    const { data: bomRows, error: bErr } = recipeIds.length
      ? await supabase.from('bom_headers').select('id, generated_from_recipe_id').in('generated_from_recipe_id', recipeIds)
      : { data: [], error: null };
    if (bErr) return { data: null, error: { code: bErr.code || 'INTERNAL_ERROR', message: bErr.message } };
    const bomByRecipe = new Set((bomRows || []).map((b) => b.generated_from_recipe_id));
    const missingBom = (active.data || []).filter((r) => !bomByRecipe.has(r.id)).map((r) => r.recipe_code);
    if (missingBom.length) return { data: { committed: false, reason: 'BOM_MISSING', missing: missingBom, not_written: LINKS_NOT_WRITTEN }, error: null };

    // 4) resolve item ids (SET + all sfg item codes)
    const codeSet = new Set([up(preview.parent_sku)]);
    for (const l of linkSpecs) codeSet.add(up(l.sfg_item_code));
    const codes = [...codeSet];
    const { data: imRows, error: imErr } = await supabase.from('item_master').select('id, item_code').in('item_code', codes);
    if (imErr) return { data: null, error: { code: imErr.code || 'INTERNAL_ERROR', message: imErr.message } };
    const idByCode = new Map((imRows || []).map((r) => [up(r.item_code), r.id]));
    const missing = codes.filter((c) => !idByCode.has(c));
    if (missing.length) return { data: { committed: false, reason: 'ITEMS_MISSING', missing, not_written: LINKS_NOT_WRITTEN }, error: null };
    const fgId = idByCode.get(up(preview.parent_sku));

    // 5) require routing exists for the SET
    const { data: rtRows, error: rtErr } = await supabase.from('routing_headers').select('id').eq('item_id', fgId);
    if (rtErr) return { data: null, error: { code: rtErr.code || 'INTERNAL_ERROR', message: rtErr.message } };
    if (!(rtRows || []).length) return { data: { committed: false, reason: 'ROUTING_MISSING', hint: 'run zeta routing first', not_written: LINKS_NOT_WRITTEN }, error: null };

    // 6) idempotency probe
    const { data: preLinks, error: plErr } = await supabase.from('fg_sfg_item_links').select('id').eq('fg_item_id', fgId);
    if (plErr) return { data: null, error: { code: plErr.code || 'INTERNAL_ERROR', message: plErr.message } };
    const hadBefore = (preLinks || []).length;

    // 7) build rows (dedupe by sfg id) + upsert (UNIQUE fg_item_id,sfg_item_id)
    const seen = new Set();
    const rows = [];
    for (const l of linkSpecs) {
      const sfgId = idByCode.get(up(l.sfg_item_code));
      if (!sfgId || seen.has(sfgId)) continue;
      seen.add(sfgId);
      rows.push({
        fg_item_id: fgId,
        sfg_item_id: sfgId,
        stage_template_id: null,
        stage_code: l.stage_code || null,
        variant_code: l.variant_code || null,
        qty_per_set: l.qty_per_set != null ? l.qty_per_set : null,
        created_by: userId,
      });
    }
    if (!rows.length) return { data: { committed: false, reason: 'NO_LINKS', not_written: LINKS_NOT_WRITTEN }, error: null };

    const { error: upErr } = await supabase.from('fg_sfg_item_links').upsert(rows, { onConflict: 'fg_item_id,sfg_item_id' });
    if (upErr) return { data: null, error: { code: upErr.code || 'INTERNAL_ERROR', message: upErr.message } };

    const { data: postLinks } = await supabase.from('fg_sfg_item_links').select('id').eq('fg_item_id', fgId);
    const total = (postLinks || []).length;

    return {
      data: {
        committed: true,
        split: !!split,
        links: { action: hadBefore ? 'USE_EXISTING' : 'CREATED', fg_item_id: fgId, fg_item_code: preview.parent_sku, count: rows.length, total },
        not_written: LINKS_NOT_WRITTEN,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } };
  }
}

// ─── PUBLIC: FULL GENERATE — 2A-2-theta (master flag-gated; idempotent) ─────
// Runs the six proven slices in order, stopping before any further write if a slice
// blocks. NO inventory. Each slice is itself block-gated + idempotent.
export async function commitFullGenerate(body = {}, userId = null) {
  if (!fullGenerateEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sfg_full_generate_enabled is false — full generate is gated.' } };
  }
  const SLICES = [
    ['items', commitBuild],
    ['recipe_draft', commitRecipeDraft],
    ['recipe_activate', commitRecipeActivate],
    ['bom', commitRecipeBom],
    ['routing', commitRouting],
    ['fg_sfg_links', commitFgLinks],
  ];
  const stages = {};
  const summary = {};
  for (const [name, fn] of SLICES) {
    const { data, error } = await fn(body, userId);
    if (error) {
      // hard error from a slice -> stop before any further write
      return { data: { committed: false, stopped_at: name, error, stages, summary, not_written: ['inventory'] }, error: null };
    }
    stages[name] = data;
    if (data && data.committed === false) {
      // a block reason (e.g. BLOCKED / *_MISSING / NOT_ACTIVE) -> stop, no further writes
      return { data: { committed: false, stopped_at: name, reason: data.reason, detail: data, stages, summary, not_written: ['inventory'] }, error: null };
    }
    // record a compact per-stage action for the summary
    summary[name] =
      data?.summary ? data.summary
      : data?.recipe ? data.recipe.action
      : data?.bom ? data.bom.action
      : data?.routing ? data.routing.action
      : data?.links ? data.links.action
      : 'OK';
  }
  return { data: { committed: true, phase: '2A-2-theta FULL GENERATE', parent_sku: stages.items?.parent_sku ?? null, summary, stages, not_written: ['inventory'] }, error: null };
}
