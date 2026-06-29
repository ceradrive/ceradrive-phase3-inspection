/**
 * CERADRIVE ERP — GRN Service
 *
 * All GRN database queries.
 * Phase 9A: Read functions only.
 * Phase 9D: Draft write functions added.
 * Phase 9E: Post and cancel transaction functions added.
 * GRN1-DRAFT-EDIT: updateGRN — draft-only line edit (received_qty + unit_rate).
 *
 * Pattern: returns { data, error } — no HTTP knowledge.
 */

import { supabase } from '../config/supabase.js';
import { getNextNumber } from './numberSeriesService.js';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function calculateGRNLineAmounts(line) {
  const receivedQty = Number(line.received_qty || 0);
  const unitRate = Number(line.unit_rate || 0);
  const lineAmount = roundMoney(receivedQty * unitRate);

  const hasTaxPercent = line.tax_percent !== undefined && line.tax_percent !== null && line.tax_percent !== '';
  const taxAmount = hasTaxPercent
    ? roundMoney(lineAmount * (Number(line.tax_percent || 0) / 100))
    : roundMoney(line.tax_amount ?? 0);

  return {
    line_amount: lineAmount,
    tax_amount: taxAmount,
    line_total: roundMoney(lineAmount + taxAmount),
  };
}

// ─── Phase 9A — Read Functions ────────────────────────────────────────────────

/**
 * List GRNs with supplier name, warehouse name, and linked PO number.
 *
 * @param {object} filters
 * @param {string}  [filters.status]
 * @param {boolean} [filters.is_direct_grn]
 * @param {string}  [filters.supplier_id]
 * @param {string}  [filters.warehouse_id]
 * @param {string}  [filters.po_id]
 * @param {string}  [filters.date_from]    - grn_date >=
 * @param {string}  [filters.date_to]      - grn_date <=
 * @param {number}  [filters.page]
 * @param {number}  [filters.limit]
 *
 * @returns {Promise<{ data: object[]|null, count: number|null, error: object|null }>}
 */
export async function listGRNs(filters = {}) {
  const {
    status,
    is_direct_grn,
    supplier_id,
    warehouse_id,
    po_id,
    date_from,
    date_to,
    page  = 1,
    limit = 20,
  } = filters;

  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('grn_headers')
    .select(`
      id,
      grn_number,
      grn_date,
      status,
      is_direct_grn,
      supplier_challan,
      supplier_invoice,
      created_at,
      po_id,
      supplier_master  ( id, supplier_name, supplier_code ),
      warehouse_master ( id, warehouse_name, warehouse_code ),
      purchase_orders  ( id, po_number )
    `, { count: 'exact' })
    .order('grn_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (status)       query = query.eq('status', status);
  if (supplier_id)  query = query.eq('supplier_id', supplier_id);
  if (warehouse_id) query = query.eq('warehouse_id', warehouse_id);
  if (po_id)        query = query.eq('po_id', po_id);
  if (date_from)    query = query.gte('grn_date', date_from);
  if (date_to)      query = query.lte('grn_date', date_to);

  // Boolean filter — only apply if explicitly provided
  if (is_direct_grn !== undefined && is_direct_grn !== null) {
    query = query.eq('is_direct_grn', is_direct_grn === 'true' || is_direct_grn === true);
  }

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };

  return { data: data ?? [], count, error: null };
}

