/**
 * CERADRIVE ERP — Routing Service  (UI: "Process Flow" / Routing Master)
 *
 * Header + steps CRUD only. Mirrors bomService header/lines transactional pattern.
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 *
 * Live schema (confirmed):
 *   routing_headers: id, item_id->item_master, routing_type_id->routing_types, version_number(def 1),
 *     status(draft|active|superseded, def draft), effective_date, notes,
 *     activated_by, activated_at, superseded_by, created_by/at, updated_by/at
 *   routing_steps: id, routing_header_id->routing_headers, seq_no, step_name, process_type_id->process_types,
 *     input_item_id->item_master, output_item_id->item_master, wip_produced(def true), is_wo_driven(def false),
 *     qc_required(def false), machine_required(def false), die_required(def false), labour_required(def false),
 *     is_active(def true), notes, created_by/at, updated_by/at
 *   routing_types: id, type_code(UNIQUE), type_name, description, is_active(def true)
 *   process_types: id, type_code, type_name, seq_no, is_active (14 active confirmed)
 *
 * Scope (confirmed): CRUD only. NOT implemented: lifecycle activation/supersede/version, planning,
 *   work orders, scheduling, capacity, MRP, execution.
 * Rules: header item + routing_type mandatory; routing_type fetched from active rows (not hardcoded);
 *   every step requires process_type + step_name; every step's process_type must exist and be active;
 *   new routing starts 'draft'; updates allowed ONLY while status = 'draft' (explicit guard);
 *   duplicate seq_no within a single payload is rejected before any DB write;
 *   lifecycle/version/audit fields not editable via update; step machine/die/labour/qc are boolean flags.
 *
 * Constraint backstops (DB-enforced, surfaced as raw errors — same as bomService):
 *   UNIQUE(item_id, routing_type_id, version_number); UNIQUE(routing_header_id, seq_no).
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


// ─── Lookups (served in-module; no external module dependency) ────────────────

export async function listRoutingTypes() {
  const { data, error } = await supabase
    .from('routing_types')
    .select('id, type_code, type_name')
    .eq('is_active', true)
    .order('type_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listProcessTypes() {
  const { data, error } = await supabase
    .from('process_types')
    .select('id, type_code, type_name, seq_no')
    .eq('is_active', true)
    .order('seq_no', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function searchRoutingItems({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase
    .from('item_master')
    .select('id, item_code, item_name')
    .eq('is_active', true)
    .order('item_name', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`item_name.ilike.%${safeSearch}%,item_code.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

async function assertRoutingTypeActive(routing_type_id) {
  const { data, error } = await supabase
    .from('routing_types')
    .select('id, is_active')
    .eq('id', routing_type_id)
    .maybeSingle();
  if (error || !data) throw { code: 'VALIDATION_ERROR', message: 'Selected routing type does not exist.' };
  if (!data.is_active) throw { code: 'VALIDATION_ERROR', message: 'Selected routing type is inactive.' };
}

// Fix A: every step's process_type must exist AND be active.
async function assertProcessTypesActive(processTypeIds) {
  const ids = [...new Set((processTypeIds ?? []).filter(Boolean))];
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('process_types')
    .select('id, is_active')
    .in('id', ids);
  if (error) throw { code: 'INTERNAL_ERROR', message: 'Failed to validate process types.' };
  const byId = new Map((data ?? []).map((r) => [r.id, r.is_active]));
  for (const id of ids) {
    if (!byId.has(id))  throw { code: 'VALIDATION_ERROR', message: 'Selected process type does not exist.' };
    if (!byId.get(id))  throw { code: 'VALIDATION_ERROR', message: 'Selected process type is inactive.' };
  }
}

// Fix C: reject duplicate seq_no within a single payload before any DB write.
function assertNoDuplicateSeq(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (r.seq_no == null) continue;
    if (seen.has(r.seq_no)) throw { code: 'VALIDATION_ERROR', message: `Duplicate step sequence number ${r.seq_no} in payload.` };
    seen.add(r.seq_no);
  }
}

function normaliseRoutingStep(step, seq) {
  if (!step.process_type_id)    throw { code: 'VALIDATION_ERROR', message: 'Process type is required on every step.' };
  if (!step.step_name?.trim())  throw { code: 'VALIDATION_ERROR', message: 'Step name is required on every step.' };

  return {
    seq_no:           step.seq_no != null ? Number(step.seq_no) : seq,
    step_name:        step.step_name.trim(),
    process_type_id:  step.process_type_id,
    input_item_id:    step.input_item_id  || null,
    output_item_id:   step.output_item_id || null,
    wip_produced:     step.wip_produced     !== undefined ? Boolean(step.wip_produced)     : true,
    is_wo_driven:     step.is_wo_driven     !== undefined ? Boolean(step.is_wo_driven)     : false,
    qc_required:      step.qc_required      !== undefined ? Boolean(step.qc_required)      : false,
    machine_required: step.machine_required !== undefined ? Boolean(step.machine_required) : false,
    die_required:     step.die_required     !== undefined ? Boolean(step.die_required)     : false,
    labour_required:  step.labour_required  !== undefined ? Boolean(step.labour_required)  : false,
    is_active:        true,
    notes:            step.notes || null,
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listRoutings({ status, routing_type_id, item_id, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('routing_headers')
    .select(`
      id, item_id, routing_type_id, version_number, status, effective_date, created_at,
      routing_type:routing_types ( type_code, type_name ),
      item:item_master ( item_code, item_name )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (status)          query = query.eq('status', status);
  if (routing_type_id) query = query.eq('routing_type_id', routing_type_id);
  if (item_id)         query = query.eq('item_id', item_id);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getRoutingById(id) {
  const { data: header, error: headerError } = await supabase
    .from('routing_headers')
    .select(`
      id, item_id, routing_type_id, version_number, status, effective_date,
      activated_by, activated_at, superseded_by, notes,
      created_by, created_at, updated_by, updated_at,
      routing_type:routing_types ( id, type_code, type_name ),
      item:item_master ( id, item_code, item_name )
    `)
    .eq('id', id)
    .single();

  if (headerError || !header) {
    return { data: null, error: headerError ?? { message: 'Routing not found.' } };
  }

  // routing_steps has two FKs to item_master (input_item_id, output_item_id) — disambiguate
  // the embedded resources with the PostgREST foreign-key-column hint (table!fk_column).
  const { data: steps, error: stepsError } = await supabase
    .from('routing_steps')
    .select(`
      id, routing_header_id, seq_no, step_name, process_type_id,
      input_item_id, output_item_id, wip_produced, is_wo_driven, qc_required,
      machine_required, die_required, labour_required, is_active, notes,
      created_by, created_at, updated_by, updated_at,
      process_type:process_types ( id, type_code, type_name ),
      input_item:item_master!input_item_id ( id, item_code, item_name ),
      output_item:item_master!output_item_id ( id, item_code, item_name )
    `)
    .eq('routing_header_id', id)
    .order('seq_no', { ascending: true });

  if (stepsError) return { data: null, error: stepsError };

  return { data: { ...header, steps: steps ?? [] }, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function createRouting(body, userId) {
  const { steps = [], ...header } = body;

  if (!header.item_id)         throw { code: 'VALIDATION_ERROR', message: 'Item is required.' };
  if (!header.routing_type_id) throw { code: 'VALIDATION_ERROR', message: 'Routing type is required.' };

  await assertRoutingTypeActive(header.routing_type_id);

  // Validate all steps before any write (fail-fast — no orphan header).
  const normalisedSteps = steps.map((step, i) => normaliseRoutingStep(step, i + 1));
  assertNoDuplicateSeq(normalisedSteps);                                       // Fix C
  await assertProcessTypesActive(normalisedSteps.map((s) => s.process_type_id)); // Fix A

  const { data: created, error: headerError } = await supabase
    .from('routing_headers')
    .insert({
      item_id:         header.item_id,
      routing_type_id: header.routing_type_id,
      effective_date:  header.effective_date || null,
      notes:           header.notes          || null,
      status:          'draft',              // new routing always starts draft
      created_by:      userId,
    })
    .select('id')
    .single();

  if (headerError) return { data: null, error: headerError };

  if (normalisedSteps.length > 0) {
    const stepRows = normalisedSteps.map((s) => ({
      routing_header_id: created.id,
      created_by:        userId,
      ...s,
    }));
    const { error: stepsError } = await supabase.from('routing_steps').insert(stepRows);
    if (stepsError) {
      await supabase.from('routing_steps').delete().eq('routing_header_id', created.id);
      await supabase.from('routing_headers').delete().eq('id', created.id);
      return { data: null, error: stepsError };
    }
  }

  return getRoutingById(created.id);
}

export async function updateDraftRouting(id, body, userId) {
  const { steps, ...rawHeader } = body;
  const now = new Date().toISOString();

  // Fix B: load status and enforce draft-only — do not rely on absence of lifecycle routes.
  const { data: current, error: curErr } = await supabase
    .from('routing_headers')
    .select('id, status')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { message: 'Routing not found.' } };
  if (current.status !== 'draft') {
    throw { code: 'VALIDATION_ERROR', message: 'Only draft routings can be edited.' };
  }

  // Whitelisted header fields only — lifecycle/version/audit fields are NOT editable here.
  const allowed = {};
  if (rawHeader.item_id         !== undefined) allowed.item_id = rawHeader.item_id;
  if (rawHeader.routing_type_id !== undefined) { await assertRoutingTypeActive(rawHeader.routing_type_id); allowed.routing_type_id = rawHeader.routing_type_id; }
  if (rawHeader.effective_date  !== undefined) allowed.effective_date = rawHeader.effective_date || null;
  if (rawHeader.notes           !== undefined) allowed.notes = rawHeader.notes || null;

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = now;
    const { error: headerError } = await supabase.from('routing_headers').update(allowed).eq('id', id);
    if (headerError) return { data: null, error: headerError };
  }

  if (steps) {
    // Fix A: validate process types across all added + updated steps.
    const incoming = [...(steps.add ?? []), ...(steps.update ?? [])];
    if (incoming.length > 0) {
      await assertProcessTypesActive(incoming.map((s) => s.process_type_id));
    }

    // Pre-normalise adds (auto-seq) and updates, gathering payload seq_nos.
    let preparedAdds = [];
    if (steps.add?.length > 0) {
      const { data: existing } = await supabase
        .from('routing_steps')
        .select('seq_no')
        .eq('routing_header_id', id)
        .order('seq_no', { ascending: false })
        .limit(1);
      let nextSeq = (existing?.[0]?.seq_no ?? 0) + 1;
      preparedAdds = steps.add.map((step) => ({
        routing_header_id: id,
        created_by:        userId,
        ...normaliseRoutingStep(step, nextSeq++),
      }));
    }

    let preparedUpdates = [];
    if (steps.update?.length > 0) {
      preparedUpdates = steps.update.map((step) => {
        const { id: stepId, seq_no, ...fields } = step;
        return { stepId, row: { ...normaliseRoutingStep(fields, seq_no), updated_by: userId, updated_at: now } };
      });
    }

    // Fix C: reject duplicate seq_no within the payload (adds + updates) before any write.
    assertNoDuplicateSeq([...preparedAdds, ...preparedUpdates.map((u) => u.row)]);

    if (preparedAdds.length > 0) {
      const { error } = await supabase.from('routing_steps').insert(preparedAdds);
      if (error) return { data: null, error };
    }

    if (preparedUpdates.length > 0) {
      for (const u of preparedUpdates) {
        const { error } = await supabase
          .from('routing_steps')
          .update(u.row)
          .eq('id', u.stepId)
          .eq('routing_header_id', id);
        if (error) return { data: null, error };
      }
    }

    if (steps.remove?.length > 0) {
      const { error } = await supabase
        .from('routing_steps')
        .delete()
        .in('id', steps.remove)
        .eq('routing_header_id', id);
      if (error) return { data: null, error };
    }
  }

  return getRoutingById(id);
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────
//
// Activate / supersede / new-version. Writes ONLY existing routing_headers lifecycle
// columns (status, version_number, effective_date, activated_by/at, superseded_by).
// No schema change. Single-active and version-unique invariants are DB-enforced
// (partial-unique active index + version-unique index); violations surface as CONFLICT.

function pgConflict(error) {
  // Postgres unique_violation surfaced via PostgREST.
  return error && (error.code === '23505' || /duplicate key|unique/i.test(error.message ?? ''));
}

export async function activateRouting(id, userId) {
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('routing_headers')
    .select('id, item_id, routing_type_id, status, effective_date')
    .eq('id', id)
    .single();
  if (curErr || !current) throw { code: 'NOT_FOUND', message: 'Routing not found.' };
  if (current.status !== 'draft') {
    throw { code: 'VALIDATION_ERROR', message: 'Only draft routings can be activated.' };
  }

  await assertRoutingTypeActive(current.routing_type_id);

  const { data: steps, error: stepsErr } = await supabase
    .from('routing_steps')
    .select('id, process_type_id')
    .eq('routing_header_id', id);
  if (stepsErr) return { data: null, error: stepsErr };
  if (!steps || steps.length === 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Cannot activate a routing with no steps.' };
  }
  await assertProcessTypesActive(steps.map((s) => s.process_type_id));

  // Supersede any existing active routing for the same (item, routing_type) FIRST,
  // so the partial-unique active index is never transiently violated.
  const { data: priorActive, error: priorErr } = await supabase
    .from('routing_headers')
    .select('id')
    .eq('item_id', current.item_id)
    .eq('routing_type_id', current.routing_type_id)
    .eq('status', 'active')
    .maybeSingle();
  if (priorErr) return { data: null, error: priorErr };

  if (priorActive && priorActive.id !== id) {
    const { error: supErr } = await supabase
      .from('routing_headers')
      .update({ status: 'superseded', superseded_by: id, updated_by: userId, updated_at: now })
      .eq('id', priorActive.id);
    if (supErr) return { data: null, error: supErr };
  }

  const { error: actErr } = await supabase
    .from('routing_headers')
    .update({
      status:         'active',
      activated_by:   userId,
      activated_at:   now,
      effective_date: current.effective_date ?? now.slice(0, 10), // null -> activation date
      updated_by:     userId,
      updated_at:     now,
    })
    .eq('id', id);
  if (actErr) {
    if (pgConflict(actErr)) throw { code: 'CONFLICT', message: 'Another active routing already exists for this item and routing type.' };
    return { data: null, error: actErr };
  }

  return getRoutingById(id);
}

export async function supersedeRouting(id, userId) {
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('routing_headers')
    .select('id, status')
    .eq('id', id)
    .single();
  if (curErr || !current) throw { code: 'NOT_FOUND', message: 'Routing not found.' };
  if (current.status !== 'active') {
    throw { code: 'VALIDATION_ERROR', message: 'Only active routings can be superseded.' };
  }

  const { error } = await supabase
    .from('routing_headers')
    .update({ status: 'superseded', superseded_by: null, updated_by: userId, updated_at: now })
    .eq('id', id);
  if (error) return { data: null, error };

  return getRoutingById(id);
}

export async function createNewVersion(id, userId) {
  // Load source (header + steps).
  const { data: source, error: srcErr } = await getRoutingById(id);
  if (srcErr || !source) throw { code: 'NOT_FOUND', message: 'Routing not found.' };

  // Next version_number for the same (item, routing_type).
  const { data: latest, error: verErr } = await supabase
    .from('routing_headers')
    .select('version_number')
    .eq('item_id', source.item_id)
    .eq('routing_type_id', source.routing_type_id)
    .order('version_number', { ascending: false })
    .limit(1);
  if (verErr) return { data: null, error: verErr };
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;

  // New header starts as a clean draft — lifecycle fields NOT copied.
  const { data: created, error: headerError } = await supabase
    .from('routing_headers')
    .insert({
      item_id:         source.item_id,
      routing_type_id: source.routing_type_id,
      version_number:  nextVersion,
      status:          'draft',
      effective_date:  null,
      notes:           source.notes ?? null,
      created_by:      userId,
    })
    .select('id')
    .single();
  if (headerError) {
    if (pgConflict(headerError)) throw { code: 'CONFLICT', message: 'A routing with the next version number already exists; please retry.' };
    return { data: null, error: headerError };
  }

  // Deep-copy steps (new ids; same content). Reuses normaliseRoutingStep for flag/field parity.
  if ((source.steps ?? []).length > 0) {
    const stepRows = source.steps.map((s) => ({
      routing_header_id: created.id,
      created_by:        userId,
      ...normaliseRoutingStep(
        {
          step_name:        s.step_name,
          process_type_id:  s.process_type_id,
          input_item_id:    s.input_item_id,
          output_item_id:   s.output_item_id,
          wip_produced:     s.wip_produced,
          is_wo_driven:     s.is_wo_driven,
          qc_required:      s.qc_required,
          machine_required: s.machine_required,
          die_required:     s.die_required,
          labour_required:  s.labour_required,
          notes:            s.notes,
        },
        s.seq_no,
      ),
    }));
    const { error: stepsError } = await supabase.from('routing_steps').insert(stepRows);
    if (stepsError) return { data: null, error: stepsError };
  }

  return getRoutingById(created.id);
}
