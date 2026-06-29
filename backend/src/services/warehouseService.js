
function sanitizeOrSearch(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\\%_]/g, '\\$&')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CERADRIVE ERP — Warehouse Service
 *
 * All data access for the Warehouse Master module.
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 *
 * Live schema (confirmed from Architecture Audit v2.1):
 *   warehouse_master: id, warehouse_code, warehouse_name, is_active,
 *                     warehouse_type_id, notes,
 *                     created_by, created_at, updated_by, updated_at
 *   warehouse_types:  id, type_code, type_name, is_active
 *
 * Rules:
 *   warehouse_code   — stored uppercase, required, unique
 *   warehouse_name   — required
 *   warehouse_type_id — required FK → warehouse_types.id (active only)
 *   Deactivate guard — blocked if referenced by grn_headers, inventory_balance,
 *                      inventory_ledger, or supplier_master
 */

import { supabase } from '../config/supabase.js';

// ─── Column selects ───────────────────────────────────────────────────────────

const LIST_COLS = `
  id, warehouse_code, warehouse_name, is_active,
  warehouse_type_id, notes, created_at, updated_at,
  warehouse_types ( id, type_code, type_name )
`;

const DETAIL_COLS = `
  id, warehouse_code, warehouse_name, is_active,
  warehouse_type_id, notes,
  created_by, created_at, updated_by, updated_at,
  warehouse_types ( id, type_code, type_name )
`;

// ─── Lookups ──────────────────────────────────────────────────────────────────

/**
 * List active warehouse types — for create/edit dropdowns.
 */
export async function listWarehouseTypes() {
  const { data, error } = await supabase
    .from('warehouse_types')
    .select('id, type_code, type_name, is_active')
    .eq('is_active', true)
    .order('type_name', { ascending: true });

  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * List warehouses with optional search, type, and active filters.
 */
export async function listWarehouses({
  search, is_active, warehouse_type_id, page = 1, limit = 50,
} = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('warehouse_master')
    .select(LIST_COLS, { count: 'exact' })
    .order('warehouse_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `warehouse_code.ilike.%${safeSearch}%,warehouse_name.ilike.%${safeSearch}%`,
    );
  }
  if (is_active !== undefined && is_active !== '') {
    query = query.eq('is_active', is_active === 'true' || is_active === true);
  }
  if (warehouse_type_id) {
    query = query.eq('warehouse_type_id', warehouse_type_id);
  }

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

/**
 * Get single warehouse by ID, with type joined.
 */
export async function getWarehouseById(id) {
  const { data, error } = await supabase
    .from('warehouse_master')
    .select(DETAIL_COLS)
    .eq('id', id)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Warehouse not found.' } };
  return { data, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Create a new warehouse.
 */
export async function createWarehouse({ warehouse_code, warehouse_name, warehouse_type_id, notes }, userId) {
  if (!warehouse_code?.trim())    throw { code: 'VALIDATION_ERROR', message: 'Warehouse code is required.' };
  if (!warehouse_name?.trim())    throw { code: 'VALIDATION_ERROR', message: 'Warehouse name is required.' };
  if (!warehouse_type_id)         throw { code: 'VALIDATION_ERROR', message: 'Warehouse type is required.' };

  const code = warehouse_code.trim().toUpperCase();

  // Duplicate code check
  const { data: existing } = await supabase
    .from('warehouse_master')
    .select('id')
    .eq('warehouse_code', code)
    .maybeSingle();
  if (existing) throw { code: 'CONFLICT', message: `Warehouse code '${code}' already exists.` };

  // Validate warehouse_type_id is active
  const { data: wtype } = await supabase
    .from('warehouse_types')
    .select('id, is_active')
    .eq('id', warehouse_type_id)
    .maybeSingle();
  if (!wtype)          throw { code: 'VALIDATION_ERROR', message: 'Warehouse type not found.' };
  if (!wtype.is_active) throw { code: 'VALIDATION_ERROR', message: 'Selected warehouse type is inactive.' };

  const { data, error } = await supabase
    .from('warehouse_master')
    .insert({
      warehouse_code:    code,
      warehouse_name:    warehouse_name.trim(),
      warehouse_type_id,
      notes:             notes?.trim() || null,
      is_active:         true,
      created_by:        userId,
    })
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Update warehouse name, type, or notes. Code is immutable after creation.
 */
export async function updateWarehouse(id, { warehouse_name, warehouse_type_id, notes }, userId) {
  if (warehouse_name !== undefined && !warehouse_name?.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Warehouse name cannot be blank.' };
  }
  if (warehouse_type_id !== undefined) {
    const { data: wtype } = await supabase
      .from('warehouse_types')
      .select('id, is_active')
      .eq('id', warehouse_type_id)
      .maybeSingle();
    if (!wtype)           throw { code: 'VALIDATION_ERROR', message: 'Warehouse type not found.' };
    if (!wtype.is_active)  throw { code: 'VALIDATION_ERROR', message: 'Selected warehouse type is inactive.' };
  }

  const updates = { updated_by: userId, updated_at: new Date().toISOString() };
  if (warehouse_name    !== undefined) updates.warehouse_name    = warehouse_name.trim();
  if (warehouse_type_id !== undefined) updates.warehouse_type_id = warehouse_type_id;
  if (notes             !== undefined) updates.notes             = notes?.trim() || null;

  const { data, error } = await supabase
    .from('warehouse_master')
    .update(updates)
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Warehouse not found.' } };
  return { data, error: null };
}

/**
 * Toggle warehouse active / inactive.
 * Deactivate blocked if warehouse is referenced by grn_headers, inventory_balance,
 * inventory_ledger, or supplier_master.default_warehouse_id.
 */
export async function toggleWarehouseActive(id, userId) {
  const { data: wh, error: fetchErr } = await getWarehouseById(id);
  if (fetchErr || !wh) throw { code: 'NOT_FOUND', message: 'Warehouse not found.' };

  if (wh.is_active) {
    const [grn, invBal, invLed, supplier] = await Promise.all([
      supabase.from('grn_headers')      .select('id', { count: 'exact', head: true }).eq('warehouse_id',          id),
      supabase.from('inventory_balance') .select('id', { count: 'exact', head: true }).eq('warehouse_id',          id),
      supabase.from('inventory_ledger')  .select('id', { count: 'exact', head: true }).eq('warehouse_id',          id),
      supabase.from('supplier_master')   .select('id', { count: 'exact', head: true }).eq('default_warehouse_id',  id),
    ]);

    const blocking = [];
    if ((grn.count      ?? 0) > 0) blocking.push(`${grn.count} GRN(s)`);
    if ((invBal.count   ?? 0) > 0) blocking.push(`inventory balance records`);
    if ((invLed.count   ?? 0) > 0) blocking.push(`inventory ledger entries`);
    if ((supplier.count ?? 0) > 0) blocking.push(`${supplier.count} supplier default(s)`);

    if (blocking.length > 0) {
      throw {
        code: 'CONFLICT',
        message: `Cannot deactivate — '${wh.warehouse_code}' is in use by: ${blocking.join(', ')}.`,
      };
    }
  }

  const { data, error } = await supabase
    .from('warehouse_master')
    .update({ is_active: !wh.is_active, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}
