/**
 * CERADRIVE ERP — Sales Order Service (10B). Draft CRUD. No pricing/approve logic yet.
 * Returns { data, error }; throws { code, message } on business rules.
 */
import { supabase }       from '../config/supabase.js';
import { getNextNumber }  from './numberSeriesService.js';

const HEADER_SELECT = `
  id, so_number, customer_id, price_list_id, so_date, delivery_date,
  customer_reference, payment_terms, status, notes, created_at, updated_at,
  customer_master    ( id, customer_code, customer_name ),
  price_list_headers ( id, price_list_code, price_list_name, revision )
`;
const LINE_SELECT = `
  id, line_number, item_id, uom_id, qty, unit_rate, discount_percent, discount_amount,
  tax_id, tax_percent, tax_amount, line_total, rate_source, printable_vehicle_name, notes,
  item_master ( id, item_code, item_name ),
  uom_master  ( id, uom_code, uom_name )
`;

function lineRow(l, soId, lineNumber) {
  return {
    so_id: soId, line_number: lineNumber,
    item_id: l.item_id, uom_id: l.uom_id ?? null,
    qty: l.qty, unit_rate: l.unit_rate ?? null,
    discount_percent: l.discount_percent ?? null, discount_amount: l.discount_amount ?? null,
    tax_id: l.tax_id ?? null, tax_percent: l.tax_percent ?? null, tax_amount: l.tax_amount ?? null,
    line_total: l.line_total ?? null, rate_source: l.rate_source ?? 'manual',
    printable_vehicle_name: l.printable_vehicle_name ?? null, notes: l.notes ?? null,
  };
}


// SO-DEFAULT-UOM-1: Sales Orders should default FG/SET items to the item's sales/planning UOM.
// Reason: users enter finished-goods orders in SETS, while production/MRP converts SETS -> PCS via pcs_per_set.
function desiredSalesUomCode(item) {
  const planning = String(item?.planning_unit || '').toUpperCase();
  const stage = String(item?.stage_type || '').toUpperCase();
  const pcsPerSet = Number(item?.pcs_per_set || 0);

  if (planning === 'SET') return 'SET';
  if ((stage === 'SET' || stage === 'FG') && pcsPerSet > 1) return 'SET';
  if (['PCS', 'KG', 'TRAY', 'CRATE'].includes(planning)) return planning;
  return null;
}

async function normalizeSalesOrderLines(lines = []) {
  if (!Array.isArray(lines) || !lines.length) return [];

  const itemIds = [...new Set(lines.map((l) => l?.item_id).filter(Boolean))];
  if (!itemIds.length) return lines;

  const { data: items, error: itemErr } = await supabase
    .from('item_master')
    .select('id, item_code, planning_unit, stage_type, pcs_per_set')
    .in('id', itemIds);
  if (itemErr) throw { code: 'VALIDATION_ERROR', message: itemErr.message || 'Failed to resolve item UOM defaults.' };

  const itemById = new Map((items || []).map((item) => [item.id, item]));
  const neededCodes = [...new Set((items || []).map(desiredSalesUomCode).filter(Boolean))];
  const { data: uoms, error: uomErr } = neededCodes.length
    ? await supabase.from('uom_master').select('id, uom_code').in('uom_code', neededCodes)
    : { data: [], error: null };
  if (uomErr) throw { code: 'VALIDATION_ERROR', message: uomErr.message || 'Failed to resolve sales UOM.' };

  const uomByCode = new Map((uoms || []).map((u) => [String(u.uom_code || '').toUpperCase(), u.id]));

  return lines.map((line) => {
    const item = itemById.get(line?.item_id);
    const desired = desiredSalesUomCode(item);
    const desiredUomId = desired ? uomByCode.get(desired) : null;

    // Force SET for FG/SET items so SO qty is sales-side SET qty, not production PCS.
    // Non-SET items keep the user's supplied UOM unless the line has no UOM and item planning_unit resolves.
    if (desiredUomId && (desired === 'SET' || !line.uom_id)) {
      return { ...line, uom_id: desiredUomId };
    }
    return line;
  });
}

