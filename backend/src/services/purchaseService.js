/**
 * CERADRIVE ERP — Purchase Service
 * Phase 9A: Read functions.
 * Phase 9B: Write functions added.
 *
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 *
 * FIX (500 error): PostgREST cannot auto-join database VIEWS via foreign key syntax.
 * v_po_receipt_summary and v_po_line_receipt_state are VIEWs — they have no FK constraints.
 * Fixed by removing view joins from .select() and fetching views as separate queries,
 * then merging results in the application layer using po_id as the join key.
 */

import { supabase }       from '../config/supabase.js';
import { getNextNumber }  from './numberSeriesService.js';
import { normalisePoLine } from '../validators/poLineValidator.js';
import { PO_STATUS }      from '../constants/statuses.js';


function pickAllowedFields(body, allowedFields) {
  const out = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body || {}, field)) {
      out[field] = body[field];
    }
  }

  return out;
}

// ─── Phase 9A — Read Functions ────────────────────────────────────────────────

export async function listPurchaseOrders(filters = {}) {
  const {
    status, supplier_id, date_from, date_to,
    derived_receipt_status, page = 1, limit = 20,
  } = filters;

  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  // Step 1: Fetch POs — supplier_master joined via FK (table, not view — safe)
  // v_po_receipt_summary removed from select(): it is a VIEW, PostgREST cannot
  // resolve a FK relationship to a view, causing a 500 error.
  let query = supabase
    .from('purchase_orders')
    .select(`
      id, po_number, po_date, expected_delivery, status,
      supplier_ref, notes, created_at,
      supplier_master ( id, supplier_name ), source_type, source_ref_id
    `, { count: 'exact' })
    .order('po_date',    { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (status)      query = query.eq('status',      status);
  if (supplier_id) query = query.eq('supplier_id', supplier_id);
  if (date_from)   query = query.gte('po_date',    date_from);
  if (date_to)     query = query.lte('po_date',    date_to);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  if (!data || data.length === 0) return { data: [], count: count ?? 0, error: null };

  // Step 2: Fetch v_po_receipt_summary separately for these POs
  // Direct query on the view with .in() — this works because we query the view
  // directly (not via FK join from another table).
  const poIds = data.map(po => po.id);
  const { data: summaries, error: summaryError } = await supabase
    .from('v_po_receipt_summary')
    .select('po_id, derived_receipt_status, total_lines, total_ordered, total_received')
    .in('po_id', poIds);

  // Summary fetch failure is non-fatal — PO list still returns without receipt status
  const summaryMap = {};
  if (!summaryError && summaries) {
    for (const s of summaries) {
      summaryMap[s.po_id] = s;
    }
  }

  // Step 3: Merge summary into PO rows
  const merged = data.map(po => ({
    ...po,
    v_po_receipt_summary: summaryMap[po.id] ?? null,
  }));

  // Step 4: Client-side filter by derived_receipt_status if requested
  let filtered = merged;
  if (derived_receipt_status) {
    filtered = merged.filter(
      po => po.v_po_receipt_summary?.derived_receipt_status === derived_receipt_status
    );
  }

  return { data: filtered, count: count ?? 0, error: null };
}

export async function getPurchaseOrderById(id) {
  // Step 1: Fetch PO header — supplier_master via FK (table, safe)
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select('*, supplier_master ( id, supplier_name, supplier_code )')
    .eq('id', id)
    .single();

  if (poError || !po) {
    return { data: null, error: poError ?? { message: 'Purchase Order not found.' } };
  }

  // Step 2: Fetch PO lines — item_master and uom_master via FK (tables, safe)
  // v_po_line_receipt_state removed: VIEW, cannot be FK-joined via PostgREST
  const { data: lines, error: linesError } = await supabase
    .from('po_lines')
    .select(`
      id, line_number, item_id, uom_id, ordered_qty, unit_rate,
      line_amount, tax_amount, line_total,
      tax_id, tax_name, tax_percent, notes,
      item_master ( id, item_code, item_name ),
      uom_master ( id, uom_code, uom_name )
    `)
    .eq('po_id', id)
    .order('line_number', { ascending: true });

  if (linesError) return { data: null, error: linesError };

  // Step 3: Fetch v_po_line_receipt_state separately (view — direct query)
  const lineIds = (lines ?? []).map(l => l.id);
  let lineStateMap = {};
  if (lineIds.length > 0) {
    const { data: lineStates } = await supabase
      .from('v_po_line_receipt_state')
      .select('po_line_id, received_qty, pending_qty, receipt_state')
      .in('po_line_id', lineIds);
    if (lineStates) {
      for (const ls of lineStates) {
        lineStateMap[ls.po_line_id] = ls;
      }
    }
  }

  // Step 4: Merge line state into lines
  const linesWithState = (lines ?? []).map(line => ({
    ...line,
    v_po_line_receipt_state: lineStateMap[line.id] ?? null,
  }));

  // Step 5: Fetch linked GRNs
  const { data: grns, error: grnsError } = await supabase
    .from('grn_headers')
    .select('id, grn_number, grn_date, status, is_direct_grn')
    .eq('po_id', id)
    .order('grn_date', { ascending: false });

  if (grnsError) return { data: null, error: grnsError };

  return {
    data: { ...po, lines: linesWithState, linked_grns: grns ?? [] },
    error: null,
  };
}

export async function getPOReceiptStatus(id) {
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status')
    .eq('id', id)
    .single();

  if (poError || !po) return { data: null, error: { message: 'Purchase Order not found.' } };

  // Direct view queries (not FK joins) — these work correctly
  const { data: summary, error: summaryError } = await supabase
    .from('v_po_receipt_summary')
    .select('*')
    .eq('po_id', id)
    .maybeSingle();

  if (summaryError) return { data: null, error: summaryError };

  const { data: lineStates, error: lineStatesError } = await supabase
    .from('v_po_line_receipt_state')
    .select('*')
    .eq('po_id', id)
    .order('po_line_id', { ascending: true });

  if (lineStatesError) return { data: null, error: lineStatesError };

  return {
    data: {
      po_id:       id,
      po_number:   po.po_number,
      status:      po.status,
      summary:     summary    ?? null,
      line_states: lineStates ?? [],
    },
    error: null,
  };
}

// ─── Phase 9B — Write Functions ───────────────────────────────────────────────

export async function createPurchaseOrder(body, userId) {
  let poNumber;
  try {
    poNumber = await getNextNumber('PO');
  } catch (err) {
    return { data: null, error: err };
  }

  const { lines = [], ...header } = body;

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      po_number:         poNumber,
      supplier_id:       header.supplier_id,
      po_date:           header.po_date,
      expected_delivery: header.expected_delivery ?? null,
      supplier_ref:      header.supplier_ref      ?? null,
      notes:             header.notes             ?? null,
      status:            PO_STATUS.DRAFT,
      created_by:        userId,
    })
    .select('*')
    .single();

  if (poError) return { data: null, error: poError };

  if (lines.length > 0) {
    const lineRows = lines.map((line, i) => ({
      po_id: po.id,
      ...normalisePoLine(line, i + 1),
    }));

    const { error: linesError } = await supabase
      .from('po_lines')
      .insert(lineRows);

    if (linesError) {
      await supabase.from('po_lines').delete().eq('po_id', po.id);
      await supabase.from('purchase_orders').delete().eq('id', po.id);
      return { data: null, error: linesError };
    }
  }

  return { data: { ...po, lines }, error: null };
}

