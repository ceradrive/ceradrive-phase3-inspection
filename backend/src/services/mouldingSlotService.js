import { supabase } from '../config/supabase.js';

function clean(v) { return typeof v === 'string' ? v.trim() : v; }
function nullable(v) { return v === undefined || v === null || v === '' ? null : v; }
function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw { code: 'VALIDATION_ERROR', message: 'Numeric field is invalid.' };
  return n;
}

const SELECT = `
  id, setup_code, machine_id, slot_a_die_id, slot_b_die_id,
  cycle_time_sec, setup_time_min, heating_time_min, is_active, notes, created_at, updated_at,
  machine:machine_master!moulding_slot_setups_machine_id_fkey(id, machine_code, machine_name, cycle_time_sec, setup_time_min, slots_count),
  slot_a_die:die_master!moulding_slot_setups_slot_a_die_id_fkey(id, die_code, die_name, num_impressions),
  slot_b_die:die_master!moulding_slot_setups_slot_b_die_id_fkey(id, die_code, die_name, num_impressions)
`;

function payload(body, userId, isCreate) {
  if (!body.machine_id) throw { code: 'VALIDATION_ERROR', message: 'Machine is required.' };
  if (!body.slot_a_die_id && !body.slot_b_die_id) throw { code: 'VALIDATION_ERROR', message: 'Select at least one die slot.' };

  return {
    setup_code: clean(body.setup_code || '').toUpperCase(),
    machine_id: body.machine_id,
    slot_a_die_id: nullable(body.slot_a_die_id),
    slot_b_die_id: nullable(body.slot_b_die_id),
    cycle_time_sec: num(body.cycle_time_sec),
    setup_time_min: num(body.setup_time_min),
    heating_time_min: num(body.heating_time_min),
    is_active: body.is_active !== false,
    notes: nullable(clean(body.notes || '')),
    ...(isCreate ? {} : { updated_at: new Date().toISOString() }),
  };
}

export async function listSetups({ page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const from = (Number(page) - 1) * safeLimit;
  const to = from + safeLimit - 1;

  const { data, error, count } = await supabase
    .from('moulding_slot_setups')
    .select(SELECT, { count: 'exact' })
    .order('setup_code', { ascending: true })
    .range(from, to);

  return { data: data ?? null, count, error };
}

export async function getSetupById(id) {
  const { data, error } = await supabase
    .from('moulding_slot_setups')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();

  return { data: data ?? null, error };
}

export async function createSetup(body, userId) {
  try {
    const p = payload(body, userId, true);
    if (!p.setup_code) throw { code: 'VALIDATION_ERROR', message: 'Setup code is required.' };

    const { data, error } = await supabase
      .from('moulding_slot_setups')
      .insert(p)
      .select(SELECT)
      .single();

    // SETUP_ACTIVATION_RULE: activating one setup deactivates other active setups on same machine
    if (!error && data && p.is_active) {
      await supabase
        .from('moulding_slot_setups')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('machine_id', p.machine_id)
        .eq('is_active', true)
        .neq('id', data.id);
    }

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

export async function updateSetup(id, body, userId) {
  try {
    const { data: existing, error: existingErr } = await supabase
      .from('moulding_slot_setups')
      .select('id, machine_id, slot_a_die_id, slot_b_die_id')
      .eq('id', id)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (!existing) throw { code: 'NOT_FOUND', message: 'Setup not found.' };

    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const p = { updated_at: new Date().toISOString() };

    if (has('machine_id')) {
      if (!body.machine_id) throw { code: 'VALIDATION_ERROR', message: 'Machine is required.' };
      p.machine_id = body.machine_id;
    }
    if (has('slot_a_die_id')) p.slot_a_die_id = nullable(body.slot_a_die_id);
    if (has('slot_b_die_id')) p.slot_b_die_id = nullable(body.slot_b_die_id);
    if (has('cycle_time_sec')) p.cycle_time_sec = num(body.cycle_time_sec);
    if (has('setup_time_min')) p.setup_time_min = num(body.setup_time_min);
    if (has('heating_time_min')) p.heating_time_min = num(body.heating_time_min);
    if (has('is_active')) p.is_active = body.is_active !== false;
    if (has('notes')) p.notes = nullable(clean(body.notes || ''));

    const effectiveSlotA = has('slot_a_die_id') ? p.slot_a_die_id : existing.slot_a_die_id;
    const effectiveSlotB = has('slot_b_die_id') ? p.slot_b_die_id : existing.slot_b_die_id;

    if (!effectiveSlotA && !effectiveSlotB) {
      throw { code: 'VALIDATION_ERROR', message: 'Select at least one die slot.' };
    }

    const { data, error } = await supabase
      .from('moulding_slot_setups')
      .update(p)
      .eq('id', id)
      .select(SELECT)
      .single();

    // SETUP_ACTIVATION_RULE: explicitly activating deactivates other active setups on same machine
    if (!error && data && has('is_active') && body.is_active !== false) {
      const effectiveMachine = has('machine_id') ? p.machine_id : existing.machine_id;
      await supabase
        .from('moulding_slot_setups')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('machine_id', effectiveMachine)
        .eq('is_active', true)
        .neq('id', id);
    }

    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

export async function listMachines() {
  const { data, error } = await supabase
    .from('machine_master')
    .select('id, machine_code, machine_name, cycle_time_sec, setup_time_min, slots_count')
    .eq('is_active', true)
    .eq('capacity_basis', 'DIE_CAVITY')
    .order('machine_code');

  return { data: data ?? null, error };
}

export async function listDies() {
  const { data, error } = await supabase
    .from('die_master')
    .select('id, die_code, die_name, num_impressions')
    .eq('is_active', true)
    .order('die_code');

  return { data: data ?? null, error };
}
