/**
 * CERADRIVE ERP — BOM Service
 *
 * Header + lines CRUD only. Mirrors purchaseService header/lines transactional pattern.
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 *
 * Live schema (confirmed):
 *   bom_headers: id, item_id->item_master, bom_type_id->bom_types, version_number(def 1),
 *     status(draft|active|superseded, def draft), effective_date, copied_from_bom_id,
 *     activated_by, activated_at, superseded_by, notes, created_by/at, updated_by/at
 *   bom_lines: id, bom_id->bom_headers, component_item_id->item_master, quantity, uom_id->uom_master,
 *     scrap_factor(def 0), step_link_routing_step_id->routing_steps, component_type, is_optional,
 *     is_active(def true), line_seq, notes, created_by/at, updated_by/at
 *   bom_types: id, type_code, type_name, is_active  (only MFG active at go-live)
 *
 * Scope (confirmed): CRUD only. NOT implemented: explosion, MRP, costing, planning, reservation, WOs.
 * Rules: parent item + bom_type + component item + uom mandatory; quantity > 0; scrap_factor >= 0;
 *   new BOM starts 'draft'; bom_type fetched from active rows (MFG not hardcoded);
 *   direct self-component rejected (component_item_id != header.item_id);
 *   transitive cycle detection DEFERRED; status lifecycle (activate/supersede/version/copy) DEFERRED;
 *   step_link_routing_step_id: backend pass-through only, no UI, no routing_steps query.
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


// ─── Lookups (served in-module; no external module dependency) ────────────────

export async function listBomTypes() {
  const { data, error } = await supabase
    .from('bom_types')
    .select('id, type_code, type_name')
    .eq('is_active', true)
    .order('type_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function listBomUoms() {
  const { data, error } = await supabase
    .from('uom_master')
    .select('id, uom_code, uom_name')
    .eq('is_active', true)
    .order('uom_name', { ascending: true });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export async function searchBomItems({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  let query = supabase
    .from('item_master')
    .select('id, item_code, item_name')
    .eq('is_active', true)
    .order('item_name', { ascending: true })
    .limit(safeLimit);
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(`item_name.ilike.%${safeSearch}%,item_code.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

async function assertBomTypeActive(bom_type_id) {
  const { data, error } = await supabase
    .from('bom_types')
    .select('id, is_active')
    .eq('id', bom_type_id)
    .maybeSingle();
  if (error || !data) throw { code: 'VALIDATION_ERROR', message: 'Selected BOM type does not exist.' };
  if (!data.is_active) throw { code: 'VALIDATION_ERROR', message: 'Selected BOM type is inactive.' };
}

function normaliseBomLine(line, seq) {
  if (!line.component_item_id) throw { code: 'VALIDATION_ERROR', message: 'Component item is required on every line.' };
  if (!line.uom_id)            throw { code: 'VALIDATION_ERROR', message: 'Component UOM is required on every line.' };

  const qty = Number(line.quantity);
  if (!(qty > 0)) throw { code: 'VALIDATION_ERROR', message: 'Line quantity must be greater than 0.' };

  const scrap = (line.scrap_factor === undefined || line.scrap_factor === null || line.scrap_factor === '')
    ? 0 : Number(line.scrap_factor);
  if (!(scrap >= 0)) throw { code: 'VALIDATION_ERROR', message: 'Scrap factor must be 0 or greater.' };

  const row = {
    component_item_id: line.component_item_id,
    quantity:          qty,
    uom_id:            line.uom_id,
    scrap_factor:      scrap,
    is_optional:       line.is_optional !== undefined ? Boolean(line.is_optional) : false,
    is_active:         true,
    line_seq:          line.line_seq != null ? Number(line.line_seq) : seq,
    notes:             line.notes          || null,
    component_type:    line.component_type || null, // pass-through, no UI
  };
  if (line.step_link_routing_step_id) row.step_link_routing_step_id = line.step_link_routing_step_id; // pass-through, no UI
  return row;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listBoms({ status, bom_type_id, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('bom_headers')
    .select(`
      id, item_id, bom_type_id, version_number, status, effective_date, created_at, is_system_generated, generated_from_recipe_id, generated_from_recipe_step_id, generated_at,
      bom_type:bom_types ( type_code, type_name ),
      parent_item:item_master ( item_code, item_name )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (status)      query = query.eq('status', status);
  if (bom_type_id) query = query.eq('bom_type_id', bom_type_id);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getBomById(id) {
  const { data: header, error: headerError } = await supabase
    .from('bom_headers')
    .select(`
      id, item_id, bom_type_id, version_number, status, effective_date, is_system_generated, generated_from_recipe_id, generated_from_recipe_step_id, generated_at,
      copied_from_bom_id, activated_by, activated_at, superseded_by, notes,
      created_by, created_at, updated_by, updated_at,
      bom_type:bom_types ( id, type_code, type_name ),
      parent_item:item_master ( id, item_code, item_name )
    `)
    .eq('id', id)
    .single();

  if (headerError || !header) {
    return { data: null, error: headerError ?? { message: 'BOM not found.' } };
  }

  const { data: lines, error: linesError } = await supabase
    .from('bom_lines')
    .select(`
      id, bom_id, component_item_id, quantity, uom_id, scrap_factor,
      component_type, is_optional, is_active, line_seq, notes, step_link_routing_step_id,
      component:item_master ( id, item_code, item_name ),
      uom:uom_master ( id, uom_code, uom_name )
    `)
    .eq('bom_id', id)
    .order('line_seq', { ascending: true });

  if (linesError) return { data: null, error: linesError };

  return { data: { ...header, lines: lines ?? [] }, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function createBom(body, userId) {
  const { lines = [], ...header } = body;

  if (!header.item_id)     throw { code: 'VALIDATION_ERROR', message: 'Parent item is required.' };
  if (!header.bom_type_id) throw { code: 'VALIDATION_ERROR', message: 'BOM type is required.' };

  await assertBomTypeActive(header.bom_type_id);

  // Direct self-component prevention (transitive detection deferred)
  for (const l of lines) {
    if (l.component_item_id && l.component_item_id === header.item_id) {
      throw { code: 'VALIDATION_ERROR', message: 'A BOM cannot list its own parent item as a component.' };
    }
  }

  const { data: created, error: headerError } = await supabase
    .from('bom_headers')
    .insert({
      item_id:        header.item_id,
      bom_type_id:    header.bom_type_id,
      effective_date: header.effective_date || null,
      notes:          header.notes          || null,
      status:         'draft',               // new BOM always starts draft
      created_by:     userId,
    })
    .select('id')
    .single();

  if (headerError) return { data: null, error: headerError };

  if (lines.length > 0) {
    const lineRows = lines.map((line, i) => ({
      bom_id:     created.id,
      created_by: userId,
      ...normaliseBomLine(line, i + 1),
    }));
    const { error: linesError } = await supabase.from('bom_lines').insert(lineRows);
    if (linesError) {
      await supabase.from('bom_lines').delete().eq('bom_id', created.id);
      await supabase.from('bom_headers').delete().eq('id', created.id);
      return { data: null, error: linesError };
    }
  }

  return getBomById(created.id);
}

export async function updateDraftBom(id, body, userId) {
  const { lines, ...rawHeader } = body;
  const now = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('bom_headers')
    .select('id, item_id, status, is_system_generated')
    .eq('id', id)
    .single();
  if (curErr || !current) return { data: null, error: curErr ?? { message: 'BOM not found.' } };
  if (current.is_system_generated) {
    return { data: null, error: { code: 'VALIDATION_ERROR', message: 'Generated BOMs are read-only. Edit the Manufacturing Recipe instead.' } };
  }

  if (String(current.status || '').toLowerCase() !== 'draft') {
    return { data: null, error: { code: 'CONFLICT', message: 'Only draft BOMs can be edited.' } };
  }

  const effectiveParent = rawHeader.item_id ?? current.item_id;

  // Whitelisted header fields only — lifecycle/version/audit fields are NOT editable here.
  const allowed = {};
  if (rawHeader.item_id        !== undefined) allowed.item_id        = rawHeader.item_id;
  if (rawHeader.bom_type_id    !== undefined) { await assertBomTypeActive(rawHeader.bom_type_id); allowed.bom_type_id = rawHeader.bom_type_id; }
  if (rawHeader.effective_date !== undefined) allowed.effective_date = rawHeader.effective_date || null;
  if (rawHeader.notes          !== undefined) allowed.notes          = rawHeader.notes || null;

  if (Object.keys(allowed).length > 0) {
    allowed.updated_by = userId;
    allowed.updated_at = now;
    const { error: headerError } = await supabase.from('bom_headers').update(allowed).eq('id', id);
    if (headerError) return { data: null, error: headerError };
  }

  if (lines) {
    // Self-component validation on added/updated lines
    for (const l of [...(lines.add ?? []), ...(lines.update ?? [])]) {
      if (l.component_item_id && l.component_item_id === effectiveParent) {
        throw { code: 'VALIDATION_ERROR', message: 'A BOM cannot list its own parent item as a component.' };
      }
    }

    if (lines.add?.length > 0) {
      const { data: existing } = await supabase
        .from('bom_lines')
        .select('line_seq')
        .eq('bom_id', id)
        .order('line_seq', { ascending: false })
        .limit(1);
      let nextSeq = (existing?.[0]?.line_seq ?? 0) + 1;
      const newRows = lines.add.map((line) => ({
        bom_id:     id,
        created_by: userId,
        ...normaliseBomLine(line, nextSeq++),
      }));
      const { error } = await supabase.from('bom_lines').insert(newRows);
      if (error) return { data: null, error };
    }

    if (lines.update?.length > 0) {
      for (const line of lines.update) {
        const { id: lineId, line_seq, ...fields } = line;
        const { error } = await supabase
          .from('bom_lines')
          .update({ ...normaliseBomLine(fields, line_seq), updated_by: userId, updated_at: now })
          .eq('id', lineId)
          .eq('bom_id', id);
        if (error) return { data: null, error };
      }
    }

    if (lines.remove?.length > 0) {
      const { error } = await supabase
        .from('bom_lines')
        .delete()
        .in('id', lines.remove)
        .eq('bom_id', id);
      if (error) return { data: null, error };
    }
  }

  return getBomById(id);
}