export async function updateDraftPO(id, body) {
  const { lines } = body;
  const headerFields = pickAllowedFields(body, [
    'supplier_id',
    'po_date',
    'expected_delivery',
    'supplier_ref',
    'notes',
  ]);

  if (Object.keys(headerFields).length > 0) {
    const { error: headerError } = await supabase
      .from('purchase_orders')
      .update(headerFields)
      .eq('id', id);

    if (headerError) return { data: null, error: headerError };
  }

  if (lines) {
    if (lines.add?.length > 0) {
      const { data: existing } = await supabase
        .from('po_lines')
        .select('line_number')
        .eq('po_id', id)
        .order('line_number', { ascending: false })
        .limit(1);

      let nextLineNum = (existing?.[0]?.line_number ?? 0) + 1;
      const newRows = lines.add.map((line) => ({
        po_id: id,
        ...normalisePoLine(line, nextLineNum++),
      }));

      const { error } = await supabase.from('po_lines').insert(newRows);
      if (error) return { data: null, error };
    }

    if (lines.update?.length > 0) {
      for (const line of lines.update) {
        const { id: lineId, line_number, ...fields } = line;
        const { error } = await supabase
          .from('po_lines')
          .update(normalisePoLine(fields, line_number))
          .eq('id', lineId)
          .eq('po_id', id);
        if (error) return { data: null, error };
      }
    }

    if (lines.remove?.length > 0) {
      const { error } = await supabase
        .from('po_lines')
        .delete()
        .in('id', lines.remove)
        .eq('po_id', id);
      if (error) return { data: null, error };
    }
  }

  return getPurchaseOrderById(id);
}

