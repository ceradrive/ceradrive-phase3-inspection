/**
 * CERADRIVE ERP — Item Service
 *
 * Phase 9C-B: searchItems (read-only, Create PO screen) — PRESERVED
 * Item Master: full CRUD — list, get, create, update, toggle active, delete
 *
 * Returns { data, error } — no HTTP knowledge.
 * Delete is soft-only, protected against all linked transaction tables.
 *
 * Lookup tables fetched separately (not FK-joined — avoids PostgREST view issues):
 *   item_types, item_categories, uom_master, tax_master
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


// ─── Column sets ──────────────────────────────────────────────────────────────

const LIST_COLS = `
  id, item_code, item_name, is_active,
  item_type_id, category_id, uom_id,
  hsn_code, formulation_code, formulation_name,
  is_purchasable, is_sellable, is_manufactured, is_stocked,
  standard_cost, standard_rate,
  created_at, updated_at
`;

const DETAIL_COLS = `
  id, item_code, item_name, is_active,
  item_type_id, category_id, uom_id, purchase_uom_id, sales_uom_id,
  barcode, hsn_code, description, notes,
  is_purchasable, is_sellable, is_manufactured, is_stocked,
  formulation_code, formulation_name,
  make_policy, planning_unit, stage_type, calculation_basis,
  weight_g, preform_weight_g, bp_weight_g,
  default_pcs_per_tray, default_pcs_per_crate,
  pcs_per_set, cavity_count, grinder_category,
  length_mm, width_mm, thickness_mm,
  qc_required, default_qc_type_id,
  min_stock, max_stock, reorder_qty, min_order_qty,
  costing_method, standard_cost, last_purchase_rate, standard_rate,
  drawing_no, item_image_url, drawing_image_url, drawing_pdf_url,
  created_by, created_at, updated_by, updated_at
`;

// ─── Phase 9C-B: searchItems (used by Create PO live search) ─────────────────
// PRESERVED — do not change signature or filter behaviour

export async function searchItems(filters = {}) {
  const { search, limit = 20, purchase_only = false, sales_only = false } = filters;
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const sel = `id, item_code, item_name, uom_id, purchase_uom_id`;

  let baseQ = supabase.from('item_master').select(sel).eq('is_active', true)
    .order('item_name', { ascending: true }).limit(safeLimit);

  if (String(purchase_only) === 'true' || purchase_only === true) {
    baseQ = baseQ.eq('is_purchasable', true);
  }
  if (String(sales_only) === 'true' || sales_only === true) {
    baseQ = baseQ.eq('is_sellable', true);
  }
  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    baseQ = baseQ.or(`item_name.ilike.%${safeSearch}%,item_code.ilike.%${safeSearch}%`);
  }
  const { data: baseRows, error: baseErr } = await baseQ;
  if (baseErr) return { data: [], error: baseErr };
  let rows = baseRows ?? [];

  // 10H: also match by compatible vehicle name (additive)
  if (search?.trim()) {
    const { data: vc } = await supabase
      .from('item_vehicle_compatibility')
      .select('item_id, vehicle_master!inner(vehicle_name)')
      .ilike('vehicle_master.vehicle_name', `%${search.trim()}%`)
      .limit(safeLimit);
    const ids = [...new Set((vc ?? []).map(r => r.item_id))].filter(id => !rows.some(r => r.id === id));
    if (ids.length) {
      let extraQ = supabase.from('item_master').select(sel)
        .eq('is_active', true)
        .in('id', ids)
        .limit(safeLimit);

      if (String(purchase_only) === 'true' || purchase_only === true) {
        extraQ = extraQ.eq('is_purchasable', true);
      }
      if (String(sales_only) === 'true' || sales_only === true) {
        extraQ = extraQ.eq('is_sellable', true);
      }

      const { data: extra } = await extraQ;
      rows = rows.concat(extra ?? []);
    }
  }
  rows = rows.slice(0, safeLimit);

  // Attach UOM labels for purchase/order pickers.
  if (rows.length) {
    const uomIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.uom_id, r.purchase_uom_id])
          .filter(Boolean)
      ),
    ];

    let uomById = {};
    if (uomIds.length) {
      const { data: uoms, error: uomErr } = await supabase
        .from('uom_master')
        .select('id, uom_code, uom_name')
        .in('id', uomIds);

      if (uomErr) return { data: [], error: uomErr };

      uomById = Object.fromEntries((uoms ?? []).map((u) => [u.id, u]));
    }

    rows = rows.map((r) => {
      const baseUom = r.uom_id ? uomById[r.uom_id] : null;
      const purchaseUom = r.purchase_uom_id ? uomById[r.purchase_uom_id] : null;

      return {
        ...r,
        uom_code: baseUom?.uom_code ?? null,
        purchase_uom_code: purchaseUom?.uom_code ?? baseUom?.uom_code ?? null,
        uom: baseUom,
        purchase_uom: purchaseUom ?? baseUom,
      };
    });
  }

  // 10H: attach compatible vehicles (additive; existing PO/BOM consumers ignore extra field)
  if (rows.length) {
    const { data: comps } = await supabase
      .from('item_vehicle_compatibility')
      .select('item_id, is_default, sort_order, vehicle_master ( id, vehicle_name )')
      .in('item_id', rows.map(r => r.id))
      .order('sort_order', { ascending: true });
    const byItem = {};
    (comps ?? []).forEach(c => {
      (byItem[c.item_id] = byItem[c.item_id] || []).push({
        vehicle_id: c.vehicle_master?.id, vehicle_name: c.vehicle_master?.vehicle_name, is_default: c.is_default,
      });
    });
    rows = rows.map(r => ({ ...r, vehicles: byItem[r.id] ?? [] }));
  }

  return { data: rows, error: null };
}

// ─── Item Master: List ────────────────────────────────────────────────────────

export async function listItemMaster(filters = {}) {
  const { search, is_active, item_type_id, category_id, page = 1, limit = 20 } = filters;
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('item_master')
    .select(LIST_COLS, { count: 'exact' })
    .order('item_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `item_name.ilike.%${safeSearch}%,item_code.ilike.%${safeSearch}%,hsn_code.ilike.%${safeSearch}%`
    );
  }
  if (is_active === 'true')  query = query.eq('is_active', true);
  if (is_active === 'false') query = query.eq('is_active', false);
  if (item_type_id)          query = query.eq('item_type_id', item_type_id);
  if (category_id)           query = query.eq('category_id', category_id);

  const { data, error, count } = await query;
  return { data: data ?? [], count: count ?? 0, error: error ?? null };
}

// ─── Item Master: Get by ID ───────────────────────────────────────────────────

export async function getItemById(id) {
  const { data, error } = await supabase
    .from('item_master')
    .select(DETAIL_COLS)
    .eq('id', id)
    .single();

  if (error || !data) {
    return { data: null, error: error ?? { message: 'Item not found.' } };
  }
  return { data, error: null };
}

// ─── Item Master: Create ──────────────────────────────────────────────────────

export async function createItem(body, userId) {
  // Duplicate check: item_code must be unique
  if (body.item_code?.trim()) {
    const { data: existing } = await supabase
      .from('item_master')
      .select('id')
      .eq('item_code', body.item_code.trim().toUpperCase())
      .maybeSingle();
    if (existing) {
      return {
        data: null,
        error: { code: 'CONFLICT', field: 'item_code', message: `Item Code '${body.item_code.trim().toUpperCase()}' already exists.` },
      };
    }
  }

  const { data, error } = await supabase
    .from('item_master')
    .insert(buildRow(body, userId, true))
    .select(DETAIL_COLS)
    .single();

  if (!error && data && Array.isArray(body.vehicles)) await syncItemVehicles(data.id, body.vehicles);
  return { data: data ?? null, error: error ?? null };
}

// ─── Item Master: Update ──────────────────────────────────────────────────────

export async function updateItem(id, body, userId) {
  if (body.item_code?.trim()) {
    const { data: existing } = await supabase
      .from('item_master')
      .select('id')
      .eq('item_code', body.item_code.trim().toUpperCase())
      .neq('id', id)
      .maybeSingle();
    if (existing) {
      return {
        data: null,
        error: { code: 'CONFLICT', field: 'item_code', message: `Item Code '${body.item_code.trim().toUpperCase()}' already exists.` },
      };
    }
  }

  const { data, error } = await supabase
    .from('item_master')
    .update(buildPatchRow(body, userId))
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (!error && data && body.vehicles !== undefined) await syncItemVehicles(id, body.vehicles);
  return { data: data ?? null, error: error ?? null };
}

// ─── Item Master: Toggle Active ───────────────────────────────────────────────

export async function toggleItemActive(id, is_active, userId) {
  const { data, error } = await supabase
    .from('item_master')
    .update({ is_active, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, item_code, item_name, is_active')
    .single();

  return { data: data ?? null, error: error ?? null };
}

// ─── Item Master: Delete (soft-delete, fully protected) ───────────────────────
// Checks: po_lines, grn_lines, inventory_balance, inventory_ledger
// Any link → 409 CONFLICT. No hard delete ever.

export async function deleteItem(id, userId) {
  const [poResult, grnResult, invBalResult, invLedResult] = await Promise.all([
    supabase.from('po_lines')          .select('id', { count: 'exact', head: true }).eq('item_id', id),
    supabase.from('grn_lines')         .select('id', { count: 'exact', head: true }).eq('item_id', id),
    supabase.from('inventory_balance') .select('id', { count: 'exact', head: true }).eq('item_id', id),
    supabase.from('inventory_ledger')  .select('id', { count: 'exact', head: true }).eq('item_id', id),
  ]);

  // Surface first DB error if any
  for (const r of [poResult, grnResult, invBalResult, invLedResult]) {
    if (r.error) return { data: null, error: r.error };
  }

  const poCount  = poResult.count  ?? 0;
  const grnCount = grnResult.count ?? 0;
  const invBal   = invBalResult.count ?? 0;
  const invLed   = invLedResult.count ?? 0;

  if (poCount + grnCount + invBal + invLed > 0) {
    const parts = [];
    if (poCount  > 0) parts.push(`${poCount} Purchase Order line${poCount > 1 ? 's' : ''}`);
    if (grnCount > 0) parts.push(`${grnCount} GRN line${grnCount > 1 ? 's' : ''}`);
    if (invBal   > 0) parts.push(`inventory balance records`);
    if (invLed   > 0) parts.push(`inventory ledger entries`);

    return {
      data: null,
      error: {
        code:    'CONFLICT',
        message: `Cannot delete item — linked to ${parts.join(', ')}.`,
        details: [
          { table: 'po_lines',          count: poCount  },
          { table: 'grn_lines',         count: grnCount },
          { table: 'inventory_balance', count: invBal   },
          { table: 'inventory_ledger',  count: invLed   },
        ],
      },
    };
  }

  // Safe to soft-delete
  const { data, error } = await supabase
    .from('item_master')
    .update({ is_active: false, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, item_code, item_name')
    .single();

  return { data: data ?? null, error: error ?? null };
}

// ─── Lookups (for dropdowns) ──────────────────────────────────────────────────

export async function getItemLookups() {
  const [typesRes, catsRes, uomsRes, taxRes, qcRes] = await Promise.all([
    supabase.from('item_types')      .select('id, type_name, type_code').eq('is_active', true).order('type_name'),
    supabase.from('item_categories') .select('id, category_name, category_code').eq('is_active', true).order('category_name'),
    supabase.from('uom_master')      .select('id, uom_name, uom_code').eq('is_active', true).order('uom_name'),
    supabase.from('tax_master')      .select('id, tax_name, tax_percent').eq('is_active', true).order('tax_name'),
    supabase.from('qc_types')        .select('id, type_name, type_code').eq('is_active', true).order('type_name'),
  ]);

  return {
    data: {
      item_types:       typesRes.data  ?? [],
      item_categories:  catsRes.data   ?? [],
      uom_master:       uomsRes.data   ?? [],
      tax_master:       taxRes.data    ?? [],
      qc_types:         qcRes.data     ?? [],
    },
    error: typesRes.error ?? catsRes.error ?? uomsRes.error ?? taxRes.error ?? qcRes.error ?? null,
  };
}

// ─── Internal: build DB row from request body ─────────────────────────────────

function buildRow(body, userId, isCreate) {
  const now = new Date().toISOString();

  const row = {
    item_name:          (body.item_name ?? '').trim(),
    is_active:          body.is_active !== undefined ? Boolean(body.is_active) : true,
    barcode:            body.barcode            || null,
    hsn_code:           body.hsn_code           || null,
    description:        body.description        || null,
    notes:              body.notes              || null,
    is_purchasable:     body.is_purchasable     ?? false,
    is_sellable:        body.is_sellable        ?? false,
    is_manufactured:    body.is_manufactured    ?? false,
    is_stocked:         body.is_stocked         ?? true,
    formulation_code:   body.formulation_code   || null,
    formulation_name:   body.formulation_name   || null,
    make_policy:        body.make_policy        || null,
    planning_unit:      body.planning_unit      || null,
    stage_type:         body.stage_type         || null,
    calculation_basis:  body.calculation_basis  || null,
    weight_g:           num(body.weight_g),
    preform_weight_g:   num(body.preform_weight_g),
    bp_weight_g:        num(body.bp_weight_g),
    default_pcs_per_tray:  num(body.default_pcs_per_tray),
    default_pcs_per_crate: num(body.default_pcs_per_crate),
    pcs_per_set:        num(body.pcs_per_set),
    cavity_count:       num(body.cavity_count),
    grinder_category:   body.grinder_category   || null,
    length_mm:          num(body.length_mm),
    width_mm:           num(body.width_mm),
    thickness_mm:       num(body.thickness_mm),
    qc_required:        body.qc_required        ?? false,
    min_stock:          num(body.min_stock),
    max_stock:          num(body.max_stock),
    reorder_qty:        num(body.reorder_qty),
    min_order_qty:      num(body.min_order_qty),
    costing_method:     body.costing_method     || null,
    standard_cost:      num(body.standard_cost),
    last_purchase_rate: num(body.last_purchase_rate),
    standard_rate:      num(body.standard_rate),
    drawing_no:         body.drawing_no         || null,
    item_image_url:     body.item_image_url     || null,
    drawing_image_url:  body.drawing_image_url  || null,
    drawing_pdf_url:    body.drawing_pdf_url    || null,
    updated_by:         userId,
    updated_at:         now,
  };

  // item_code — uppercased, only include if provided
  if (body.item_code?.trim()) row.item_code = body.item_code.trim().toUpperCase();

  // Audit
  if (isCreate) row.created_by = userId;

  // FK fields — only include if non-empty UUID (avoids FK constraint errors)
  const fkFields = ['item_type_id','category_id','uom_id','purchase_uom_id','sales_uom_id','default_qc_type_id'];
  for (const f of fkFields) {
    if (body[f]) row[f] = body[f];
    else if (!isCreate) row[f] = null;  // allow clearing FK on update
  }

  return row;
}

function hasOwn(body, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function setPatch(row, body, field, transform = (v) => v) {
  if (hasOwn(body, field)) row[field] = transform(body[field]);
}

function nullableText(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function buildPatchRow(body, userId) {
  const row = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  setPatch(row, body, 'item_name', v => String(v ?? '').trim());
  setPatch(row, body, 'is_active', v => Boolean(v));
  setPatch(row, body, 'barcode', nullableText);
  setPatch(row, body, 'hsn_code', nullableText);
  setPatch(row, body, 'description', nullableText);
  setPatch(row, body, 'notes', nullableText);
  setPatch(row, body, 'is_purchasable', v => Boolean(v));
  setPatch(row, body, 'is_sellable', v => Boolean(v));
  setPatch(row, body, 'is_manufactured', v => Boolean(v));
  setPatch(row, body, 'is_stocked', v => Boolean(v));
  setPatch(row, body, 'formulation_code', nullableText);
  setPatch(row, body, 'formulation_name', nullableText);
  setPatch(row, body, 'make_policy', nullableText);
  setPatch(row, body, 'planning_unit', nullableText);
  setPatch(row, body, 'stage_type', nullableText);
  setPatch(row, body, 'calculation_basis', nullableText);
  setPatch(row, body, 'weight_g', num);
  setPatch(row, body, 'preform_weight_g', num);
  setPatch(row, body, 'bp_weight_g', num);
  setPatch(row, body, 'default_pcs_per_tray', num);
  setPatch(row, body, 'default_pcs_per_crate', num);
  setPatch(row, body, 'pcs_per_set', num);
  setPatch(row, body, 'cavity_count', num);
  setPatch(row, body, 'grinder_category', nullableText);
  setPatch(row, body, 'length_mm', num);
  setPatch(row, body, 'width_mm', num);
  setPatch(row, body, 'thickness_mm', num);
  setPatch(row, body, 'qc_required', v => Boolean(v));
  setPatch(row, body, 'min_stock', num);
  setPatch(row, body, 'max_stock', num);
  setPatch(row, body, 'reorder_qty', num);
  setPatch(row, body, 'min_order_qty', num);
  setPatch(row, body, 'costing_method', nullableText);
  setPatch(row, body, 'standard_cost', num);
  setPatch(row, body, 'last_purchase_rate', num);
  setPatch(row, body, 'standard_rate', num);
  setPatch(row, body, 'drawing_no', nullableText);
  setPatch(row, body, 'item_image_url', nullableText);
  setPatch(row, body, 'drawing_image_url', nullableText);
  setPatch(row, body, 'drawing_pdf_url', nullableText);

  if (body.item_code?.trim()) row.item_code = body.item_code.trim().toUpperCase();

  for (const f of ['item_type_id','category_id','uom_id','purchase_uom_id','sales_uom_id','default_qc_type_id']) {
    if (hasOwn(body, f)) row[f] = body[f] || null;
  }

  return row;
}


// Helper: convert to number or null
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ─── 10G: Item ↔ Vehicle compatibility ───────────────────────────────────────

export async function getItemVehicles(itemId) {
  const { data, error } = await supabase
    .from('item_vehicle_compatibility')
    .select('id, vehicle_id, is_default, sort_order, vehicle_master ( id, vehicle_name, make )')
    .eq('item_id', itemId)
    .order('sort_order', { ascending: true });
  return error ? { data: null, error } : { data: data ?? [], error: null };
}

// Replace-all sync of an item's compatible vehicles. Enforces one default.
async function syncItemVehicles(itemId, vehicles) {
  await supabase.from('item_vehicle_compatibility').delete().eq('item_id', itemId);
  if (!Array.isArray(vehicles) || vehicles.length === 0) return;
  let defaultSeen = false;
  const rows = vehicles.filter(v => v && v.vehicle_id).map((v, i) => {
    const isDef = Boolean(v.is_default) && !defaultSeen;
    if (isDef) defaultSeen = true;
    return { item_id: itemId, vehicle_id: v.vehicle_id, is_default: isDef, sort_order: v.sort_order ?? i };
  });
  if (rows.length && !defaultSeen) rows[0].is_default = true;
  if (rows.length) await supabase.from('item_vehicle_compatibility').insert(rows);
}
