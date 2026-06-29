
function sanitizeOrSearch(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\\%_]/g, '\\$&')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CERADRIVE ERP — Routing Template Service (T1)
 *
 * Reusable routing step library (header + steps). Mirrors bomService header/lines
 * transactional pattern: returns { data, error }; throws plain { code, message } for
 * business-rule violations.
 *
 * Tables (additive; created by migration 0060):
 *   routing_templates:      id, template_code(UNIQUE, upper), template_name, description,
 *                           is_active(def true), created_by/at, updated_by/at
 *   routing_template_steps: id, template_id->routing_templates (CASCADE), seq_no(>=0),
 *                           step_name (authored, NOT NULL), process_type_id->process_types,
 *                           is_mandatory(def true), default_enabled(def true), notes,
 *                           created_by/at, updated_by/at
 *
 * Scope (T1): CRUD + copy + toggle-active. NO composer, NO routing_headers/steps writes,
 *   NO lifecycle/versioning, NO SKU planning, NO work orders.
 * Rules: template_code + template_name mandatory; code uppercased + unique (CI);
 *   every step requires authored step_name + an existing+active process_type;
 *   seq_no integer >= 0, no duplicate seq within a payload; template_code read-only after create;
 *   booleans written explicitly; optional text empty -> null.
 */

import { supabase } from '../config/supabase.js';

const HEADER_COLS =
  'id, template_code, template_name, description, is_active, ' +
  'created_by, created_at, updated_by, updated_at';

const STEP_COLS =
  'id, template_id, seq_no, step_name, process_type_id, ' +
  'is_mandatory, default_enabled, is_active, notes, created_by, created_at, updated_by, updated_at';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

