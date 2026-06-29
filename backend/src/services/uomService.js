/**
 * CERADRIVE ERP — UOM Service
 *
 * Flat-master CRUD over uom_master. Mirrors the Customer/Item service conventions:
 *   returns { data, error }; throws { code, message } for business-rule violations.
 *
 * Live schema (confirmed):
 *   id uuid PK default uuid_generate_v4()
 *   uom_code varchar NOT NULL UNIQUE          (manual, uppercased; duplicate -> CONFLICT/409)
 *   uom_name varchar NOT NULL
 *   decimal_places integer NOT NULL default 2 CHECK (decimal_places >= 0)
 *   is_active boolean NOT NULL default true
 *   created_by uuid nullable FK public.users(id) ON DELETE SET NULL
 *   created_at timestamptz NOT NULL default now()
 *   updated_by uuid nullable FK public.users(id) ON DELETE SET NULL
 *   updated_at timestamptz nullable
 *
 * Scope: list, search, get, create, edit, toggle-active. NO delete, NO import/export,
 * NO conversion fields (uom_conversions is a separate future phase).
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


const SELECT_COLS = 'id, uom_code, uom_name, decimal_places, is_active, created_at, updated_at';

// ─── Validation helpers ──────────────────────────────────────────────────────

function normaliseCode(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).trim().toUpperCase();
}

function validateDecimalPlaces(raw) {
  // required integer >= 0
  if (raw === undefined || raw === null || raw === '') {
    throw { code: 'VALIDATION_ERROR', message: 'Decimal places is required.' };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Decimal places must be an integer of 0 or greater.' };
  }
  return n;
}

async function assertCodeUnique(code, excludeId = null) {
  let query = supabase.from('uom_master').select('id').eq('uom_code', code);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw { code: 'INTERNAL_ERROR', message: 'Failed to validate UOM code uniqueness.' };
  if (data) throw { code: 'CONFLICT', message: `UOM code "${code}" already exists.` };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function searchUoms({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase
    .from('uom_master')
    .select('id, uom_code, uom_name, decimal_places')
    .eq('is_active', true)
    .order('uom_name', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`uom_name.ilike.%${safeSearch}%,uom_code.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listUoms({ search, is_active, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('uom_master')
    .select(SELECT_COLS, { count: 'exact' })
    .order('uom_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`uom_name.ilike.%${safeSearch}%,uom_code.ilike.%${safeSearch}%`);
  }
  if (is_active === true  || is_active === 'true')  query = query.eq('is_active', true);
  if (is_active === false || is_active === 'false') query = query.eq('is_active', false);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getUomById(id) {
  const { data, error } = await supabase
    .from('uom_master')
    .select(SELECT_COLS)
    .eq('id', id)
    .single();
  if (error || !data) return { data: null, error: error ?? { code: 'NOT_FOUND', message: 'UOM not found.' } };
  return { data, error: null };
}

// ─── Write ──────────────────────────────────────────────────────────────────

export async function createUom(body, userId) {
  const uom_code = normaliseCode(body.uom_code);
  const uom_name = (body.uom_name ?? '').trim();

  if (!uom_code) throw { code: 'VALIDATION_ERROR', message: 'UOM code is required.' };
  if (!uom_name) throw { code: 'VALIDATION_ERROR', message: 'UOM name is required.' };
  const decimal_places = validateDecimalPlaces(body.decimal_places);

  await assertCodeUnique(uom_code);

  const row = {
    uom_code,
    uom_name,
    decimal_places,
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    created_by: userId,
  };

  const { data: created, error } = await supabase
    .from('uom_master')
    .insert(row)
    .select('id')
    .single();
  if (error) return { data: null, error };

  return getUomById(created.id);
}

export async function updateUom(id, body, userId) {
  const { data: current, error: curErr } = await supabase
    .from('uom_master')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'UOM not found.' } };

  // uom_code is read-only after creation — not editable here.
  const allowed = {};
  if (body.uom_name !== undefined) {
    const uom_name = (body.uom_name ?? '').trim();
    if (!uom_name) throw { code: 'VALIDATION_ERROR', message: 'UOM name is required.' };
    allowed.uom_name = uom_name;
  }
  if (body.decimal_places !== undefined) {
    allowed.decimal_places = validateDecimalPlaces(body.decimal_places);
  }
  if (body.is_active !== undefined) {
    allowed.is_active = Boolean(body.is_active);
  }

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = new Date().toISOString();
    const { error } = await supabase.from('uom_master').update(allowed).eq('id', id);
    if (error) return { data: null, error };
  }

  return getUomById(id);
}

export async function toggleUomActive(id, is_active, userId) {
  const { data: current, error: curErr } = await supabase
    .from('uom_master')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'UOM not found.' } };

  const { error } = await supabase
    .from('uom_master')
    .update({ is_active: Boolean(is_active), updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { data: null, error };

  return getUomById(id);
}

export async function listUomConversions() {
  const { data, error } = await supabase
    .from('uom_conversions')
    .select(`
      id, from_uom_id, to_uom_id, conversion_factor, item_id, is_active,
      from_uom:uom_master!uom_conversions_from_uom_id_fkey(id, uom_code, uom_name),
      to_uom:uom_master!uom_conversions_to_uom_id_fkey(id, uom_code, uom_name)
    `)
    .eq('is_active', true);

  return { data: data ?? [], error };
}
