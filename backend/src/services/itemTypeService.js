/**
 * CERADRIVE ERP — Item Type Service
 *
 * Flat-master CRUD over item_types. Mirrors the UOM / Item Category service
 * conventions: returns { data, error }; throws { code, message } for rule violations.
 *
 * Live schema (confirmed):
 *   id uuid PK default uuid_generate_v4()
 *   type_code varchar NOT NULL UNIQUE       (manual, uppercased; duplicate -> CONFLICT/409)
 *   type_name varchar NOT NULL
 *   description text nullable
 *   is_purchasable  boolean default false
 *   is_sellable     boolean default false
 *   is_manufactured boolean default false
 *   is_stocked      boolean default false
 *   is_batch_tracked boolean default false
 *   is_service      boolean default false
 *   is_active       boolean default true
 *   created_by/updated_by uuid nullable FK public.users(id) ON DELETE SET NULL
 *   created_at timestamptz default now(); updated_at timestamptz nullable
 *
 * The six business flags are ALWAYS written as explicit booleans (never relying on
 * column defaults), so inserts are correct whether the columns are NOT NULL or nullable.
 *
 * Scope: list, search, get, create, edit, toggle-active. NO delete, NO import/export.
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


const FLAGS = [
  'is_purchasable', 'is_sellable', 'is_manufactured',
  'is_stocked', 'is_batch_tracked', 'is_service',
];

const SELECT_COLS =
  'id, type_code, type_name, description, ' +
  FLAGS.join(', ') +
  ', is_active, created_at, updated_at';

// ─── Validation helpers ──────────────────────────────────────────────────────

function normaliseCode(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).trim().toUpperCase();
}

async function assertCodeUnique(code, excludeId = null) {
  let query = supabase.from('item_types').select('id').eq('type_code', code);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw { code: 'INTERNAL_ERROR', message: 'Failed to validate item type code uniqueness.' };
  if (data) throw { code: 'CONFLICT', message: `Item type code "${code}" already exists.` };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function searchItemTypes({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase
    .from('item_types')
    .select('id, type_code, type_name')
    .eq('is_active', true)
    .order('type_name', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`type_name.ilike.%${safeSearch}%,type_code.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listItemTypes({ search, is_active, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('item_types')
    .select(SELECT_COLS, { count: 'exact' })
    .order('type_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`type_name.ilike.%${safeSearch}%,type_code.ilike.%${safeSearch}%`);
  }
  if (is_active === true  || is_active === 'true')  query = query.eq('is_active', true);
  if (is_active === false || is_active === 'false') query = query.eq('is_active', false);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getItemTypeById(id) {
  const { data, error } = await supabase
    .from('item_types')
    .select(SELECT_COLS)
    .eq('id', id)
    .single();
  if (error || !data) return { data: null, error: error ?? { code: 'NOT_FOUND', message: 'Item type not found.' } };
  return { data, error: null };
}

// ─── Write ──────────────────────────────────────────────────────────────────

export async function createItemType(body, userId) {
  const type_code = normaliseCode(body.type_code);
  const type_name = (body.type_name ?? '').trim();

  if (!type_code) throw { code: 'VALIDATION_ERROR', message: 'Item type code is required.' };
  if (!type_name) throw { code: 'VALIDATION_ERROR', message: 'Item type name is required.' };

  await assertCodeUnique(type_code);

  const row = {
    type_code,
    type_name,
    description: (body.description ?? '').trim() || null,
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    created_by: userId,
  };
  for (const flag of FLAGS) {
    row[flag] = body[flag] !== undefined ? Boolean(body[flag]) : false; // explicit boolean, never null
  }

  const { data: created, error } = await supabase
    .from('item_types')
    .insert(row)
    .select('id')
    .single();
  if (error) return { data: null, error };

  return getItemTypeById(created.id);
}

export async function updateItemType(id, body, userId) {
  const { data: current, error: curErr } = await supabase
    .from('item_types')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'Item type not found.' } };

  // type_code is read-only after creation — not editable here.
  const allowed = {};
  if (body.type_name !== undefined) {
    const type_name = (body.type_name ?? '').trim();
    if (!type_name) throw { code: 'VALIDATION_ERROR', message: 'Item type name is required.' };
    allowed.type_name = type_name;
  }
  if (body.description !== undefined) {
    allowed.description = (body.description ?? '').trim() || null;
  }
  for (const flag of FLAGS) {
    if (body[flag] !== undefined) allowed[flag] = Boolean(body[flag]);
  }
  if (body.is_active !== undefined) {
    allowed.is_active = Boolean(body.is_active);
  }

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = new Date().toISOString();
    const { error } = await supabase.from('item_types').update(allowed).eq('id', id);
    if (error) return { data: null, error };
  }

  return getItemTypeById(id);
}

export async function toggleItemTypeActive(id, is_active, userId) {
  const { data: current, error: curErr } = await supabase
    .from('item_types')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'Item type not found.' } };

  const { error } = await supabase
    .from('item_types')
    .update({ is_active: Boolean(is_active), updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { data: null, error };

  return getItemTypeById(id);
}