export async function updateApprovedPO(id, body) {
  const headerFields = pickAllowedFields(body, [
    'expected_delivery',
    'supplier_ref',
    'notes',
  ]);

  if (!Object.keys(headerFields).length) {
    return getPurchaseOrderById(id);
  }

  const { error } = await supabase
    .from('purchase_orders')
    .update(headerFields)
    .eq('id', id);

  if (error) return { data: null, error };
  return getPurchaseOrderById(id);
}


export async function createGRNFromPurchaseOrder(poId, payload, userId) {
  // GRN2B-NEXT: create the NEXT GRN for PENDING qty only. Blocks only when an open
  // draft GRN exists; posted GRNs do not block. Skips fully/over-received lines.
  const warehouseId = payload?.warehouse_id;
  if (!warehouseId) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', status: 400, message: 'warehouse_id is required.' },
    };
  }

  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, supplier_id, status')
    .eq('id', poId)
    .single();

  if (poErr || !po) {
    return { data: null, error: { code: 'NOT_FOUND', status: 404, message: 'Purchase Order not found.' } };
  }

  if (po.status !== 'approved') {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', status: 400, message: 'Only approved Purchase Orders can create GRN.' },
    };
  }

  // GRN2B-NEXT: block only when an OPEN DRAFT GRN exists (no overlapping drafts).
  const { data: openDrafts, error: draftErr } = await supabase
    .from('grn_headers')
    .select('id, grn_number, status')
    .eq('po_id', poId)
    .eq('status', 'draft')
    .limit(1);

  if (draftErr) return { data: null, error: draftErr };

  if (openDrafts?.length) {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        status: 409,
        message: `An open draft GRN already exists for this PO: ${openDrafts[0].grn_number}. Post or cancel it before creating the next GRN.`,
      },
    };
  }

  const { data: lines, error: lineErr } = await supabase
    .from('po_lines')
    .select('id, item_id, uom_id, ordered_qty, unit_rate, tax_id, tax_name, tax_percent, tax_amount, line_number')
    .eq('po_id', poId)
    .order('line_number', { ascending: true });

  if (lineErr) return { data: null, error: lineErr };

  // GRN2B-NEXT: receive PENDING qty only. pending_qty from v_po_line_receipt_state
  // counts POSTED GRNs only — accurate because open drafts are blocked above.
  const lineIds = (lines ?? []).map((l) => l.id);
  const pendingById = {};
  if (lineIds.length) {
    const { data: states, error: stateErr } = await supabase
      .from('v_po_line_receipt_state')
      .select('po_line_id, pending_qty')
      .in('po_line_id', lineIds);
    if (stateErr) return { data: null, error: stateErr };
    for (const s of states ?? []) pendingById[s.po_line_id] = Number(s.pending_qty);
  }

  // pending = view value if a row exists, else full ordered_qty (no posted receipts yet).
  const pendingLines = (lines ?? [])
    .map((l) => {
      const p = (pendingById[l.id] !== undefined && pendingById[l.id] !== null)
        ? pendingById[l.id]
        : Number(l.ordered_qty);
      return { l, pending: p };
    })
    .filter((x) => x.pending > 0);

  if (!pendingLines.length) {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        status: 409,
        message: 'No pending quantity to receive on this PO. All lines are already fully (or over) received.',
      },
    };
  }

  const grnService = await import('./grnService.js');

  const grnPayload = {
    supplier_id: po.supplier_id,
    warehouse_id: warehouseId,
    grn_date: payload.grn_date ?? new Date().toISOString().slice(0, 10),
    is_direct_grn: false,
    po_id: po.id,
    supplier_challan: payload.supplier_challan ?? null,
    supplier_invoice: payload.supplier_invoice ?? null,
    notes: payload.notes ?? `Draft GRN created from ${po.po_number}`,
    lines: pendingLines.map(({ l, pending }) => ({
      po_line_id: l.id,
      item_id: l.item_id,
      uom_id: l.uom_id,
      received_qty: pending,
      unit_rate: Number(l.unit_rate ?? 0),
      tax_id: l.tax_id ?? null,
      tax_name: l.tax_name ?? null,
      tax_percent: l.tax_percent ?? null,
      tax_amount: Number(l.tax_amount ?? 0),
      notes: `From ${po.po_number} (pending)`,
    })),
  };

  return grnService.createGRN(grnPayload, userId);
}



