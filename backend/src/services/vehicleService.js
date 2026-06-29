/**
 * CERADRIVE ERP — Vehicle Master Service (10G).
 * Returns { data, error }; throws { code, message } on business rules.
 * Case-insensitive uniqueness on vehicle_name (DB index + pre-check).
 */
import { supabase } from '../config/supabase.js';

const COLS = 'id, vehicle_name, make, is_active, created_at, updated_at';

export async function searchVehicles({ search, limit = 20 } = {}) {
  let q = supabase.from('vehicle_master').select('id, vehicle_name, make, is_active')
    .order('vehicle_name', { ascending: true }).limit(Math.min(Number(limit) || 20, 50));
  if (search) q = q.ilike('vehicle_name', `%${search}%`);
  const { data, error } = await q;
  return error ? { data: null, error } : { data: data ?? [], error: null };
}

export async function listVehicles({ is_active, search, page = 1, limit = 20 } = {}) {
  const safe = Math.min(Number(limit) || 20, 100);
  const off  = (Math.max(Number(page) || 1, 1) - 1) * safe;
  let q = supabase.from('vehicle_master').select(COLS, { count: 'exact' })
    .order('vehicle_name', { ascending: true }).range(off, off + safe - 1);
  if (is_active !== undefined && is_active !== null) q = q.eq('is_active', is_active === 'true' || is_active === true);
  if (search) q = q.ilike('vehicle_name', `%${search}%`);
  const { data, error, count } = await q;
  return error ? { data: null, count: null, error } : { data: data ?? [], count, error: null };
}

export async function getVehicleById(id) {
  const { data, error } = await supabase.from('vehicle_master').select(COLS).eq('id', id).single();
  if (error || !data) return { data: null, error: error ?? { message: 'Vehicle not found.' } };
  return { data, error: null };
}

async function assertUniqueName(name, excludeId) {
  let q = supabase.from('vehicle_master').select('id').ilike('vehicle_name', name.trim());
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  if (data && data.length) throw { code: 'CONFLICT', message: `Vehicle '${name.trim()}' already exists.` };
}

export async function createVehicle(body, userId) {
  await assertUniqueName(body.vehicle_name, null);
  const { data, error } = await supabase.from('vehicle_master')
    .insert({ vehicle_name: body.vehicle_name.trim(), make: body.make ?? null,
      is_active: body.is_active ?? true, created_by: userId })
    .select(COLS).single();
  return { data: data ?? null, error: error ?? null };
}

export async function updateVehicle(id, body, userId) {
  if (body.vehicle_name) await assertUniqueName(body.vehicle_name, id);
  const patch = { updated_by: userId, updated_at: new Date().toISOString() };
  if (body.vehicle_name !== undefined) patch.vehicle_name = body.vehicle_name.trim();
  if (body.make         !== undefined) patch.make         = body.make ?? null;
  if (body.is_active    !== undefined) patch.is_active    = body.is_active;
  const { data, error } = await supabase.from('vehicle_master').update(patch).eq('id', id).select(COLS).single();
  return { data: data ?? null, error: error ?? null };
}
