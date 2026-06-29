/**
 * CERADRIVE ERP — SKU Planning Service (S1)
 *
 * Header + steps CRUD on EXISTING tables (sku_planning_header, sku_planning_steps).
 * Mirrors bomService/routingService header/lines transactional pattern:
 *   returns { data, error }; throws plain { code, message } for business-rule violations.
 *
 * Certified live schema (from constraint/column dumps):
 *   sku_planning_header: id, item_id->item_master RESTRICT (NOT NULL),
 *     routing_id->routing_headers RESTRICT (nullable), routing_type_id->routing_types RESTRICT (nullable),
 *     status(draft|active|superseded, def draft, NOT NULL),
 *     weight_g, pcs_per_set, length/width/thickness_mm, pcs_per_tray, trays_per_batch, pcs_in_crate,
 *     box_{length,width,height}_mm, carton_{length,width,height}_mm  (all >0 CHECK, nullable),
 *     preferred_machine_id->machine_master SET NULL, preferred_die_id (uuid, NO FK), notes, audit.
 *     UNIQUE (item_id, routing_id, routing_type_id).  (No partial-active index.)
 *   sku_planning_steps: id, sku_planning_header_id->sku_planning_header CASCADE,
 *     routing_step_id->routing_steps RESTRICT (nullable), process_type_id->process_types RESTRICT (nullable),
 *     seq_no, step_name, status(draft|active), machine/die/labour/qc_required, wip_produced,
 *     preferred_machine_id->machine_master SET NULL, preferred_die_id (uuid, NO FK),
 *     effective_cavity_count, batch_size_kg, batch_time_min, cycle_time_sec, cavities_used,
 *     drying_time_min, tray_capacity, curing_time_min, target_rate_pcs_hr, time_per_piece_sec
 *       (all >0 CHECK, nullable),
 *     fpa_required, inprocess_qc_required, final_qc_required, packing_qc_required, notes, audit,
 *     + S1 additive: setup_time_min(>=0), time_basis(PIECE|BATCH|KG|TRAY), manpower_count(>=0).
 *     (No DB unique on (header_id, seq_no).)
 *
 * Decisions (locked): bp_weight_g DERIVED from item_master (not stored); routing_step_id OPTIONAL
 *   (set when seeded from routing); effective_cavity_count = planned, cavities_used = actual;
 *   cycle_time_sec = machine cycle, time_per_piece_sec = manual per-piece; reuse WRITE_ROLES.
 * Scope (S1): CRUD only. NO lifecycle/activate/supersede, NO Work Orders, NO scheduler.
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


// Strictly-positive numeric fields (DB CHECK > 0). Empty -> null; present -> must be > 0.
const STEP_POS_FIELDS = [
  'effective_cavity_count', 'cavities_used', 'batch_size_kg', 'batch_time_min',
  'cycle_time_sec', 'time_per_piece_sec', 'drying_time_min', 'tray_capacity',
  'curing_time_min', 'target_rate_pcs_hr',
];
const HEADER_POS_FIELDS = [
  'weight_g', 'pcs_per_set', 'length_mm', 'width_mm', 'thickness_mm',
  'pcs_per_tray', 'trays_per_batch', 'pcs_in_crate',
  'box_length_mm', 'box_width_mm', 'box_height_mm',
  'carton_length_mm', 'carton_width_mm', 'carton_height_mm',
];
const STEP_BOOL_FIELDS = [
  'machine_required', 'die_required', 'labour_required', 'qc_required', 'wip_produced',
  'fpa_required', 'inprocess_qc_required', 'final_qc_required', 'packing_qc_required',
];
const STEP_FK_OPT = ['routing_step_id', 'process_type_id', 'preferred_machine_id', 'preferred_die_id'];
const HEADER_PACKAGING = [...HEADER_POS_FIELDS];

const HEADER_COLS =
  'id, item_id, routing_id, routing_type_id, status, ' +
  HEADER_PACKAGING.join(', ') + ', preferred_machine_id, preferred_die_id, notes, ' +
  'created_by, created_at, updated_by, updated_at';

const STEP_COLS =
  'id, sku_planning_header_id, routing_step_id, process_type_id, seq_no, step_name, status, ' +
  STEP_BOOL_FIELDS.join(', ') + ', preferred_machine_id, preferred_die_id, ' +
  STEP_POS_FIELDS.join(', ') + ', setup_time_min, time_basis, manpower_count, notes, ' +
  'created_by, created_at, updated_by, updated_at';

const TIME_BASES = ['PIECE', 'BATCH', 'KG', 'TRAY'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function txt(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function posOrNull(v, label) {
  const n = numOrNull(v);
  if (n === null) return null;
  if (!(n > 0)) throw { code: 'VALIDATION_ERROR', message: `${label} must be greater than 0.` };
  return n;
}
function intGteOrNull(v, label, min) {
  const n = numOrNull(v);
  if (n === null) return null;
  if (!Number.isFinite(n) || n < min) throw { code: 'VALIDATION_ERROR', message: `${label} must be ${min} or greater.` };
  return Math.trunc(n);
}

async function assertProcessTypesActive(processTypeIds) {
  const ids = [...new Set((processTypeIds ?? []).filter(Boolean))];
  if (ids.length === 0) return;
  const { data, error } = await supabase.from('process_types').select('id, is_active').in('id', ids);
  if (error) throw { code: 'INTERNAL_ERROR', message: 'Failed to validate process types.' };
  const byId = new Map((data ?? []).map((r) => [r.id, r.is_active]));
  for (const id of ids) {
    if (!byId.has(id)) throw { code: 'VALIDATION_ERROR', message: 'Selected process type does not exist.' };
    if (!byId.get(id)) throw { code: 'VALIDATION_ERROR', message: 'Selected process type is inactive.' };
  }
}

function assertNoDuplicateSeq(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (r.seq_no == null) continue;
    if (seen.has(r.seq_no)) throw { code: 'VALIDATION_ERROR', message: `Duplicate step sequence number ${r.seq_no} in payload.` };
    seen.add(r.seq_no);
  }
}

function normalisePlanStep(step, seq) {
  if (!step.step_name?.trim()) throw { code: 'VALIDATION_ERROR', message: 'Step name is required on every step.' };

  const seqNo = step.seq_no != null ? Number(step.seq_no) : seq;
  if (!(Number.isFinite(seqNo) && seqNo >= 0)) throw { code: 'VALIDATION_ERROR', message: 'Step sequence must be 0 or greater.' };

  if (step.time_basis !== undefined && step.time_basis !== null && step.time_basis !== '') {
    if (!TIME_BASES.includes(step.time_basis)) {
      throw { code: 'VALIDATION_ERROR', message: 'Time basis must be one of PIECE, BATCH, KG, TRAY.' };
    }
  }

  const row = {
    seq_no:    Math.trunc(seqNo),
    step_name: step.step_name.trim(),
    status:    'draft',
    notes:     txt(step.notes),
    // S1 additive
    setup_time_min: posSetup(step.setup_time_min),
    time_basis:     txt(step.time_basis),
    manpower_count: intGteOrNull(step.manpower_count, 'Manpower count', 0),
  };

  for (const f of STEP_BOOL_FIELDS) row[f] = step[f] !== undefined ? Boolean(step[f]) : false;
  for (const f of STEP_POS_FIELDS) {
    const label = f.replace(/_/g, ' ');
    row[f] = posOrNull(step[f], label.charAt(0).toUpperCase() + label.slice(1));
  }
  // optional FKs — include only if truthy, else null (allows clearing on update)
  for (const f of STEP_FK_OPT) row[f] = step[f] ? step[f] : null;

  return row;
}

// setup_time_min allows 0 (no setup) — distinct from the >0 fields.
function posSetup(v) {
  const n = numOrNull(v);
  if (n === null) return null;
  if (!(n >= 0)) throw { code: 'VALIDATION_ERROR', message: 'Setup time must be 0 or greater.' };
  return n;
}

function buildHeaderRow(header) {
  const row = { notes: txt(header.notes) };
  for (const f of HEADER_POS_FIELDS) {
    const label = f.replace(/_/g, ' ');
    row[f] = posOrNull(header[f], label.charAt(0).toUpperCase() + label.slice(1));
  }
  row.routing_id        = header.routing_id        ? header.routing_id        : null;
  row.routing_type_id   = header.routing_type_id   ? header.routing_type_id   : null;
  row.preferred_machine_id = header.preferred_machine_id ? header.preferred_machine_id : null;
  row.preferred_die_id     = header.preferred_die_id     ? header.preferred_die_id     : null;
  return row;
}

// ─── Lookups ────────────────────────────────────────────────────────────────

export async function searchPlanItems({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase.from('item_master').select('id, item_code, item_name, bp_weight_g, weight_g')
    .eq('is_active', true).order('item_name', { ascending: true }).limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) query = query.or(`item_name.ilike.%${safeSearch}%,item_code.ilike.%${safeSearch}%`);
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// Active routings for an item, with steps embedded (for seeding the plan step grid).
export async function listPlanRoutings({ item_id } = {}) {
  if (!item_id) return { data: [], error: null };
  const { data, error } = await supabase
    .from('routing_headers')
    .select(`
      id, item_id, routing_type_id, version_number, status,
      routing_type:routing_types ( id, type_name ),
      steps:routing_steps (
        id, seq_no, step_name, process_type_id, wip_produced, is_wo_driven, qc_required,
        machine_required, die_required, labour_required,
        process_type:process_types ( id, type_name )
      )
    `)
    .eq('item_id', item_id)
    .eq('status', 'active')
    .order('version_number', { ascending: false });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listPlanProcessTypes() {
  const { data, error } = await supabase.from('process_types')
    .select('id, type_code, type_name, seq_no').eq('is_active', true).order('seq_no', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listPlanMachines() {
  const { data, error } = await supabase.from('machine_master')
    .select('id, machine_code, machine_name').eq('is_active', true).order('machine_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listPlanDies() {
  const { data, error } = await supabase.from('die_master')
    .select('id, die_code, die_name').eq('is_active', true).order('die_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listPlans({ item_id, status, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;
  let query = supabase
    .from('sku_planning_header')
    .select(`
      id, item_id, routing_id, routing_type_id, status, created_at,
      item:item_master ( id, item_code, item_name ),
      routing_type:routing_types ( id, type_name )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);
  if (item_id) query = query.eq('item_id', item_id);
  if (status)  query = query.eq('status', status);
  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getPlanById(id) {
  const { data: header, error: headerError } = await supabase
    .from('sku_planning_header')
    .select(`${HEADER_COLS},
      item:item_master ( id, item_code, item_name, bp_weight_g, weight_g ),
      routing:routing_headers ( id, version_number, status ),
      routing_type:routing_types ( id, type_name )`)
    .eq('id', id)
    .single();
  if (headerError || !header) return { data: null, error: headerError ?? { message: 'SKU plan not found.' } };

  const { data: steps, error: stepsError } = await supabase
    .from('sku_planning_steps')
    .select(`${STEP_COLS}, process_type:process_types ( id, type_code, type_name )`)
    .eq('sku_planning_header_id', id)
    .order('seq_no', { ascending: true });
  if (stepsError) return { data: null, error: stepsError };

  // bp_weight_g is DERIVED from item_master (never stored on the plan).
  const bp_weight_g = header.item?.bp_weight_g ?? null;
  // routing_stale is DERIVED (warning only, never a block): the routing version this plan
  // is pinned to has been superseded. Surfaced as a banner; does not affect lifecycle actions.
  const routing_stale = header.routing?.status === 'superseded';
  return { data: { ...header, bp_weight_g, routing_stale, steps: steps ?? [] }, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

async function assertNoDuplicatePlan(item_id, routing_id, routing_type_id, excludeId = null) {
  let q = supabase.from('sku_planning_header').select('id').eq('item_id', item_id);
  q = routing_id ? q.eq('routing_id', routing_id) : q.is('routing_id', null);
  q = routing_type_id ? q.eq('routing_type_id', routing_type_id) : q.is('routing_type_id', null);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw { code: 'DB_ERROR', message: error.message };
  if (data) throw { code: 'CONFLICT', message: 'A SKU plan already exists for this item + routing + routing type.' };
}

export async function createPlan(body, userId) {
  const { steps = [], ...header } = body;
  if (!header.item_id) throw { code: 'VALIDATION_ERROR', message: 'Item is required.' };

  // Validate steps before any write.
  const normalisedSteps = steps.map((s, i) => normalisePlanStep(s, i + 1));
  assertNoDuplicateSeq(normalisedSteps);
  await assertProcessTypesActive(normalisedSteps.map((s) => s.process_type_id));

  await assertNoDuplicatePlan(header.item_id, header.routing_id || null, header.routing_type_id || null);

  const { data: created, error: headerError } = await supabase
    .from('sku_planning_header')
    .insert({ item_id: header.item_id, status: 'draft', created_by: userId, updated_by: userId, ...buildHeaderRow(header) })
    .select('id')
    .single();
  if (headerError) {
    if (headerError.code === '23505') throw { code: 'CONFLICT', message: 'A SKU plan already exists for this item + routing + routing type.' };
    return { data: null, error: headerError };
  }

  if (normalisedSteps.length > 0) {
    const stepRows = normalisedSteps.map((s) => ({ sku_planning_header_id: created.id, created_by: userId, ...s }));
    const { error: stepsError } = await supabase.from('sku_planning_steps').insert(stepRows);
    if (stepsError) {
      await supabase.from('sku_planning_steps').delete().eq('sku_planning_header_id', created.id);
      await supabase.from('sku_planning_header').delete().eq('id', created.id);
      return { data: null, error: stepsError };
    }
  }

  return getPlanById(created.id);
}

export async function updateDraftPlan(id, body, userId) {
  const { steps, ...rawHeader } = body;
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('sku_planning_header')
    .select('id, item_id, routing_id, routing_type_id, status')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { message: 'SKU plan not found.' } };
  if (current.status !== 'draft') throw { code: 'VALIDATION_ERROR', message: 'Only draft SKU plans can be edited.' };

  // Whitelisted header fields only — status/audit/lifecycle never client-editable here.
  const allowed = {};
  if (rawHeader.item_id !== undefined) {
    if (!rawHeader.item_id) throw { code: 'VALIDATION_ERROR', message: 'Item is required.' };
    allowed.item_id = rawHeader.item_id;
  }
  if (rawHeader.routing_id        !== undefined) allowed.routing_id        = rawHeader.routing_id        || null;
  if (rawHeader.routing_type_id   !== undefined) allowed.routing_type_id   = rawHeader.routing_type_id   || null;
  if (rawHeader.preferred_machine_id !== undefined) allowed.preferred_machine_id = rawHeader.preferred_machine_id || null;
  if (rawHeader.preferred_die_id     !== undefined) allowed.preferred_die_id     = rawHeader.preferred_die_id     || null;
  if (rawHeader.notes !== undefined) allowed.notes = txt(rawHeader.notes);
  for (const f of HEADER_POS_FIELDS) {
    if (rawHeader[f] !== undefined) {
      const label = f.replace(/_/g, ' ');
      allowed[f] = posOrNull(rawHeader[f], label.charAt(0).toUpperCase() + label.slice(1));
    }
  }

  // Re-check uniqueness if identity columns change.
  const newItem = allowed.item_id ?? current.item_id;
  const newRouting = allowed.routing_id !== undefined ? allowed.routing_id : current.routing_id;
  const newType = allowed.routing_type_id !== undefined ? allowed.routing_type_id : current.routing_type_id;
  if (allowed.item_id !== undefined || allowed.routing_id !== undefined || allowed.routing_type_id !== undefined) {
    await assertNoDuplicatePlan(newItem, newRouting, newType, id);
  }

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = now;
    const { error: headerError } = await supabase.from('sku_planning_header').update(allowed).eq('id', id);
    if (headerError) {
      if (headerError.code === '23505') throw { code: 'CONFLICT', message: 'A SKU plan already exists for this item + routing + routing type.' };
      return { data: null, error: headerError };
    }
  }

  if (steps) {
    const incoming = [...(steps.add ?? []), ...(steps.update ?? [])];
    if (incoming.length > 0) await assertProcessTypesActive(incoming.map((s) => s.process_type_id));

    let preparedAdds = [];
    if (steps.add?.length > 0) {
      const { data: existing } = await supabase
        .from('sku_planning_steps').select('seq_no')
        .eq('sku_planning_header_id', id).order('seq_no', { ascending: false }).limit(1);
      let nextSeq = (existing?.[0]?.seq_no ?? 0) + 1;
      preparedAdds = steps.add.map((s) => ({ sku_planning_header_id: id, created_by: userId, ...normalisePlanStep(s, nextSeq++) }));
    }

    let preparedUpdates = [];
    if (steps.update?.length > 0) {
      preparedUpdates = steps.update.map((s) => {
        const { id: stepId, seq_no, ...fields } = s;
        return { stepId, row: { ...normalisePlanStep({ ...fields, seq_no }, seq_no), updated_by: userId, updated_at: now } };
      });
    }

    assertNoDuplicateSeq([...preparedAdds, ...preparedUpdates.map((u) => u.row)]);

    if (preparedAdds.length > 0) {
      const { error } = await supabase.from('sku_planning_steps').insert(preparedAdds);
      if (error) return { data: null, error };
    }
    for (const u of preparedUpdates) {
      const { error } = await supabase.from('sku_planning_steps').update(u.row).eq('id', u.stepId).eq('sku_planning_header_id', id);
      if (error) return { data: null, error };
    }
    if (steps.remove?.length > 0) {
      const { error } = await supabase.from('sku_planning_steps').delete().in('id', steps.remove).eq('sku_planning_header_id', id);
      if (error) return { data: null, error };
    }
  }

  return getPlanById(id);
}

// ─── Lifecycle (S2b) ──────────────────────────────────────────────────────────
//
// Activate / supersede / new-version on EXISTING sku_planning_header lifecycle columns
// (status, version_number, activated_by/at, superseded_by). NO schema change (applied in S2a).
// Mirrors routingService lifecycle. Header owns lifecycle; sku_planning_steps.status (draft|active)
// follows the header (draft -> active on activation; left as-is on supersede — enum has no superseded).
//
// DB backstops (S2a): partial-unique active index on (item_id, routing_id);
//   version-unique on (item_id, routing_id, routing_type_id, version_number). Violations -> CONFLICT.
// Locked: active uniqueness = (item_id, routing_id); activation auto-supersedes the prior active plan
//   for the same item+routing; new version = max(version_number)+1; routing superseded = warning only.

function pgConflict(error) {
  // Postgres unique_violation surfaced via PostgREST.
  return error && (error.code === '23505' || /duplicate key|unique/i.test(error.message ?? ''));
}

export async function activatePlan(id, userId) {
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('sku_planning_header')
    .select('id, item_id, routing_id, status')
    .eq('id', id)
    .single();
  if (curErr || !current) throw { code: 'NOT_FOUND', message: 'SKU plan not found.' };
  if (current.status !== 'draft') {
    throw { code: 'VALIDATION_ERROR', message: 'Only draft SKU plans can be activated.' };
  }

  // Activation guard: a plan must have at least one step (steps carry the process parameters).
  // Count only — process_type_id is OPTIONAL on SKU steps, so NO process-type validation here.
  const { count: stepCount, error: cntErr } = await supabase
    .from('sku_planning_steps')
    .select('id', { count: 'exact', head: true })
    .eq('sku_planning_header_id', id);
  if (cntErr) return { data: null, error: cntErr };
  if (!stepCount || stepCount === 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Cannot activate a SKU plan with no steps.' };
  }

  // Auto-supersede ANY prior active plan for the same (item_id, routing_id) FIRST, so the
  // partial-unique active index is never transiently violated. Array (not maybeSingle): routing_id
  // is nullable, and Postgres treats NULLs as distinct in unique indexes, so >1 null-routing active
  // row can exist; supersede them all to honour "single active per item+routing".
  let priorQ = supabase
    .from('sku_planning_header')
    .select('id')
    .eq('item_id', current.item_id)
    .eq('status', 'active')
    .neq('id', id);
  priorQ = current.routing_id ? priorQ.eq('routing_id', current.routing_id) : priorQ.is('routing_id', null);
  const { data: priorActive, error: priorErr } = await priorQ;
  if (priorErr) return { data: null, error: priorErr };

  for (const prior of priorActive ?? []) {
    const { error: supErr } = await supabase
      .from('sku_planning_header')
      .update({ status: 'superseded', superseded_by: id, updated_by: userId, updated_at: now })
      .eq('id', prior.id);
    if (supErr) return { data: null, error: supErr };
  }

  const { error: actErr } = await supabase
    .from('sku_planning_header')
    .update({ status: 'active', activated_by: userId, activated_at: now, updated_by: userId, updated_at: now })
    .eq('id', id);
  if (actErr) {
    if (pgConflict(actErr)) throw { code: 'CONFLICT', message: 'Another active plan already exists for this item and routing.' };
    return { data: null, error: actErr };
  }

  // Header owns lifecycle: promote this plan's steps draft -> active.
  const { error: stepErr } = await supabase
    .from('sku_planning_steps')
    .update({ status: 'active', updated_by: userId, updated_at: now })
    .eq('sku_planning_header_id', id);
  if (stepErr) return { data: null, error: stepErr };

  return getPlanById(id);
}

export async function supersedePlan(id, userId) {
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('sku_planning_header')
    .select('id, status')
    .eq('id', id)
    .single();
  if (curErr || !current) throw { code: 'NOT_FOUND', message: 'SKU plan not found.' };
  if (current.status !== 'active') {
    throw { code: 'VALIDATION_ERROR', message: 'Only active SKU plans can be superseded.' };
  }

  // Explicit retire — no successor, so superseded_by stays null. Steps keep their status
  // (enum is draft|active only); the header status is the source of truth.
  const { error } = await supabase
    .from('sku_planning_header')
    .update({ status: 'superseded', superseded_by: null, updated_by: userId, updated_at: now })
    .eq('id', id);
  if (error) return { data: null, error };

  return getPlanById(id);
}

export async function createNewVersionPlan(id, userId) {
  // Load source (header + steps).
  const { data: source, error: srcErr } = await getPlanById(id);
  if (srcErr || !source) throw { code: 'NOT_FOUND', message: 'SKU plan not found.' };

  // Next version_number within the same (item_id, routing_id, routing_type_id) group.
  let verQ = supabase
    .from('sku_planning_header')
    .select('version_number')
    .eq('item_id', source.item_id)
    .order('version_number', { ascending: false })
    .limit(1);
  verQ = source.routing_id      ? verQ.eq('routing_id', source.routing_id)           : verQ.is('routing_id', null);
  verQ = source.routing_type_id ? verQ.eq('routing_type_id', source.routing_type_id) : verQ.is('routing_type_id', null);
  const { data: latest, error: verErr } = await verQ;
  if (verErr) return { data: null, error: verErr };
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;

  // New header = clean draft. Identity + packaging + preferred + notes copied; lifecycle NOT copied.
  // No assertNoDuplicatePlan here — versions intentionally share (item, routing, type); the 4-col
  // version-unique index is the backstop.
  const headerRow = {
    item_id:              source.item_id,
    routing_id:           source.routing_id ?? null,
    routing_type_id:      source.routing_type_id ?? null,
    version_number:       nextVersion,
    status:               'draft',
    notes:                source.notes ?? null,
    preferred_machine_id: source.preferred_machine_id ?? null,
    preferred_die_id:     source.preferred_die_id ?? null,
    created_by:           userId,
    updated_by:           userId,
  };
  for (const f of HEADER_POS_FIELDS) headerRow[f] = source[f] ?? null;

  const { data: created, error: headerError } = await supabase
    .from('sku_planning_header')
    .insert(headerRow)
    .select('id')
    .single();
  if (headerError) {
    if (pgConflict(headerError)) throw { code: 'CONFLICT', message: 'A plan with the next version already exists; please retry.' };
    return { data: null, error: headerError };
  }

  // Deep-copy steps (new ids; same content). normalisePlanStep forces status 'draft' and re-validates.
  if ((source.steps ?? []).length > 0) {
    const stepRows = source.steps.map((s) => {
      const copy = {
        step_name:            s.step_name,
        seq_no:               s.seq_no,
        time_basis:           s.time_basis,
        setup_time_min:       s.setup_time_min,
        manpower_count:       s.manpower_count,
        routing_step_id:      s.routing_step_id,
        process_type_id:      s.process_type_id,
        preferred_machine_id: s.preferred_machine_id,
        preferred_die_id:     s.preferred_die_id,
        notes:                s.notes,
      };
      for (const f of STEP_POS_FIELDS)  copy[f] = s[f];
      for (const f of STEP_BOOL_FIELDS) copy[f] = s[f];
      return { sku_planning_header_id: created.id, created_by: userId, ...normalisePlanStep(copy, s.seq_no) };
    });
    const { error: stepsError } = await supabase.from('sku_planning_steps').insert(stepRows);
    if (stepsError) return { data: null, error: stepsError };
  }

  return getPlanById(created.id);
}
