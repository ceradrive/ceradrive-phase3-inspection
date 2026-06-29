/**
 * CERADRIVE ERP — Item Category Service
 *
 * Flat-master CRUD over item_categories. Mirrors the UOM/Customer/Item service
 * conventions: returns { data, error }; throws { code, message } for rule violations.
 *
 * Live schema (confirmed):
 *   id uuid PK default uuid_generate_v4()
 *   category_code varchar NOT NULL UNIQUE     (manual, uppercased; duplicate -> CONFLICT/409)
 *   category_name varchar NOT NULL
 *   description text nullable
 *   is_active boolean NOT NULL default true
 *   created_by uuid nullable FK public.users(id) ON DELETE SET NULL
 *   created_at timestamptz NOT NULL default now()
 *   updated_by uuid nullable FK public.users(id) ON DELETE SET NULL
 *   updated_at timestamptz nullable
 *
 * Scope: list, search, get, create, edit, toggle-active. NO delete, NO import/export,
 * NO hierarchy (no parent_category_id in Phase 1).
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


const SELECT_COLS = 'id, category_code, category_name, description, is_active, created_at, updated_at';

// ─── Validation helpers ──────────────────────────────────────────────────────

function normaliseCode(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).trim().toUpperCase();
}

async function assertCodeUnique(code, excludeId = null) {
  let query = supabase.from('item_categories').select('id').eq('category_code', code);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw { code: 'INTERNAL_ERROR', message: 'Failed to validate category code uniqueness.' };
  if (data) throw { code: 'CONFLICT', message: `Category code "${code}" already exists.` };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function searchItemCategories({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase
    .from('item_categories')
    .select('id, category_code, category_name')
    .eq('is_active', true)
    .order('category_name', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`category_name.ilike.%${safeSearch}%,category_code.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listItemCategories({ search, is_active, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('item_categories')
    .select(SELECT_COLS, { count: 'exact' })
    .order('category_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`category_name.ilike.%${safeSearch}%,category_code.ilike.%${safeSearch}%`);
  }
  if (is_active === true  || is_active === 'true')  query = query.eq('is_active', true);
  if (is_active === false || is_active === 'false') query = query.eq('is_active', false);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getItemCategoryById(id) {
  const { data, error } = await supabase
    .from('item_categories')
    .select(SELECT_COLS)
    .eq('id', id)
    .single();
  if (error || !data) return { data: null, error: error ?? { code: 'NOT_FOUND', message: 'Item category not found.' } };
  return { data, error: null };
}

// ─── Write ──────────────────────────────────────────────────────────────────

export async function createItemCategory(body, userId) {
  const category_code = normaliseCode(body.category_code);
  const category_name = (body.category_name ?? '').trim();

  if (!category_code) throw { code: 'VALIDATION_ERROR', message: 'Category code is required.' };
  if (!category_name) throw { code: 'VALIDATION_ERROR', message: 'Category name is required.' };

  await assertCodeUnique(category_code);

  const row = {
    category_code,
    category_name,
    description: (body.description ?? '').trim() || null,
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    created_by: userId,
  };

  const { data: created, error } = await supabase
    .from('item_categories')
    .insert(row)
    .select('id')
    .single();
  if (error) return { data: null, error };

  return getItemCategoryById(created.id);
}

export async function updateItemCategory(id, body, userId) {
  const { data: current, error: curErr } = await supabase
    .from('item_categories')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'Item category not found.' } };

  // category_code is read-only after creation — not editable here.
  const allowed = {};
  if (body.category_name !== undefined) {
    const category_name = (body.category_name ?? '').trim();
    if (!category_name) throw { code: 'VALIDATION_ERROR', message: 'Category name is required.' };
    allowed.category_name = category_name;
  }
  if (body.description !== undefined) {
    allowed.description = (body.description ?? '').trim() || null;
  }
  if (body.is_active !== undefined) {
    allowed.is_active = Boolean(body.is_active);
  }

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = new Date().toISOString();
    const { error } = await supabase.from('item_categories').update(allowed).eq('id', id);
    if (error) return { data: null, error };
  }

  return getItemCategoryById(id);
}

export async function toggleItemCategoryActive(id, is_active, userId) {
  const { data: current, error: curErr } = await supabase
    .from('item_categories')
    .select('id')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { code: 'NOT_FOUND', message: 'Item category not found.' } };

  const { error } = await supabase
    .from('item_categories')
    .update({ is_active: Boolean(is_active), updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { data: null, error };

  return getItemCategoryById(id);
}
