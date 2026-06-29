/**
 * CERADRIVE ERP — Purchase Bill Service (PB-1)
 *
 * Create a DRAFT Purchase Bill from a POSTED GRN. Snapshot only:
 *   bill line qty       <- grn_lines.received_qty   (LOCKED in PB-1; edit = PB-2)
 *   bill line unit_rate <- grn_lines.unit_rate      (edit = PB-2)
 *   amounts/tax/totals  <- snapshot from grn_lines
 *
 * Guards (PB-1):
 *   - GRN must be status='posted'.
 *   - One GRN = one non-cancelled Bill: block if a Bill exists for the GRN
 *     whose status <> 'cancelled'.
 *
 * Does NOT post inventory. Does NOT write any AP/payable ledger. Does NOT
 * touch grn_headers / grn_lines / inventory_balance. Status is always 'draft'.
 *
 * Pattern: returns { data, error } — no HTTP knowledge.
 */

import { supabase } from '../config/supabase.js';
import { getNextNumber } from './numberSeriesService.js';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get full Purchase Bill detail: header + lines.
 * @param {string} id - purchase_bill_headers UUID
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function getBillById(id) {
  const { data: bill, error: bErr } = await supabase
    .from('purchase_bill_headers')
    .select(`
      *,
      supplier_master ( id, supplier_name, supplier_code ),
      purchase_orders ( id, po_number ),
      grn_headers     ( id, grn_number, status )
    `)
    .eq('id', id)
    .single();

  if (bErr || !bill) {
    return { data: null, error: bErr ?? { code: 'NOT_FOUND', message: 'Purchase Bill not found.' } };
  }

  const { data: lines, error: lErr } = await supabase
    .from('purchase_bill_lines')
    .select(`
      id,
      line_number,
      grn_line_id,
      item_id,
      uom_id,
      qty,
      unit_rate,
      line_amount,
      tax_id,
      tax_name,
      tax_percent,
      tax_amount,
      line_total,
      created_at,
      updated_at,
      item_master ( id, item_code, item_name ),
      uom_master  ( id, uom_code,  uom_name  )
    `)
    .eq('bill_id', id)
    .order('line_number', { ascending: true });

  if (lErr) return { data: null, error: lErr };

  return { data: { ...bill, lines: lines ?? [] }, error: null };
}

/**
 * List Purchase Bills (header summary). Filters: supplier_id, grn_id, status.
 * @returns {Promise<{ data: object[]|null, count: number|null, error: object|null }>}
 */