function txt(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function assertCodeUnique(templateCode, excludeId = null) {
  let q = supabase.from('routing_templates').select('id').ilike('template_code', templateCode);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw { code: 'DB_ERROR', message: error.message };
  if (data) throw { code: 'CONFLICT', message: `Template code "${templateCode}" already exists.` };
}

// Every step's process_type must exist AND be active (mirrors routingService.assertProcessTypesActive).
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

function normaliseTemplateStep(step, seq) {
  if (!step.process_type_id)   throw { code: 'VALIDATION_ERROR', message: 'Process type is required on every step.' };
  if (!step.step_name?.trim()) throw { code: 'VALIDATION_ERROR', message: 'Step name is required on every step.' };

  const seqNo = step.seq_no != null ? Number(step.seq_no) : seq;
  if (!(Number.isFinite(seqNo) && seqNo >= 0)) throw { code: 'VALIDATION_ERROR', message: 'Step sequence must be 0 or greater.' };

  return {
    seq_no:          Math.trunc(seqNo),
    step_name:       step.step_name.trim(),
    process_type_id: step.process_type_id,
    is_mandatory:    step.is_mandatory    !== undefined ? Boolean(step.is_mandatory)    : true,
    default_enabled: step.default_enabled !== undefined ? Boolean(step.default_enabled) : true,
    is_active:       step.is_active       !== undefined ? Boolean(step.is_active)       : true,
    notes:           txt(step.notes),
  };
}

// ─── Lookups ────────────────────────────────────────────────────────────────

export async function listTemplateProcessTypes() {
  const { data, error } = await supabase
    .from('process_types')
    .select('id, type_code, type_name, seq_no')
    .eq('is_active', true)
    .order('seq_no', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listTemplates({ search = '', isActive, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('routing_templates')
    .select(HEADER_COLS, { count: 'exact' })
    .order('template_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const s = sanitizeOrSearch(search);
  if (s) query = query.or(`template_name.ilike.%${s}%,template_code.ilike.%${s}%`);
  if (isActive === true || isActive === false) query = query.eq('is_active', isActive);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getTemplateById(id) {
  const { data: header, error: headerError } = await supabase
    .from('routing_templates')
    .select(HEADER_COLS)
    .eq('id', id)
    .single();
  if (headerError || !header) {
    return { data: null, error: headerError ?? { message: 'Routing template not found.' } };
  }

  const { data: steps, error: stepsError } = await supabase
    .from('routing_template_steps')
    .select(`${STEP_COLS}, process_type:process_types ( id, type_code, type_name )`)
    .eq('template_id', id)
    .order('seq_no', { ascending: true });
  if (stepsError) return { data: null, error: stepsError };

  return { data: { ...header, steps: steps ?? [] }, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function createTemplate(body, userId) {
  const { steps = [], ...header } = body;

  const templateCode = normaliseCode(header.template_code);
  const templateName = String(header.template_name ?? '').trim();
  if (!templateCode) throw { code: 'VALIDATION_ERROR', message: 'Template code is required.' };
  if (!templateName) throw { code: 'VALIDATION_ERROR', message: 'Template name is required.' };

  // Validate all steps before any write (fail-fast — no orphan header).
  const normalisedSteps = steps.map((s, i) => normaliseTemplateStep(s, i + 1));
  assertNoDuplicateSeq(normalisedSteps);
  await assertProcessTypesActive(normalisedSteps.map((s) => s.process_type_id));

  await assertCodeUnique(templateCode);

  const { data: created, error: headerError } = await supabase
    .from('routing_templates')
    .insert({
      template_code: templateCode,
      template_name: templateName,
      description:   txt(header.description),
      is_active:     header.is_active === false ? false : true,
      created_by:    userId,
      updated_by:    userId,
    })
    .select('id')
    .single();

  if (headerError) {
    if (headerError.code === '23505') throw { code: 'CONFLICT', message: `Template code "${templateCode}" already exists.` };
    return { data: null, error: headerError };
  }

  if (normalisedSteps.length > 0) {
    const stepRows = normalisedSteps.map((s) => ({ template_id: created.id, created_by: userId, ...s }));
    const { error: stepsError } = await supabase.from('routing_template_steps').insert(stepRows);
    if (stepsError) {
      await supabase.from('routing_template_steps').delete().eq('template_id', created.id);
      await supabase.from('routing_templates').delete().eq('id', created.id);
      return { data: null, error: stepsError };
    }
  }

  return getTemplateById(created.id);
}

export async function updateTemplate(id, body, userId) {
  const { steps, ...rawHeader } = body;
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('routing_templates')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { message: 'Routing template not found.' } };

  // Whitelisted header fields only — template_code is read-only after creation.
  const allowed = {};
  if (rawHeader.template_name !== undefined) {
    const nm = String(rawHeader.template_name ?? '').trim();
    if (!nm) throw { code: 'VALIDATION_ERROR', message: 'Template name is required.' };
    allowed.template_name = nm;
  }
  if (rawHeader.description !== undefined) allowed.description = txt(rawHeader.description);
  if (rawHeader.is_active   !== undefined) allowed.is_active   = rawHeader.is_active === true;

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = now;
    const { error: headerError } = await supabase.from('routing_templates').update(allowed).eq('id', id);
    if (headerError) return { data: null, error: headerError };
  }

  if (steps) {
    const incoming = [...(steps.add ?? []), ...(steps.update ?? [])];
    if (incoming.length > 0) await assertProcessTypesActive(incoming.map((s) => s.process_type_id));

    let preparedAdds = [];
    if (steps.add?.length > 0) {
      const { data: existing } = await supabase
        .from('routing_template_steps')
        .select('seq_no')
        .eq('template_id', id)
        .order('seq_no', { ascending: false })
        .limit(1);
      let nextSeq = (existing?.[0]?.seq_no ?? 0) + 1;
      preparedAdds = steps.add.map((s) => ({ template_id: id, created_by: userId, ...normaliseTemplateStep(s, nextSeq++) }));
    }

    let preparedUpdates = [];
    if (steps.update?.length > 0) {
      preparedUpdates = steps.update.map((s) => {
        const { id: stepId, seq_no, ...fields } = s;
        return { stepId, row: { ...normaliseTemplateStep({ ...fields, seq_no }, seq_no), updated_by: userId, updated_at: now } };
      });
    }

    assertNoDuplicateSeq([...preparedAdds, ...preparedUpdates.map((u) => u.row)]);

    if (preparedAdds.length > 0) {
      const { error } = await supabase.from('routing_template_steps').insert(preparedAdds);
      if (error) return { data: null, error };
    }
    if (preparedUpdates.length > 0) {
      for (const u of preparedUpdates) {
        const { error } = await supabase
          .from('routing_template_steps')
          .update(u.row)
          .eq('id', u.stepId)
          .eq('template_id', id);
        if (error) return { data: null, error };
      }
    }
    if (steps.remove?.length > 0) {
      const { error } = await supabase
        .from('routing_template_steps')
        .delete()
        .in('id', steps.remove)
        .eq('template_id', id);
      if (error) return { data: null, error };
    }
  }

  return getTemplateById(id);
}

export async function toggleTemplateActive(id, isActive, userId) {
  const { data: current, error: curErr } = await supabase
    .from('routing_templates')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) throw { code: 'NOT_FOUND', message: 'Routing template not found.' };

  const { error } = await supabase
    .from('routing_templates')
    .update({ is_active: isActive === true, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { data: null, error };
  return getTemplateById(id);
}

export async function copyTemplate(id, body, userId) {
  const newCode = normaliseCode(body?.template_code);
  const newName = String(body?.template_name ?? '').trim();
  if (!newCode) throw { code: 'VALIDATION_ERROR', message: 'New template code is required.' };
  if (!newName) throw { code: 'VALIDATION_ERROR', message: 'New template name is required.' };

  const { data: source, error: srcErr } = await getTemplateById(id);
  if (srcErr || !source) throw { code: 'NOT_FOUND', message: 'Routing template not found.' };

  await assertCodeUnique(newCode);

  const { data: created, error: headerError } = await supabase
    .from('routing_templates')
    .insert({
      template_code: newCode,
      template_name: newName,
      description:   source.description ?? null,
      is_active:     true,
      created_by:    userId,
      updated_by:    userId,
    })
    .select('id')
    .single();
  if (headerError) {
    if (headerError.code === '23505') throw { code: 'CONFLICT', message: `Template code "${newCode}" already exists.` };
    return { data: null, error: headerError };
  }

  if ((source.steps ?? []).length > 0) {
    const stepRows = source.steps.map((s) => ({
      template_id: created.id,
      created_by:  userId,
      ...normaliseTemplateStep(
        {
          step_name:       s.step_name,
          process_type_id: s.process_type_id,
          is_mandatory:    s.is_mandatory,
          default_enabled: s.default_enabled,
          is_active:       s.is_active,
          notes:           s.notes,
        },
        s.seq_no,
      ),
    }));
    const { error: stepsError } = await supabase.from('routing_template_steps').insert(stepRows);
    if (stepsError) return { data: null, error: stepsError };
  }

  return getTemplateById(created.id);
}
