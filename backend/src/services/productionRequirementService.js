import { supabase } from '../config/supabase.js';

const SELECT = `
  id, source_type, source_id, source_line_id, item_id, required_qty, required_uom_id,
  due_date, priority, status, notes, created_at, updated_at,
  item:item_master(id, item_code, item_name),
  uom:uom_master(id, uom_code, uom_name)
`;

export async function listRequirements() {
  const { data, error } = await supabase
    .from('production_requirement_queue')
    .select(SELECT)
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true });
  return { data: data ?? [], error };
}

export async function createRequirement(body) {
  const row = {
    source_type: body.source_type || 'MANUAL',
    item_id: body.item_id,
    required_qty: Number(body.required_qty),
    required_uom_id: body.required_uom_id,
    due_date: body.due_date || null,
    priority: Number(body.priority || 100),
    status: body.status || 'open',
    notes: body.notes || null,
  };

  if (!row.item_id) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Item is required.' } };
  if (!(row.required_qty > 0)) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Quantity must be greater than 0.' } };
  if (!row.required_uom_id) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'UOM is required.' } };

  const { data, error } = await supabase
    .from('production_requirement_queue')
    .insert(row)
    .select(SELECT)
    .single();

  return { data, error };
}
