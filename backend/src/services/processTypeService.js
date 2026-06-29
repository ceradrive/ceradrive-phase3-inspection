/**
 * CERADRIVE ERP — Process Type Service
 * Flat master: identity + sequence + flags + optional stage-item config.
 * Mirrors itemTypeService pattern. { data, error } returns; throws { code, message } on rule violations.
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


const TABLE = 'process_types';

const SELECT_COLS =
  'id, type_code, type_name, description, seq_no, ' +
  'is_wo_driven, is_bottleneck, generates_stage_item, ' +
  'stage_item_code_abbr, stage_item_name_label, default_stage_uom_code, ' +
  'is_active, created_by, created_at, updated_by, updated_at';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

function txt(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function assertCodeUnique(typeCode, excludeId = null) {
  let q = supabase.from(TABLE).select('id').eq('type_code', typeCode);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw { code: 'DB_ERROR', message: error.message };
  if (data) throw { code: 'CONFLICT', message: `Process type code "${typeCode}" already exists.` };
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchProcessTypes(term = '', limit = 20) {
  const t = sanitizeOrSearch(term);
  let q = supabase
    .from(TABLE)
    .select(SELECT_COLS)
    .eq('is_active', true)
    .order('seq_no', { ascending: true })
    .order('type_name', { ascending: true })
    .limit(limit);

  if (t) q = q.or(`type_name.ilike.%${t}%,type_code.ilike.%${t}%`);

  const { data, error } = await q;
  return { data: data ?? [], error };
}

// ─── List (paginated) ───────────────────────────────────────────────────────────

export async function listProcessTypes({ page = 1, limit = 20, search = '', isActive } = {}) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from(TABLE)
    .select(SELECT_COLS, { count: 'exact' })
    .order('seq_no', { ascending: true })
    .order('type_name', { ascending: true })
    .range(from, to);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`type_name.ilike.%${safeSearch}%,type_code.ilike.%${safeSearch}%`);
  if (isActive === true || isActive === false) q = q.eq('is_active', isActive);

  const { data, count, error } = await q;
  return { data: data ?? [], count: count ?? 0, error };
}

// ─── Get by id ──────────────────────────────────────────────────────────────────

export async function getProcessTypeById(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_COLS)
    .eq('id', id)
    .single();
  return { data, error };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createProcessType(body, userId) {
  const typeCode = normaliseCode(body.type_code);
  const typeName = String(body.type_name ?? '').trim();

  if (!typeCode) throw { code: 'VALIDATION_ERROR', message: 'Process type code is required.' };
  if (!typeName) throw { code: 'VALIDATION_ERROR', message: 'Process type name is required.' };

  const seqNo = intOrNull(body.seq_no);
  const seqVal = seqNo === null ? 0 : seqNo;
  if (seqVal < 0) throw { code: 'VALIDATION_ERROR', message: 'Sequence number must be 0 or greater.' };

  await assertCodeUnique(typeCode);

  const row = {
    type_code: typeCode,
    type_name: typeName,
    description: txt(body.description),
    seq_no: seqVal,
    is_wo_driven: body.is_wo_driven === true,
    is_bottleneck: body.is_bottleneck === true,
    generates_stage_item: body.generates_stage_item === false ? false : true,
    stage_item_code_abbr: txt(body.stage_item_code_abbr),
    stage_item_name_label: txt(body.stage_item_name_label),
    default_stage_uom_code: txt(body.default_stage_uom_code),
    is_active: body.is_active === false ? false : true,
    created_by: userId ?? null,
    updated_by: userId ?? null,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select('id').single();
  if (error) {
    if (error.code === '23505') throw { code: 'CONFLICT', message: `Process type code "${typeCode}" already exists.` };
    throw { code: 'DB_ERROR', message: error.message };
  }
  return getProcessTypeById(data.id);
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateProcessType(id, body, userId) {
  const allowed = {};

  if (body.type_name !== undefined) {
    const typeName = String(body.type_name ?? '').trim();
    if (!typeName) throw { code: 'VALIDATION_ERROR', message: 'Process type name is required.' };
    allowed.type_name = typeName;
  }
  if (body.description !== undefined) allowed.description = txt(body.description);

  if (body.seq_no !== undefined) {
    const seqNo = intOrNull(body.seq_no);
    const seqVal = seqNo === null ? 0 : seqNo;
    if (seqVal < 0) throw { code: 'VALIDATION_ERROR', message: 'Sequence number must be 0 or greater.' };
    allowed.seq_no = seqVal;
  }

  if (body.is_wo_driven !== undefined) allowed.is_wo_driven = body.is_wo_driven === true;
  if (body.is_bottleneck !== undefined) allowed.is_bottleneck = body.is_bottleneck === true;
  if (body.generates_stage_item !== undefined) allowed.generates_stage_item = body.generates_stage_item === true;

  if (body.stage_item_code_abbr !== undefined) allowed.stage_item_code_abbr = txt(body.stage_item_code_abbr);
  if (body.stage_item_name_label !== undefined) allowed.stage_item_name_label = txt(body.stage_item_name_label);
  if (body.default_stage_uom_code !== undefined) allowed.default_stage_uom_code = txt(body.default_stage_uom_code);

  if (body.is_active !== undefined) allowed.is_active = body.is_active === true;

  // type_code is read-only after creation — never updated.

  allowed.updated_by = userId ?? null;
  allowed.updated_at = new Date().toISOString();

  const { error } = await supabase.from(TABLE).update(allowed).eq('id', id);
  if (error) throw { code: 'DB_ERROR', message: error.message };

  return getProcessTypeById(id);
}

// ─── Toggle active ──────────────────────────────────────────────────────────────

export async function toggleProcessTypeActive(id, isActive, userId) {
  const { error } = await supabase
    .from(TABLE)
    .update({ is_active: isActive === true, updated_by: userId ?? null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw { code: 'DB_ERROR', message: error.message };
  return getProcessTypeById(id);
}