export async function postDraftGRNForPurchaseOrder(poId, userId) {
  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status')
    .eq('id', poId)
    .single();

  if (poErr || !po) {
    return { data: null, error: { code: 'NOT_FOUND', status: 404, message: 'Purchase Order not found.' } };
  }

  if (po.status !== 'approved') {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', status: 400, message: 'Only approved Purchase Orders can post GRN.' },
    };
  }

  const { data: grns, error: grnErr } = await supabase
    .from('grn_headers')
    .select('id, grn_number, status')
    .eq('po_id', poId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  if (grnErr) return { data: null, error: grnErr };

  if (!grns?.length) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', status: 404, message: 'No draft GRN found for this PO.' },
    };
  }

  const inventoryPostingService = await import('./inventoryPostingService.js');
  return inventoryPostingService.postGRN(grns[0].id, userId);
}


export async function approvePurchaseOrder(id, userId) {
  const { count, error: countError } = await supabase
    .from('po_lines')
    .select('id', { count: 'exact', head: true })
    .eq('po_id', id);

  if (countError) return { data: null, error: countError };

  if (count === 0) {
    throw {
      code:    'CONFLICT',
      message: 'A Purchase Order must have at least one line before it can be approved.',
    };
  }

  const { error } = await supabase
    .from('purchase_orders')
    .update({
      status:      PO_STATUS.APPROVED,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { data: null, error };
  return getPurchaseOrderById(id);
}

export async function closePurchaseOrder(id, confirmShortClose, reason = null, userId = null) {
  // POSHORTCLOSE: block close while an OPEN DRAFT GRN exists — resolve it first.
  const { data: openDrafts, error: draftErr } = await supabase
    .from('grn_headers')
    .select('id, grn_number')
    .eq('po_id', id)
    .eq('status', 'draft')
    .limit(1);

  if (draftErr) return { data: null, error: draftErr };

  if (openDrafts?.length) {
    throw {
      code: 'CONFLICT',
      message: `An open draft GRN (${openDrafts[0].grn_number}) exists for this PO. ` +
               'Cancel or post it before closing the PO short.',
      details: [{ field: 'draft_grn', grn_number: openDrafts[0].grn_number }],
    };
  }

  const { data: summary, error: viewError } = await supabase
    .from('v_po_receipt_summary')
    .select('derived_receipt_status')
    .eq('po_id', id)
    .maybeSingle();

  if (viewError) return { data: null, error: viewError };

  const receiptStatus   = summary?.derived_receipt_status ?? 'pending';
  const isFullyReceived = receiptStatus === 'full' || receiptStatus === 'excess';

  if (!isFullyReceived && !confirmShortClose) {
    throw {
      code:    'CONFLICT',
      message: 'One or more lines have not been fully received. ' +
               'Set confirm_short_close: true to close anyway.',
      details: [{ field: 'confirm_short_close', receipt_status: receiptStatus }],
    };
  }

  // POSHORTCLOSE: a short-close must carry a reason (validator also enforces this).
  const isShortClose = !isFullyReceived;
  if (isShortClose && (!reason || String(reason).trim().length < 5)) {
    throw {
      code: 'VALIDATION_ERROR',
      message: 'A reason (min 5 characters) is required to short-close a Purchase Order.',
      details: [{ field: 'reason' }],
    };
  }

  // Status + audit only. No inventory posting. Receipt views are status-independent,
  // so ordered/received/pending stay visible after close.
  const update = {
    status:    PO_STATUS.CLOSED,
    closed_by: userId,
    closed_at: new Date().toISOString(),
  };
  if (isShortClose) update.short_close_reason = String(reason).trim();

  const { error } = await supabase
    .from('purchase_orders')
    .update(update)
    .eq('id', id);

  if (error) return { data: null, error };
  return getPurchaseOrderById(id);
}

export async function cancelPurchaseOrder(id, userId, cancellationReason) {
  const { data: postedGRNs, error: grnError } = await supabase
    .from('grn_headers')
    .select('id, grn_number')
    .eq('po_id', id)
    .eq('status', 'posted');

  if (grnError) return { data: null, error: grnError };

  const { error } = await supabase
    .from('purchase_orders')
    .update({
      status:              PO_STATUS.CANCELLED,
      cancelled_by:        userId,
      cancelled_at:        new Date().toISOString(),
      cancellation_reason: cancellationReason,
    })
    .eq('id', id);

  if (error) return { data: null, error };

  const { data: po } = await getPurchaseOrderById(id);
  return {
    data: {
      ...po,
      posted_grns_warning: postedGRNs?.length > 0
        ? {
            message: 'There are posted GRNs against this PO. ' +
                     'Cancelling the PO does not reverse received stock.',
            grns: postedGRNs,
          }
        : null,
    },
    error: null,
  };
}