/**
 * Get full GRN detail: header + lines + linked PO summary.
 *
 * ledger_entry_id is included as a boolean indicator (is_posted) in the
 * response — the raw UUID is not exposed unless needed by internal processing.
 *
 * @param {string} id - GRN header UUID
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getGRNById(id) {
  const { data: grn, error: grnError } = await supabase
    .from('grn_headers')
    .select(`
      *,
      supplier_master  ( id, supplier_name, supplier_code ),
      warehouse_master ( id, warehouse_name, warehouse_code ),
      purchase_orders  ( id, po_number, status )
    `)
    .eq('id', id)
    .single();

  if (grnError || !grn) {
    return { data: null, error: grnError ?? { message: 'GRN not found.' } };
  }

  // Fetch GRN lines
  const { data: lines, error: linesError } = await supabase
    .from('grn_lines')
    .select(`
      id,
      line_number,
      po_line_id,
      item_id,
      uom_id,
      received_qty,
      unit_rate,
      line_amount,
      tax_id,
      tax_name,
      tax_percent,
      tax_amount,
      line_total,
      notes,
      created_at,
      updated_at,
      ledger_entry_id,
      item_master ( id, item_code, item_name ),
      uom_master  ( id, uom_code,  uom_name  )
    `)
    .eq('grn_id', id)
    .order('line_number', { ascending: true });

  if (linesError) {
    return { data: null, error: linesError };
  }

  // Transform lines: add is_posted indicator, keep ledger_entry_id for internal use
  const transformedLines = (lines ?? []).map((line) => ({
    ...line,
    is_posted: !!line.ledger_entry_id,
  }));

  return {
    data: {
      ...grn,
      lines: transformedLines,
    },
    error: null,
  };
}

/**
 * Get GRN line detail from v_grn_line_detail view.
 *
 * @param {string} grnId - GRN header UUID
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
export async function getGRNLineDetail(grnId) {
  // First confirm GRN exists
  const { data: grn, error: grnError } = await supabase
    .from('grn_headers')
    .select('id, grn_number')
    .eq('id', grnId)
    .single();

  if (grnError || !grn) {
    return { data: null, error: { message: 'GRN not found.' } };
  }

  const { data, error } = await supabase
    .from('v_grn_line_detail')
    .select('*')
    .eq('grn_id', grnId)
    .order('line_number', { ascending: true });

  if (error) return { data: null, error };

  return { data: data ?? [], error: null };
}

// ─── Phase 9G — Draft Create ──────────────────────────────────────────────────

/**
 * Create a DRAFT GRN (header + lines). No inventory posting.
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function createGRN(payload, userId) {
  let grn_number;
  try {
    grn_number = await getNextNumber('GRN');
  } catch (e) {
    return { data: null, error: { code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? 'Number series error.' } };
  }

  const { data: header, error: hErr } = await supabase
    .from('grn_headers')
    .insert({
      grn_number,
      supplier_id:      payload.supplier_id,
      warehouse_id:     payload.warehouse_id,
      grn_date:         payload.grn_date,
      is_direct_grn:    payload.is_direct_grn,
      po_id:            payload.is_direct_grn ? null : payload.po_id,
      supplier_challan: payload.supplier_challan ?? null,
      supplier_invoice: payload.supplier_invoice ?? null,
      notes:            payload.notes ?? null,
      status:           'draft',
      created_by:       userId,
    })
    .select('id')
    .single();

  if (hErr || !header) return { data: null, error: hErr ?? { message: 'Failed to create GRN header.' } };

  const lineRows = payload.lines.map((l, idx) => {
    const amounts = calculateGRNLineAmounts(l);

    return {
      grn_id:       header.id,
      line_number:  idx + 1,
      po_line_id:   payload.is_direct_grn ? null : (l.po_line_id ?? null),
      item_id:      l.item_id,
      uom_id:       l.uom_id,
      received_qty: l.received_qty,
      unit_rate:    l.unit_rate,
      line_amount:  amounts.line_amount,
      tax_id:       l.tax_id ?? null,
      tax_name:     l.tax_name ?? null,
      tax_percent:  l.tax_percent ?? null,
      tax_amount:   amounts.tax_amount,
      line_total:   amounts.line_total,
      notes:        l.notes ?? null,
    };
  });

  const { error: lErr } = await supabase.from('grn_lines').insert(lineRows);
  if (lErr) {
    // compensating cleanup — keep no orphan header
    await supabase.from('grn_headers').delete().eq('id', header.id);
    return { data: null, error: lErr };
  }

  return getGRNById(header.id);
}

// ─── GRN1-DRAFT-EDIT — Draft Update (received_qty + unit_rate only) ────────────

/**
 * Update a DRAFT GRN's line received_qty and unit_rate only. Draft-only.
 * Recalculates line_amount / tax_amount / line_total from the existing tax fields.
 * Does NOT touch headers, does NOT add/remove lines, does NOT post inventory.
 * Idempotent at the DB level (plain UPDATE). Returns the refreshed GRN.
 *
 * @param {string} id      - GRN header UUID
 * @param {object} payload - { lines: [{ id, received_qty, unit_rate }] }
 * @param {string} userId  - acting user id (for updated_by audit if present)
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function updateGRN(id, payload, userId) {
  // Re-verify the header is still draft (route guard also enforces this; this is
  // a defence-in-depth check against a race between guard load and write).
  const { data: hdr, error: hErr } = await supabase
    .from('grn_headers')
    .select('id, status')
    .eq('id', id)
    .single();

  if (hErr || !hdr) {
    return { data: null, error: hErr ?? { code: 'NOT_FOUND', message: 'GRN not found.' } };
  }
  if (hdr.status !== 'draft') {
    return {
      data: null,
      error: { code: 'CONFLICT', message: `GRN is ${hdr.status}; only draft GRNs can be edited.` },
    };
  }

  // Load the GRN's existing lines to (a) validate ownership of each supplied id and
  // (b) carry the existing tax fields into the amount recalculation.
  const { data: existing, error: exErr } = await supabase
    .from('grn_lines')
    .select('id, tax_percent, tax_amount')
    .eq('grn_id', id);

  if (exErr) return { data: null, error: exErr };

  const byId = new Map((existing ?? []).map((l) => [l.id, l]));

  for (const ln of payload.lines) {
    if (!byId.has(ln.id)) {
      return {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: `Line ${ln.id} does not belong to this GRN.` },
      };
    }
  }

  const nowIso = new Date().toISOString();

  // Per-line update: only received_qty + unit_rate change; amounts recalculated.
  for (const ln of payload.lines) {
    const base    = byId.get(ln.id);
    const amounts = calculateGRNLineAmounts({
      received_qty: ln.received_qty,
      unit_rate:    ln.unit_rate,
      tax_percent:  base.tax_percent,
      tax_amount:   base.tax_amount,
    });

    const { error: upErr } = await supabase
      .from('grn_lines')
      .update({
        received_qty: ln.received_qty,
        unit_rate:    ln.unit_rate,
        line_amount:  amounts.line_amount,
        tax_amount:   amounts.tax_amount,
        line_total:   amounts.line_total,
        updated_at:   nowIso,
      })
      .eq('id', ln.id)
      .eq('grn_id', id);

    if (upErr) return { data: null, error: upErr };
  }

  return getGRNById(id);
}

// ─── GRNDRAFTCANCEL — Draft discard (status-only; no inventory) ────────────────

/**
 * Soft-cancel a DRAFT GRN: status -> 'cancelled' + audit. Draft-only.
 * No inventory, no fn_cancel_grn. Reason optional. Returns the refreshed GRN.
 */
export async function cancelDraftGRN(id, userId, reason = null) {
  const { data: hdr, error: hErr } = await supabase
    .from('grn_headers')
    .select('id, status, grn_number')
    .eq('id', id)
    .single();

  if (hErr || !hdr) {
    return { data: null, error: hErr ?? { code: 'NOT_FOUND', message: 'GRN not found.' } };
  }
  if (hdr.status !== 'draft') {
    return {
      data: null,
      error: { code: 'CONFLICT', message: `GRN ${hdr.grn_number} is ${hdr.status}; only a draft GRN can be discarded.` },
    };
  }

  const trimmed = reason && String(reason).trim() ? String(reason).trim() : null;
  const nowIso  = new Date().toISOString();

  const { error: upErr } = await supabase
    .from('grn_headers')
    .update({
      status:              'cancelled',
      cancelled_by:        userId,
      cancelled_at:        nowIso,
      cancellation_reason: trimmed,
      updated_at:          nowIso,
    })
    .eq('id', id)
    .eq('status', 'draft');   // race guard: only flips while still draft

  if (upErr) return { data: null, error: upErr };
  return getGRNById(id);
}
