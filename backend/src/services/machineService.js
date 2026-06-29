/**
 * CERADRIVE ERP — Machine Service
 *
 * All data access for the Machine Master module.
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 * Mirrors customerService.js conventions exactly.
 *
 * Live schema (confirmed):
 *   machine_master: id, machine_code, machine_name, machine_type_id, status, is_active,
 *     is_bottleneck, warehouse_id, serial_number, manufacturer, model_number, purchase_date,
 *     notes, maintenance_frequency_days, last_maintenance_date, next_maintenance_date,
 *     machine_image_url, machine_manual_url, capacity_basis, rated_capacity, planning_capacity,
 *     capacity_uom, cycle_time_sec, setup_time_min, changeover_time_min, pcs_per_cycle,
 *     pcs_per_hour, tray_capacity, batch_capacity_kg, capacity_tolerance_percent, slots_count, created_by, created_at,
 *     updated_by, updated_at
 *   FKs: machine_type_id -> machine_types.id (NOT NULL), warehouse_id -> warehouse_master.id (nullable)
 *   status domain: active | under_maintenance | retired
 *   maintenance_frequency_days: must be > 0 if entered
 *
 * Governance: mandatory at create = machine_code, machine_name, machine_type_id.
 * machine_code: stored uppercase, unique (duplicate validation), immutable after creation.
 * machine_image_url / machine_manual_url: plain text URLs only — no upload implementation.
 * warehouse_id: API-supported pass-through only; no UI picker, no warehouse_master query.
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


// ─── Status domain ────────────────────────────────────────────────────────────
const STATUS_VALUES = ['active', 'under_maintenance', 'retired'];

const CAPACITY_BASIS_VALUES = [
  'WEIGHT_BATCH',
  'PCS_TRAY',
  'DIE_CAVITY',
  'PCS_CYCLE',
  'PCS_PER_HOUR',
  'PCS_PER_MIN',
  'PCS_CRATE',
  'TRAY_BATCH',
  'MANUAL',
];

const NUMERIC_PLANNING_FIELDS = [
  'rated_capacity',
  'planning_capacity',
  'cycle_time_sec',
  'setup_time_min',
  'changeover_time_min',
  'pcs_per_cycle',
  'pcs_per_hour',
  'tray_capacity',
  'batch_capacity_kg',
  'capacity_tolerance_percent',
];

function validateCapacityBasis(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!CAPACITY_BASIS_VALUES.includes(v)) {
    return `Invalid capacity basis. Allowed: ${CAPACITY_BASIS_VALUES.join(', ')}.`;
  }
  return null;
}

function validateNonNegativeNumber(field, label, v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return `${label} must be a non-negative number.`;
  return null;
}

function validatePlanningFields(body) {
  const basisErr = validateCapacityBasis(body.capacity_basis);
  if (basisErr) return basisErr;

  const labels = {
    rated_capacity: 'Rated capacity',
    planning_capacity: 'Planning capacity',
    cycle_time_sec: 'Cycle time (seconds)',
    setup_time_min: 'Setup time (minutes)',
    changeover_time_min: 'Changeover time (minutes)',
    pcs_per_cycle: 'Pieces per cycle',
    pcs_per_hour: 'Pieces per hour',
    tray_capacity: 'Tray capacity',
    batch_capacity_kg: 'Batch capacity (kg)',
    capacity_tolerance_percent: 'Capacity tolerance (%)',
  };

  for (const field of NUMERIC_PLANNING_FIELDS) {
    const err = validateNonNegativeNumber(field, labels[field], body[field]);
    if (err) return err;
  }

  if (body.slots_count !== undefined && body.slots_count !== null && body.slots_count !== '') {
    const n = Number(body.slots_count);
    if (!Number.isInteger(n) || n < 0) return 'Slots count must be a whole number 0 or higher.';
  }

  return null;
}

function validateStatus(s) {
  if (s === undefined || s === null || s === '') return null; // optional input; defaults applied on create
  if (!STATUS_VALUES.includes(s)) {
    return `Invalid status. Allowed: ${STATUS_VALUES.join(', ')}.`;
  }
  return null;
}

// ─── Maintenance frequency validation (> 0 if entered) ────────────────────────
function validateMaintenanceFreq(v) {
  if (v === undefined || v === null || v === '') return null; // optional
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    return 'Maintenance frequency (days) must be a whole number greater than 0.';
  }
  return null;
}

// ─── Machine type FK validation (confirmed machine_types table) ───────────────
async function assertMachineTypeValid(machine_type_id) {
  const { data, error } = await supabase
    .from('machine_types')
    .select('id, is_active')
    .eq('id', machine_type_id)
    .maybeSingle();
  if (error || !data) throw { code: 'VALIDATION_ERROR', message: 'Selected machine type does not exist.' };
  if (!data.is_active) throw { code: 'VALIDATION_ERROR', message: 'Selected machine type is inactive.' };
}

// ─── Column selects ───────────────────────────────────────────────────────────

const LIST_COLS = `
  id, machine_code, machine_name, machine_type_id, status, is_active, is_bottleneck,
  capacity_basis, rated_capacity, planning_capacity, capacity_uom, cycle_time_sec,
  setup_time_min, changeover_time_min, pcs_per_cycle, pcs_per_hour,
  tray_capacity, batch_capacity_kg, capacity_tolerance_percent, slots_count,
  created_at, updated_at,
  machine_type:machine_types(type_name)
`;

const DETAIL_COLS = `
  id, machine_code, machine_name, machine_type_id, status, is_active, is_bottleneck,
  warehouse_id, serial_number, manufacturer, model_number,
  purchase_date, maintenance_frequency_days, last_maintenance_date, next_maintenance_date,
  machine_image_url, machine_manual_url, notes,
  capacity_basis, rated_capacity, planning_capacity, capacity_uom, cycle_time_sec,
  setup_time_min, changeover_time_min, pcs_per_cycle, pcs_per_hour,
  tray_capacity, batch_capacity_kg, capacity_tolerance_percent, slots_count,
  created_by, created_at, updated_by, updated_at,
  machine_type:machine_types(id, type_code, type_name)
`;

// ─── Machine types (mandatory picker source) ──────────────────────────────────

export async function listMachineTypes() {
  const { data, error } = await supabase
    .from('machine_types')
    .select('id, type_code, type_name, is_bottleneck_type')
    .eq('is_active', true)
    .order('type_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Live search (used by master-backed machine dropdowns) ────────────────────

export async function searchMachines({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);

  let query = supabase
    .from('machine_master')
    .select('id, machine_code, machine_name')
    .eq('is_active', true)
    .order('machine_name', { ascending: true })
    .limit(safeLimit);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `machine_name.ilike.%${safeSearch}%,machine_code.ilike.%${safeSearch}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listMachines({ search, is_active, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('machine_master')
    .select(LIST_COLS, { count: 'exact' })
    .order('machine_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `machine_name.ilike.%${safeSearch}%,machine_code.ilike.%${safeSearch}%`,
    );
  }
  if (is_active !== undefined && is_active !== '') {
    query = query.eq('is_active', is_active === 'true' || is_active === true);
  }

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getMachineById(id) {
  const { data, error } = await supabase
    .from('machine_master')
    .select(DETAIL_COLS)
    .eq('id', id)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Machine not found.' } };
  return { data, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function createMachine(body, userId) {
  const { machine_code, machine_name, machine_type_id } = body;

  if (!machine_code?.trim())   throw { code: 'VALIDATION_ERROR', message: 'Machine code is required.' };
  if (!machine_name?.trim())   throw { code: 'VALIDATION_ERROR', message: 'Machine name is required.' };
  if (!machine_type_id)        throw { code: 'VALIDATION_ERROR', message: 'Machine type is required.' };

  const statusErr = validateStatus(body.status);
  if (statusErr) throw { code: 'VALIDATION_ERROR', message: statusErr };

  const freqErr = validateMaintenanceFreq(body.maintenance_frequency_days);
  if (freqErr) throw { code: 'VALIDATION_ERROR', message: freqErr };

  const planningErr = validatePlanningFields(body);
  if (planningErr) throw { code: 'VALIDATION_ERROR', message: planningErr };

  await assertMachineTypeValid(machine_type_id);

  const code = machine_code.trim().toUpperCase();

  // Duplicate code check
  const { data: existing } = await supabase
    .from('machine_master')
    .select('id')
    .eq('machine_code', code)
    .maybeSingle();
  if (existing) throw { code: 'CONFLICT', message: `Machine code '${code}' already exists.` };

  const { data, error } = await supabase
    .from('machine_master')
    .insert(buildRow(body, userId, true, code))
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

export async function updateMachine(id, body, userId) {
  if (body.machine_name !== undefined && !body.machine_name?.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Machine name cannot be blank.' };
  }

  const statusErr = validateStatus(body.status);
  if (statusErr) throw { code: 'VALIDATION_ERROR', message: statusErr };

  const freqErr = validateMaintenanceFreq(body.maintenance_frequency_days);
  if (freqErr) throw { code: 'VALIDATION_ERROR', message: freqErr };

  // machine_type_id is NOT NULL; if provided, validate it. (Cannot be cleared.)
  if (body.machine_type_id) await assertMachineTypeValid(body.machine_type_id);

  const { data, error } = await supabase
    .from('machine_master')
    .update(buildPatchRow(body, userId))
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Machine not found.' } };
  return { data, error: null };
}

export async function toggleMachineActive(id, userId) {
  const { data: mc, error: fetchErr } = await getMachineById(id);
  if (fetchErr || !mc) throw { code: 'NOT_FOUND', message: 'Machine not found.' };

  // NOTE: No referential deactivate guard. No machine-referencing transactional table is
  // confirmed in the current schema, so none is queried (querying an unconfirmed table would
  // break). A guard should be added when a machine-consuming module (routing/SKU/production) exists.
  // is_active (boolean) is independent of status (active/under_maintenance/retired).

  const { data, error } = await supabase
    .from('machine_master')
    .update({ is_active: !mc.is_active, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

// ─── Internal: build row ──────────────────────────────────────────────────────


function nullableString(v) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  return s || null;
}

function nullableNumber(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return Number(v);
}

function nullableInteger(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return Number(v);
}

function setIfProvided(row, field, value) {
  if (value !== undefined) row[field] = value;
}

function buildPatchRow(body, userId) {
  const row = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  setIfProvided(row, 'machine_name', nullableString(body.machine_name));
  setIfProvided(row, 'serial_number', nullableString(body.serial_number));
  setIfProvided(row, 'manufacturer', nullableString(body.manufacturer));
  setIfProvided(row, 'model_number', nullableString(body.model_number));
  setIfProvided(row, 'purchase_date', nullableString(body.purchase_date));
  setIfProvided(row, 'notes', nullableString(body.notes));
  setIfProvided(row, 'maintenance_frequency_days', nullableInteger(body.maintenance_frequency_days));
  setIfProvided(row, 'last_maintenance_date', nullableString(body.last_maintenance_date));
  setIfProvided(row, 'next_maintenance_date', nullableString(body.next_maintenance_date));
  setIfProvided(row, 'machine_image_url', nullableString(body.machine_image_url));
  setIfProvided(row, 'machine_manual_url', nullableString(body.machine_manual_url));

  setIfProvided(row, 'capacity_basis', nullableString(body.capacity_basis));
  setIfProvided(row, 'rated_capacity', nullableNumber(body.rated_capacity));
  setIfProvided(row, 'planning_capacity', nullableNumber(body.planning_capacity));
  setIfProvided(row, 'capacity_uom', nullableString(body.capacity_uom));
  setIfProvided(row, 'cycle_time_sec', nullableNumber(body.cycle_time_sec));
  setIfProvided(row, 'setup_time_min', nullableNumber(body.setup_time_min));
  setIfProvided(row, 'changeover_time_min', nullableNumber(body.changeover_time_min));
  setIfProvided(row, 'pcs_per_cycle', nullableNumber(body.pcs_per_cycle));
  setIfProvided(row, 'pcs_per_hour', nullableNumber(body.pcs_per_hour));
  setIfProvided(row, 'tray_capacity', nullableNumber(body.tray_capacity));
  setIfProvided(row, 'batch_capacity_kg', nullableNumber(body.batch_capacity_kg));
  setIfProvided(row, 'capacity_tolerance_percent', nullableNumber(body.capacity_tolerance_percent));
  setIfProvided(row, 'slots_count', nullableInteger(body.slots_count));

  if (body.status !== undefined && body.status !== '') row.status = body.status;
  if (body.is_active !== undefined) row.is_active = Boolean(body.is_active);
  if (body.is_bottleneck !== undefined) row.is_bottleneck = Boolean(body.is_bottleneck);
  if (body.machine_type_id) row.machine_type_id = body.machine_type_id;
  if (Object.prototype.hasOwnProperty.call(body, 'warehouse_id')) row.warehouse_id = body.warehouse_id || null;

  return row;
}


function buildRow(body, userId, isCreate, normalisedCode) {
  const now = new Date().toISOString();
  const row = {
    machine_name:               (body.machine_name ?? '').trim(),
    serial_number:              body.serial_number  || null,
    manufacturer:               body.manufacturer   || null,
    model_number:               body.model_number   || null,
    purchase_date:              body.purchase_date  || null,
    notes:                      body.notes          || null,
    maintenance_frequency_days: body.maintenance_frequency_days != null && body.maintenance_frequency_days !== ''
                                  ? Number(body.maintenance_frequency_days) : null,
    last_maintenance_date:      body.last_maintenance_date || null,
    next_maintenance_date:      body.next_maintenance_date || null,
    machine_image_url:          body.machine_image_url  || null,
    machine_manual_url:         body.machine_manual_url || null,
    updated_by:                 userId,
    updated_at:                 now,
  };

  // Capacity planning fields. These are optional, planner-facing machine attributes.
  setIfProvided(row, 'capacity_basis',       nullableString(body.capacity_basis));
  setIfProvided(row, 'rated_capacity',       nullableNumber(body.rated_capacity));
  setIfProvided(row, 'planning_capacity',    nullableNumber(body.planning_capacity));
  setIfProvided(row, 'capacity_uom',         nullableString(body.capacity_uom));
  setIfProvided(row, 'cycle_time_sec',       nullableNumber(body.cycle_time_sec));
  setIfProvided(row, 'setup_time_min',       nullableNumber(body.setup_time_min));
  setIfProvided(row, 'changeover_time_min',  nullableNumber(body.changeover_time_min));
  setIfProvided(row, 'pcs_per_cycle',        nullableNumber(body.pcs_per_cycle));
  setIfProvided(row, 'pcs_per_hour',         nullableNumber(body.pcs_per_hour));
  setIfProvided(row, 'tray_capacity',        nullableNumber(body.tray_capacity));
  setIfProvided(row, 'batch_capacity_kg',    nullableNumber(body.batch_capacity_kg));
  setIfProvided(row, 'capacity_tolerance_percent', nullableNumber(body.capacity_tolerance_percent));
  setIfProvided(row, 'slots_count',          nullableInteger(body.slots_count));

  // State fields guarded to avoid clobber on update (deviation from Customer's set-all pattern,
  // for correctness): default only on create; on update set only when explicitly provided.
  if (isCreate) {
    row.status        = body.status || 'active';
    row.is_active     = body.is_active     !== undefined ? Boolean(body.is_active)     : true;
    row.is_bottleneck = body.is_bottleneck !== undefined ? Boolean(body.is_bottleneck) : false;
    row.created_by    = userId;
  } else {
    if (body.status        !== undefined && body.status !== '') row.status        = body.status;
    if (body.is_active     !== undefined) row.is_active     = Boolean(body.is_active);
    if (body.is_bottleneck !== undefined) row.is_bottleneck = Boolean(body.is_bottleneck);
  }

  if (normalisedCode)       row.machine_code    = normalisedCode;
  if (body.machine_type_id) row.machine_type_id = body.machine_type_id;
  if (body.warehouse_id)    row.warehouse_id    = body.warehouse_id; // API-supported; no UI picker

  return row;
}
