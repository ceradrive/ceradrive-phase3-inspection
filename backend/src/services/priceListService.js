/**
 * CERADRIVE ERP — Price List Service
 * Header + lines. Returns { data, error }; throws { code, message } on business rules.
 * Revision = new header row; unique (price_list_code, revision). Manual codes (no series).
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


const HEADER_SELECT = `
  id, price_list_code, price_list_name, revision, currency,
  valid_from, valid_to, is_active, notes, created_at, updated_at
`;
const LINE_SELECT = `
  id, line_number, item_id, uom_id, unit_rate, discount_percent, discount_amount,
  item_master ( id, item_code, item_name ),
  uom_master  ( id, uom_code, uom_name )
`;

export async function searchPriceLists({ search, limit } = {}) {
  let q = supabase.from('price_list_headers')
    .select('id, price_list_code, price_list_name, revision, is_active')
    .order('price_list_code', { ascending: true })
    .limit(Math.min(Number(limit) || 20, 50));
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`price_list_code.ilike.%${safeSearch}%,price_list_name.ilike.%${safeSearch}%`);
  const { data, error } = await q;
  return error ? { data: null, error } : { data: data ?? [], error: null };
}

export async function listPriceListMaster(filters = {}) {
  const { is_active, search, page = 1, limit = 20 } = filters;
  const safe = Math.min(Number(limit) || 20, 100);
  const off  = (Math.max(Number(page) || 1, 1) - 1) * safe;
  let q = supabase.from('price_list_headers')
    .select(HEADER_SELECT, { count: 'exact' })
    .order('price_list_code', { ascending: true })
    .order('revision', { ascending: false })
    .range(off, off + safe - 1);
  if (is_active !== undefined && is_active !== null) q = q.eq('is_active', is_active === 'true' || is_active === true);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`price_list_code.ilike.%${safeSearch}%,price_list_name.ilike.%${safeSearch}%`);
  const { data, error, count } = await q;
  return error ? { data: null, count: null, error } : { data: data ?? [], count, error: null };
}

export async function getPriceListById(id) {
  const { data: header, error: hErr } = await supabase
    .from('price_list_headers').select(HEADER_SELECT).eq('id', id).single();
  if (hErr || !header) return { data: null, error: hErr ?? { message: 'Price list not found.' } };
  const { data: lines, error: lErr } = await supabase
    .from('price_list_lines').select(LINE_SELECT).eq('price_list_id', id).order('line_number', { ascending: true });
  if (lErr) return { data: null, error: lErr };
  return { data: { ...header, lines: lines ?? [] }, error: null };
}

async function assertUniqueCodeRevision(code, revision, excludeId) {
  let q = supabase.from('price_list_headers').select('id')
    .eq('price_list_code', code.trim()).eq('revision', revision);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  if (data && data.length) throw { code: 'CONFLICT', message: `Price list ${code} revision ${revision} already exists.` };
}

export async function createPriceList(body, userId) {
  const code = body.price_list_code.trim();
  const revision = body.revision ?? 1;
  await assertUniqueCodeRevision(code, revision, null);

  const { data: header, error: hErr } = await supabase.from('price_list_headers')
    .insert({
      price_list_code: code,
      price_list_name: body.price_list_name.trim(),
      revision,
      currency:   body.currency ?? 'INR',
      valid_from: body.valid_from ?? null,
      valid_to:   body.valid_to ?? null,
      notes:      body.notes ?? null,
      is_active:  true,
      created_by: userId,
    }).select('id').single();
  if (hErr || !header) return { data: null, error: hErr ?? { message: 'Failed to create price list.' } };

  const rows = body.lines.map((l, i) => ({
    price_list_id: header.id, line_number: i + 1,
    item_id: l.item_id, uom_id: l.uom_id ?? null, unit_rate: l.unit_rate,
    discount_percent: l.discount_percent ?? null, discount_amount: l.discount_amount ?? null,
  }));
  const { error: lErr } = await supabase.from('price_list_lines').insert(rows);
  if (lErr) { await supabase.from('price_list_headers').delete().eq('id', header.id); return { data: null, error: lErr }; }
  return getPriceListById(header.id);
}

export async function updatePriceList(id, body, userId) {
  const { data: existing, error: exErr } = await supabase
    .from('price_list_headers').select('id').eq('id', id).single();
  if (exErr || !existing) return { data: null, error: exErr ?? { message: 'Price list not found.' } };

  const patch = { updated_by: userId, updated_at: new Date().toISOString() };
  if (body.price_list_name !== undefined) patch.price_list_name = body.price_list_name.trim();
  if (body.currency   !== undefined) patch.currency   = body.currency;
  if (body.valid_from !== undefined) patch.valid_from = body.valid_from;
  if (body.valid_to   !== undefined) patch.valid_to   = body.valid_to;
  if (body.notes      !== undefined) patch.notes      = body.notes;
  const { error: hErr } = await supabase.from('price_list_headers').update(patch).eq('id', id);
  if (hErr) return { data: null, error: hErr };

  const diff = body.lines ?? {};
  if (diff.remove?.length) {
    const { error } = await supabase.from('price_list_lines').delete().in('id', diff.remove).eq('price_list_id', id);
    if (error) return { data: null, error };
  }
  if (diff.update?.length) {
    for (const l of diff.update) {
      const { error } = await supabase.from('price_list_lines').update({
        item_id: l.item_id, uom_id: l.uom_id ?? null, unit_rate: l.unit_rate,
        discount_percent: l.discount_percent ?? null, discount_amount: l.discount_amount ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', l.id).eq('price_list_id', id);
      if (error) return { data: null, error };
    }
  }
  if (diff.add?.length) {
    const { data: maxRow } = await supabase.from('price_list_lines')
      .select('line_number').eq('price_list_id', id).order('line_number', { ascending: false }).limit(1);
    let n = maxRow?.[0]?.line_number ?? 0;
    const rows = diff.add.map(l => ({
      price_list_id: id, line_number: ++n,
      item_id: l.item_id, uom_id: l.uom_id ?? null, unit_rate: l.unit_rate,
      discount_percent: l.discount_percent ?? null, discount_amount: l.discount_amount ?? null,
    }));
    const { error } = await supabase.from('price_list_lines').insert(rows);
    if (error) return { data: null, error };
  }
  return getPriceListById(id);
}

export async function togglePriceListActive(id, is_active, userId) {
  const { error } = await supabase.from('price_list_headers')
    .update({ is_active, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { data: null, error };
  return getPriceListById(id);
}