export async function listSalesOrders(filters = {}) {
  const { status, customer_id, date_from, date_to, search, page = 1, limit = 20 } = filters;
  const safe = Math.min(Number(limit) || 20, 100);
  const off  = (Math.max(Number(page) || 1, 1) - 1) * safe;
  let q = supabase.from('sales_order_headers')
    .select(HEADER_SELECT, { count: 'exact' })
    .order('so_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(off, off + safe - 1);
  if (status)      q = q.eq('status', status);
  if (customer_id) q = q.eq('customer_id', customer_id);
  if (date_from)   q = q.gte('so_date', date_from);
  if (date_to)     q = q.lte('so_date', date_to);
  if (search)      q = q.ilike('so_number', `%${search}%`);
  const { data, error, count } = await q;
  return error ? { data: null, count: null, error } : { data: data ?? [], count, error: null };
}

export async function getSalesOrderById(id) {
  const { data: header, error: hErr } = await supabase
    .from('sales_order_headers').select(HEADER_SELECT).eq('id', id).single();
  if (hErr || !header) return { data: null, error: hErr ?? { message: 'Sales order not found.' } };
  const { data: lines, error: lErr } = await supabase
    .from('sales_order_lines').select(LINE_SELECT).eq('so_id', id).order('line_number', { ascending: true });
  if (lErr) return { data: null, error: lErr };
  return { data: { ...header, lines: lines ?? [] }, error: null };
}

export async function createSalesOrder(body, userId) {
  let so_number;
  try { so_number = await getNextNumber('SO'); }
  catch (e) { return { data: null, error: { code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? 'Number series error.' } }; }

  const { data: header, error: hErr } = await supabase.from('sales_order_headers')
    .insert({
      so_number, customer_id: body.customer_id, price_list_id: body.price_list_id ?? null,
      so_date: body.so_date, delivery_date: body.delivery_date ?? null,
      customer_reference: body.customer_reference ?? null, payment_terms: body.payment_terms ?? null,
      notes: body.notes ?? null, status: 'draft', created_by: userId,
    }).select('id').single();
  if (hErr || !header) return { data: null, error: hErr ?? { message: 'Failed to create sales order.' } };

  let lines;
  try { lines = await normalizeSalesOrderLines(body.lines ?? []); }
  catch (e) { await supabase.from('sales_order_headers').delete().eq('id', header.id); return { data: null, error: e }; }
  if (lines.length) {
    const rows = lines.map((l, i) => lineRow(l, header.id, i + 1));
    const { error: lErr } = await supabase.from('sales_order_lines').insert(rows);
    if (lErr) { await supabase.from('sales_order_headers').delete().eq('id', header.id); return { data: null, error: lErr }; }
  }
  return getSalesOrderById(header.id);
}

export async function updateSalesOrder(id, body, userId) {
  const { data: existing, error: exErr } = await supabase
    .from('sales_order_headers')
    .select('id, status')
    .eq('id', id)
    .single();

  if (exErr || !existing) return { data: null, error: exErr ?? { code: 'NOT_FOUND', message: 'Sales order not found.' } };

  if (String(existing.status || '').toLowerCase() !== 'draft') {
    return { data: null, error: { code: 'CONFLICT', message: 'Only draft sales orders can be edited.' } };
  }

  const patch = { updated_by: userId, updated_at: new Date().toISOString() };
  for (const f of ['price_list_id', 'so_date', 'delivery_date', 'customer_reference', 'payment_terms', 'notes']) {
    if (body[f] !== undefined) patch[f] = body[f];
  }
  const { error: hErr } = await supabase.from('sales_order_headers').update(patch).eq('id', id);
  if (hErr) return { data: null, error: hErr };

  if (Array.isArray(body.lines)) {
    let normalizedLines;
    try { normalizedLines = await normalizeSalesOrderLines(body.lines); }
    catch (e) { return { data: null, error: e }; }
    const { error: rpcErr } = await supabase.rpc('replace_sales_order_lines_atomic', {
      p_so_id: id,
      p_lines: normalizedLines,
    });
    if (rpcErr) return { data: null, error: rpcErr };
    return getSalesOrderById(id);
  }

  const diff = body.lines ?? {};
  if (diff.remove?.length) {
    const { error } = await supabase.from('sales_order_lines').delete().in('id', diff.remove).eq('so_id', id);
    if (error) return { data: null, error };
  }
  if (diff.update?.length) {
    let updateLines;
    try { updateLines = await normalizeSalesOrderLines(diff.update); }
    catch (e) { return { data: null, error: e }; }
    for (const l of updateLines) {
      const { id: lineId, ...rest } = l;
      const row = lineRow(rest, id, undefined); delete row.so_id; delete row.line_number;
      const { error } = await supabase.from('sales_order_lines')
        .update({ ...row, updated_at: new Date().toISOString() }).eq('id', lineId).eq('so_id', id);
      if (error) return { data: null, error };
    }
  }
  if (diff.add?.length) {
    const { data: maxRow } = await supabase.from('sales_order_lines')
      .select('line_number').eq('so_id', id).order('line_number', { ascending: false }).limit(1);
    let n = maxRow?.[0]?.line_number ?? 0;
    let addLines;
    try { addLines = await normalizeSalesOrderLines(diff.add); }
    catch (e) { return { data: null, error: e }; }
    const rows = addLines.map(l => lineRow(l, id, ++n));
    const { error } = await supabase.from('sales_order_lines').insert(rows);
    if (error) return { data: null, error };
  }
  return getSalesOrderById(id);
}


export async function approveSalesOrder(id, userId) {
  const { data: existing, error: exErr } = await supabase
    .from('sales_order_headers')
    .select('id, status')
    .eq('id', id)
    .single();
  if (exErr || !existing) return { data: null, error: exErr ?? { code: 'NOT_FOUND', message: 'Sales order not found.' } };
  if (String(existing.status || '').toLowerCase() !== 'draft') {
    return { data: null, error: { code: 'CONFLICT', message: 'Only draft sales orders can be approved.' } };
  }
  const { count, error: cErr } = await supabase
    .from('sales_order_lines')
    .select('id', { count: 'exact', head: true })
    .eq('so_id', id);
  if (cErr) return { data: null, error: cErr };
  if (!count) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Add at least one line before approving.' } };
  const { error: uErr } = await supabase
    .from('sales_order_headers')
    .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
    .eq('id', id);
  if (uErr) return { data: null, error: uErr };
  return getSalesOrderById(id);
}

export async function cancelSalesOrder(id, userId) {
  const { data: existing, error: exErr } = await supabase
    .from('sales_order_headers')
    .select('id, status')
    .eq('id', id)
    .single();
  if (exErr || !existing) return { data: null, error: exErr ?? { code: 'NOT_FOUND', message: 'Sales order not found.' } };
  const st = String(existing.status || '').toLowerCase();
  if (st !== 'draft' && st !== 'approved') {
    return { data: null, error: { code: 'CONFLICT', message: 'Only draft or approved sales orders can be cancelled.' } };
  }
  const { error: uErr } = await supabase
    .from('sales_order_headers')
    .update({ status: 'cancelled', cancelled_by: userId, cancelled_at: new Date().toISOString() })
    .eq('id', id);
  if (uErr) return { data: null, error: uErr };
  return getSalesOrderById(id);
}
