import { supabase } from '../config/supabase.js';

export function calculatePressPlan({ qty, cycleTimeSec = 510, pcsPerCycle = 8 }) {
  const cyclesRequired = Math.ceil(Number(qty || 0) / Number(pcsPerCycle || 1));
  const runtimeHours = (cyclesRequired * Number(cycleTimeSec || 0)) / 3600;
  const dailyCapacity = Math.floor((86400 / Number(cycleTimeSec || 1)) * Number(pcsPerCycle || 0));

  return {
    qty,
    pcs_per_cycle: pcsPerCycle,
    cycle_time_sec: cycleTimeSec,
    cycles_required: cyclesRequired,
    runtime_hours: Number(runtimeHours.toFixed(2)),
    daily_capacity_pcs: dailyCapacity,
  };
}

export async function createPressWorkOrder({ item_id, qty, uom_code, notes }, userId) {
  if (!item_id) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Item is required.' } };
  if (!(Number(qty) > 0)) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Qty must be greater than 0.' } };

  const { data: uom } = await supabase
    .from('uom_master')
    .select('id')
    .eq('uom_code', uom_code || 'PCS')
    .maybeSingle();

  const woNumber = `PWO-${Date.now()}`;

  const { data, error } = await supabase
    .from('wo_headers')
    .insert({
      wo_number: woNumber,
      item_id,
      planned_qty: Number(qty),
      uom_id: uom?.id ?? null,
      status: 'draft',
      wo_date: new Date().toISOString().slice(0, 10),
      priority_level: 'normal',
      notes: notes || 'Created from Press Production Planner',
      created_by: userId,
    })
    .select('id, wo_number, planned_qty, status')
    .single();

  return { data, error };
}