export async function listPurchaseBills(filters = {}) {
  const { supplier_id, grn_id, status, page = 1, limit = 20 } = filters;

  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('purchase_bill_headers')
    .select(`
      id,
      bill_number,
      bill_date,
      status,
      supplier_invoice_no,
      grand_total,
      created_at,
      grn_id,
      po_id,
      supplier_master ( id, supplier_name, supplier_code ),
      grn_headers     ( id, grn_number ),
      purchase_orders ( id, po_number )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (supplier_id) query = query.eq('supplier_id', supplier_id);
  if (grn_id)      query = query.eq('grn_id', grn_id);
  if (status)      query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };

  return { data: data ?? [], count, error: null };
}

// ─── PB-1 — Create Draft from posted GRN ──────────────────────────────────────

/**
 * Create a DRAFT Purchase Bill from a POSTED GRN.
 * @param {string} grnId  - grn_headers UUID
 * @param {string} userId - acting user id (created_by)
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function createBillFromGRN(grnId, userId) {
  // 1. Load GRN header — must exist and be POSTED.
  const { data: grn, error: gErr } = await supabase
    .from('grn_headers')
    .select('id, grn_number, status, supplier_id, po_id, supplier_invoice, grn_date')
    .eq('id', grnId)
    .single();

  if (gErr || !grn) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'GRN not found.' } };
  }
  if (grn.status !== 'posted') {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        message: `GRN ${grn.grn_number} is ${grn.status}; only a posted GRN can create a Purchase Bill.`,
      },
    };
  }

  // 2. Block if a non-cancelled Bill already exists for this GRN (one GRN = one active Bill).
  const { data: existing, error: exErr } = await supabase
    .from('purchase_bill_headers')
    .select('id, bill_number, status')
    .eq('grn_id', grnId)
    .neq('status', 'cancelled')
    .limit(1);

  if (exErr) return { data: null, error: exErr };
  if (existing?.length) {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        message: `A non-cancelled Purchase Bill (${existing[0].bill_number}) already exists for GRN ${grn.grn_number}. Cancel it before creating another.`,
      },
    };
  }

  // 3. Load GRN lines — snapshot source.
  const { data: grnLines, error: lErr } = await supabase
    .from('grn_lines')
    .select('id, line_number, item_id, uom_id, received_qty, unit_rate, line_amount, tax_id, tax_name, tax_percent, tax_amount, line_total')
    .eq('grn_id', grnId)
    .order('line_number', { ascending: true });

  if (lErr) return { data: null, error: lErr };
  if (!grnLines?.length) {
    return {
      data: null,
      error: { code: 'CONFLICT', message: `GRN ${grn.grn_number} has no lines to bill.` },
    };
  }

  // 4. Build bill lines from the GRN snapshot + roll up header totals.
  let subtotal = 0, taxTotal = 0, grandTotal = 0;

  const billLineDraft = grnLines.map((l, idx) => {
    const qty       = Number(l.received_qty || 0);   // LOCKED: qty = received_qty
    const unitRate  = Number(l.unit_rate || 0);      //         rate = unit_rate
    const lineAmt   = (l.line_amount !== null && l.line_amount !== undefined)
      ? roundMoney(l.line_amount)
      : roundMoney(qty * unitRate);
    const taxAmt    = roundMoney(l.tax_amount ?? 0);
    const lineTotal = (l.line_total !== null && l.line_total !== undefined)
      ? roundMoney(l.line_total)
      : roundMoney(lineAmt + taxAmt);

    subtotal   += lineAmt;
    taxTotal   += taxAmt;
    grandTotal += lineTotal;

    return {
      grn_line_id: l.id,
      line_number: l.line_number ?? (idx + 1),
      item_id:     l.item_id,
      uom_id:      l.uom_id,
      qty,
      unit_rate:   unitRate,
      line_amount: lineAmt,
      tax_id:      l.tax_id ?? null,
      tax_name:    l.tax_name ?? null,
      tax_percent: l.tax_percent ?? null,
      tax_amount:  taxAmt,
      line_total:  lineTotal,
    };
  });

  subtotal   = roundMoney(subtotal);
  taxTotal   = roundMoney(taxTotal);
  grandTotal = roundMoney(grandTotal);

  // 5. Bill number.
  let bill_number;
  try {
    bill_number = await getNextNumber('PBILL');
  } catch (e) {
    return { data: null, error: { code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? 'Number series error.' } };
  }

  // 6. Insert header (status = draft; no inventory, no AP).
  const { data: header, error: hErr } = await supabase
    .from('purchase_bill_headers')
    .insert({
      bill_number,
      supplier_id:         grn.supplier_id,
      po_id:               grn.po_id ?? null,
      grn_id:              grn.id,
      supplier_invoice_no: grn.supplier_invoice ?? null,
      bill_date:           new Date().toISOString().slice(0, 10),
      status:              'draft',
      subtotal,
      tax_total:           taxTotal,
      grand_total:         grandTotal,
      created_by:          userId,
    })
    .select('id')
    .single();

  if (hErr || !header) {
    return { data: null, error: hErr ?? { code: 'INTERNAL_ERROR', message: 'Failed to create Purchase Bill header.' } };
  }

  // 7. Insert lines. Compensating cleanup on failure — no orphan header.
  const lineRows = billLineDraft.map((l) => ({ ...l, bill_id: header.id }));
  const { error: linsErr } = await supabase.from('purchase_bill_lines').insert(lineRows);

  if (linsErr) {
    await supabase.from('purchase_bill_headers').delete().eq('id', header.id);
    return { data: null, error: linsErr };
  }

  // 8. Return the freshly created draft Bill.
  return getBillById(header.id);
}

// ─── PB-3 — Status-only approval ─────────────────────────────────────────────

/**
 * Approve a DRAFT Purchase Bill. Status-only for PB-3:
 *   - draft -> approved
 *   - updates updated_by / updated_at
 *   - no AP/payable ledger, no inventory, no GRN/PO mutation
 * @param {string} id     - purchase_bill_headers UUID
 * @param {string} userId - acting user id
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
export async function approveBill(id, userId) {
  const { data: bill, error: bErr } = await supabase
    .from('purchase_bill_headers')
    .select('id, bill_number, status')
    .eq('id', id)
    .single();

  if (bErr || !bill) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Purchase Bill not found.' } };
  }

  if (bill.status !== 'draft') {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        message: `Purchase Bill ${bill.bill_number} is ${bill.status}; only draft bills can be approved.`,
      },
    };
  }

  const { data: lines, error: lErr } = await supabase
    .from('purchase_bill_lines')
    .select('id')
    .eq('bill_id', id)
    .limit(1);

  if (lErr) return { data: null, error: lErr };
  if (!lines?.length) {
    return {
      data: null,
      error: { code: 'CONFLICT', message: `Purchase Bill ${bill.bill_number} has no lines to approve.` },
    };
  }

  const { error: uErr } = await supabase
    .from('purchase_bill_headers')
    .update({
      status: 'approved',
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'draft');

  if (uErr) return { data: null, error: uErr };

  return getBillById(id);
}
