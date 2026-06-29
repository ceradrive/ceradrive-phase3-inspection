/**
 * CERADRIVE ERP — Sales Invoice Service (SI-1a)
 *
 * READ-ONLY invoice preview (Sale Bill) from an APPROVED sales order.
 * Direct flow: Sales Order -> Sales Invoice. No dispatch. No DB write, no inventory, no schema.
 * Copies SO line pricing/tax 1:1 into proposed invoice lines + computes totals.
 *
 * Verified columns (SD-1B source audit):
 *   sales_order_headers: id, so_number, customer_id, status('approved'), so_date, delivery_date
 *   sales_order_lines:   id, line_number, so_id, item_id, uom_id, qty,
 *                        unit_rate, discount_percent, discount_amount,
 *                        tax_id, tax_percent, tax_amount, line_total
 *   item_master:         id, hsn_code        warehouse_master: id, warehouse_code ('FG-STORE')
 *
 * Returns { data, error } (service convention).
 */
import { supabase } from '../config/supabase.js';
import { getNextNumber } from './numberSeriesService.js';
import { FEATURE_FLAGS } from '../config/featureFlags.js';

const INVOICE_SERIES_KEY = 'SINV';

// Commit gate: committed default false. Enable per-run via env for trials only.
function invoiceCommitEnabled() {
  return (FEATURE_FLAGS && FEATURE_FLAGS.sales_invoice_commit_enabled === true)
      || process.env.SALES_INVOICE_COMMIT_ENABLED === 'true';
}

// SI-5 deduction gate: committed default false. Even when true, no write happens unless the
// canonical RPC fn_post_sales_invoice exists (else POST_RPC_MISSING). Enable per-run via env.
function invoicePostEnabled() {
  return (FEATURE_FLAGS && FEATURE_FLAGS.sales_invoice_post_enabled === true)
      || process.env.SALES_INVOICE_POST_ENABLED === 'true';
}

const FG_WAREHOUSE_CODE = 'FG-STORE';

const NOT_WRITTEN = Object.freeze([
  'sales_invoice_headers', 'sales_invoice_lines',
  'inventory_ledger', 'inventory_balance',
  'sales_order_headers', 'sales_order_lines',
]);

function n2(v) { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0; }

export async function previewInvoiceFromSO(soId) {
  if (!soId) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'soId is required.' } };

  // 1) SO header (read-only)
  const { data: so, error: soErr } = await supabase
    .from('sales_order_headers')
    .select('id, so_number, customer_id, status, so_date, delivery_date')
    .eq('id', soId)
    .single();
  if (soErr || !so) return { data: null, error: soErr ?? { code: 'NOT_FOUND', message: 'Sales order not found.' } };

  const blocks = [];
  const status = String(so.status || '').toLowerCase();
  if (status !== 'approved') {
    blocks.push({ code: 'SO_NOT_APPROVED', message: `Sales order status is '${status || 'unknown'}'. Only approved sales orders can be invoiced.` });
  }

  // 2) lines by so_id, with pricing/tax (read-only)
  const { data: rawLines, error: lErr } = await supabase
    .from('sales_order_lines')
    .select('id, line_number, item_id, uom_id, qty, unit_rate, discount_percent, discount_amount, tax_id, tax_percent, tax_amount, line_total')
    .eq('so_id', soId)
    .order('line_number', { ascending: true });
  if (lErr) return { data: null, error: { code: lErr.code || 'INTERNAL_ERROR', message: lErr.message } };

  const lines = rawLines || [];
  if (!lines.length) blocks.push({ code: 'NO_LINES', message: 'Sales order has no lines to invoice.' });

  const invoiceable = lines.filter((l) => l.item_id && Number(l.qty) > 0);
  if (lines.length && !invoiceable.length) {
    blocks.push({ code: 'NO_INVOICEABLE_QTY', message: 'No line has a positive quantity / item to invoice.' });
  }

  // 3) uom guard — invoice line uom_id is NOT NULL downstream
  const uomMissing = invoiceable.filter((l) => !l.uom_id).map((l) => l.line_number);
  if (uomMissing.length) {
    blocks.push({ code: 'LINE_UOM_MISSING', message: `Line(s) ${uomMissing.join(', ')} have no uom_id. Fix the SO before invoicing.` });
  }

  // 4) hsn_code enrichment (read-only)
  const itemIds = [...new Set(invoiceable.map((l) => l.item_id))];
  const { data: items } = itemIds.length
    ? await supabase.from('item_master').select('id, hsn_code').in('id', itemIds)
    : { data: [] };
  const hsnById = new Map((items || []).map((i) => [i.id, i.hsn_code ?? null]));

  // 5) resolve FG warehouse (no defaulting)
  let warehouse_id = null;
  const { data: wh, error: whErr } = await supabase
    .from('warehouse_master')
    .select('id, warehouse_code')
    .eq('warehouse_code', FG_WAREHOUSE_CODE)
    .maybeSingle();
  if (whErr) return { data: null, error: { code: whErr.code || 'INTERNAL_ERROR', message: whErr.message } };
  if (!wh) blocks.push({ code: 'WAREHOUSE_MISSING', message: `FG warehouse '${FG_WAREHOUSE_CODE}' not found in warehouse_master.` });
  else warehouse_id = wh.id;

  // 6) proposed invoice lines (pricing/tax copied 1:1 from SO lines)
  const previewLines = invoiceable.map((l) => ({
    so_line_id: l.id,
    line_seq: l.line_number,
    item_id: l.item_id,
    uom_id: l.uom_id,
    qty: n2(l.qty),
    unit_rate: l.unit_rate != null ? n2(l.unit_rate) : null,
    discount_percent: l.discount_percent != null ? n2(l.discount_percent) : null,
    discount_amount: l.discount_amount != null ? n2(l.discount_amount) : null,
    tax_id: l.tax_id ?? null,
    tax_percent: l.tax_percent != null ? n2(l.tax_percent) : null,
    tax_amount: l.tax_amount != null ? n2(l.tax_amount) : null,
    line_total: l.line_total != null ? n2(l.line_total) : null,
    hsn_code: hsnById.get(l.item_id) ?? null,
  }));

  // 7) totals from explicit line fields (arithmetic only; no schema assumption)
  const tax_total = n2(previewLines.reduce((s, l) => s + (l.tax_amount || 0), 0));
  const grand_total = n2(previewLines.reduce((s, l) => s + (l.line_total || 0), 0)); // sum of line totals = bill amount
  const sub_total_ex_tax = n2(grand_total - tax_total);

  const can_invoice = blocks.length === 0;

  return {
    data: {
      can_invoice,
      blocks,
      source_so: {
        id: so.id, so_number: so.so_number, status, customer_id: so.customer_id,
        so_date: so.so_date, delivery_date: so.delivery_date, line_count: lines.length,
      },
      invoice_preview: {
        header: {
          so_id: so.id, so_number: so.so_number, customer_id: so.customer_id,
          warehouse_id, warehouse_code: wh?.warehouse_code ?? null,
          status: 'draft',
        },
        lines: previewLines,
        totals: { sub_total_ex_tax, tax_total, grand_total },
      },
      not_written: NOT_WRITTEN,
    },
    error: null,
  };
}

const CREATE_NOT_WRITTEN = Object.freeze([
  'inventory_ledger', 'inventory_balance', 'movement_types',
  'accounting_ledger', 'sales_order_headers', 'sales_order_lines',
]);

// ─── PUBLIC: create DRAFT invoice from an approved SO (SI-2; flag-gated; idempotent) ──
// Pending qty = SO line qty - sum(non-cancelled invoice line qty). Draft qty defaults to pending.
// One open draft per SO (DB partial unique index + pre-check). No inventory/posting/accounting.
export async function createDraftInvoiceFromSO(soId, userId = null) {
  if (!invoiceCommitEnabled()) {
    return { data: null, error: { code: 'FEATURE_DISABLED', message: 'sales_invoice_commit_enabled is false — draft invoice creation is gated.' } };
  }
  if (!soId) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'soId is required.' } };

  // 1) reuse preview for all gating + priced lines + warehouse
  const { data: preview, error: pErr } = await previewInvoiceFromSO(soId);
  if (pErr) return { data: null, error: pErr };
  if (!preview.can_invoice) {
    return { data: { committed: false, reason: 'BLOCKED', blocks: preview.blocks, not_written: CREATE_NOT_WRITTEN }, error: null };
  }
  const fgId = preview.invoice_preview.header.warehouse_id;
  const custId = preview.source_so.customer_id;

  // 2) idempotency: one open draft per SO
  const { data: existing, error: exErr } = await supabase
    .from('sales_invoice_headers').select('id, invoice_number, status').eq('so_id', soId).eq('status', 'draft');
  if (exErr) return { data: null, error: { code: exErr.code || 'INTERNAL_ERROR', message: exErr.message } };
  if ((existing || []).length) {
    const inv = existing[0];
    const { data: exLines } = await supabase.from('sales_invoice_lines').select('id').eq('invoice_id', inv.id);
    return { data: { committed: true, invoice: { action: 'USE_EXISTING', id: inv.id, invoice_number: inv.invoice_number, status: inv.status, lines: (exLines || []).length }, not_written: CREATE_NOT_WRITTEN }, error: null };
  }

  // 3) already-invoiced qty per so_line_id across NON-CANCELLED invoices of this SO
  const { data: soInvoices, error: siErr } = await supabase
    .from('sales_invoice_headers').select('id, status').eq('so_id', soId);
  if (siErr) return { data: null, error: { code: siErr.code || 'INTERNAL_ERROR', message: siErr.message } };
  const liveInvIds = (soInvoices || []).filter((h) => String(h.status).toLowerCase() !== 'cancelled').map((h) => h.id);
  const invoicedBySoLine = new Map();
  if (liveInvIds.length) {
    const { data: priorLines, error: plErr } = await supabase
      .from('sales_invoice_lines').select('so_line_id, invoice_qty').in('invoice_id', liveInvIds);
    if (plErr) return { data: null, error: { code: plErr.code || 'INTERNAL_ERROR', message: plErr.message } };
    for (const l of priorLines || []) invoicedBySoLine.set(l.so_line_id, (invoicedBySoLine.get(l.so_line_id) || 0) + Number(l.invoice_qty || 0));
  }

  // 4) pending qty per preview line; scale priced amounts by pending/full ratio
  const draftLines = [];
  for (const l of preview.invoice_preview.lines) {
    const already = invoicedBySoLine.get(l.so_line_id) || 0;
    const pending = n2(Number(l.qty) - already);
    if (pending <= 0) continue;
    const factor = Number(l.qty) > 0 ? pending / Number(l.qty) : 1;
    draftLines.push({
      so_line_id: l.so_line_id, line_number: l.line_seq, item_id: l.item_id, uom_id: l.uom_id,
      invoice_qty: pending, unit_rate: l.unit_rate, discount_percent: l.discount_percent,
      discount_amount: l.discount_amount != null ? n2(l.discount_amount * factor) : null,
      tax_id: l.tax_id, tax_percent: l.tax_percent,
      tax_amount: l.tax_amount != null ? n2(l.tax_amount * factor) : null,
      line_total: l.line_total != null ? n2(l.line_total * factor) : null,
    });
  }
  if (!draftLines.length) {
    return { data: { committed: false, reason: 'NOTHING_TO_INVOICE', message: 'Pending qty is 0 for all lines (already fully invoiced).', not_written: CREATE_NOT_WRITTEN }, error: null };
  }

  // 5) invoice number (no write before this; failure => clean block)
  let invoice_number;
  try { invoice_number = await getNextNumber(INVOICE_SERIES_KEY); }
  catch (e) { return { data: { committed: false, reason: 'INVOICE_SERIES_MISSING', message: `Number series '${INVOICE_SERIES_KEY}' not available: ${e?.message || e}`, not_written: CREATE_NOT_WRITTEN }, error: null }; }
  if (!invoice_number) return { data: { committed: false, reason: 'INVOICE_SERIES_MISSING', message: `Number series '${INVOICE_SERIES_KEY}' returned no number.`, not_written: CREATE_NOT_WRITTEN }, error: null };

  // 6) totals from draft (pending) lines
  const tax_amount = n2(draftLines.reduce((s, l) => s + (l.tax_amount || 0), 0));
  const discount_amount = n2(draftLines.reduce((s, l) => s + (l.discount_amount || 0), 0));
  const grand_total = n2(draftLines.reduce((s, l) => s + (l.line_total || 0), 0));
  const subtotal = n2(grand_total - tax_amount);

  // 7) insert header (exact applied columns)
  const { data: hdr, error: hErr } = await supabase
    .from('sales_invoice_headers')
    .insert({
      invoice_number, so_id: soId, customer_id: custId, fg_warehouse_id: fgId,
      status: 'draft', subtotal, discount_amount, tax_amount, grand_total,
      notes: null, created_by: userId,
    })
    .select('id, invoice_number')
    .single();
  if (hErr) {
    // partial unique index race -> someone created the open draft; return it
    if (hErr.code === '23505') {
      const { data: ex2 } = await supabase.from('sales_invoice_headers').select('id, invoice_number, status').eq('so_id', soId).eq('status', 'draft');
      if ((ex2 || []).length) return { data: { committed: true, invoice: { action: 'USE_EXISTING', id: ex2[0].id, invoice_number: ex2[0].invoice_number, status: 'draft' }, not_written: CREATE_NOT_WRITTEN }, error: null };
    }
    return { data: null, error: { code: hErr.code || 'INTERNAL_ERROR', message: hErr.message } };
  }

  // 8) insert lines; rollback-own header on failure
  const lineRows = draftLines.map((l) => ({ invoice_id: hdr.id, ...l }));
  const { error: lErr } = await supabase.from('sales_invoice_lines').insert(lineRows);
  if (lErr) {
    await supabase.from('sales_invoice_lines').delete().eq('invoice_id', hdr.id);
    await supabase.from('sales_invoice_headers').delete().eq('id', hdr.id);
    return { data: null, error: { code: lErr.code || 'INTERNAL_ERROR', message: lErr.message } };
  }

  return {
    data: {
      committed: true,
      invoice: { action: 'CREATED', id: hdr.id, invoice_number: hdr.invoice_number, status: 'draft', lines: lineRows.length, totals: { subtotal, discount_amount, tax_amount, grand_total } },
      not_written: CREATE_NOT_WRITTEN,
    },
    error: null,
  };
}

export { invoiceCommitEnabled, invoicePostEnabled };

// ─── PUBLIC: list invoices (read-only) ──────────────────────────────────────
// Returns rows shaped with customer_master{customer_name,customer_code} + sales_order_headers{so_number}
// so the frontend can read o.customer_master?.customer_name and o.sales_order_headers?.so_number.
export async function listSalesInvoices({ status, search } = {}) {
  let q = supabase
    .from('sales_invoice_headers')
    .select('id, invoice_number, invoice_date, status, so_id, customer_id, grand_total, created_at');
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('invoice_number', `%${search}%`);
  const { data: rows, error } = await q.order('created_at', { ascending: false });
  if (error) return { data: null, error, count: 0 };

  const list = rows || [];
  const custIds = [...new Set(list.map((r) => r.customer_id).filter(Boolean))];
  const soIds = [...new Set(list.map((r) => r.so_id).filter(Boolean))];
  const { data: custs } = custIds.length
    ? await supabase.from('customer_master').select('id, customer_code, customer_name').in('id', custIds)
    : { data: [] };
  const { data: sos } = soIds.length
    ? await supabase.from('sales_order_headers').select('id, so_number').in('id', soIds)
    : { data: [] };
  const custById = new Map((custs || []).map((c) => [c.id, c]));
  const soById = new Map((sos || []).map((s) => [s.id, s]));

  const shaped = list.map((r) => ({
    ...r,
    customer_master: custById.get(r.customer_id) ? { customer_code: custById.get(r.customer_id).customer_code, customer_name: custById.get(r.customer_id).customer_name } : null,
    sales_order_headers: soById.get(r.so_id) ? { so_number: soById.get(r.so_id).so_number } : null,
  }));
  return { data: shaped, error: null, count: shaped.length };
}

// ─── PUBLIC: invoice detail (read-only) ─────────────────────────────────────
export async function getSalesInvoiceById(id) {
  if (!id) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'id is required.' } };
  const { data: hdr, error: hErr } = await supabase
    .from('sales_invoice_headers')
    .select('id, invoice_number, invoice_date, status, so_id, customer_id, fg_warehouse_id, subtotal, discount_amount, tax_amount, grand_total, notes, created_at, posted_at, cancelled_at')
    .eq('id', id)
    .single();
  if (hErr || !hdr) return { data: null, error: hErr ?? { code: 'NOT_FOUND', message: 'Sales invoice not found.' } };

  const { data: lines, error: lErr } = await supabase
    .from('sales_invoice_lines')
    .select('id, line_number, item_id, uom_id, invoice_qty, unit_rate, discount_percent, discount_amount, tax_id, tax_percent, tax_amount, line_total')
    .eq('invoice_id', id)
    .order('line_number', { ascending: true });
  if (lErr) return { data: null, error: lErr };

  const lns = lines || [];
  const itemIds = [...new Set(lns.map((l) => l.item_id).filter(Boolean))];
  const uomIds = [...new Set(lns.map((l) => l.uom_id).filter(Boolean))];
  const { data: items } = itemIds.length ? await supabase.from('item_master').select('id, item_code, item_name').in('id', itemIds) : { data: [] };
  const { data: uoms } = uomIds.length ? await supabase.from('uom_master').select('id, uom_code').in('id', uomIds) : { data: [] };
  const itemById = new Map((items || []).map((i) => [i.id, i]));
  const uomById = new Map((uoms || []).map((u) => [u.id, u]));

  const { data: cust } = hdr.customer_id ? await supabase.from('customer_master').select('id, customer_code, customer_name').eq('id', hdr.customer_id).maybeSingle() : { data: null };
  const { data: so } = hdr.so_id ? await supabase.from('sales_order_headers').select('id, so_number').eq('id', hdr.so_id).maybeSingle() : { data: null };

  return {
    data: {
      ...hdr,
      customer_master: cust ? { customer_code: cust.customer_code, customer_name: cust.customer_name } : null,
      sales_order_headers: so ? { so_number: so.so_number } : null,
      lines: lns.map((l) => ({
        ...l,
        item_master: itemById.get(l.item_id) ? { item_code: itemById.get(l.item_id).item_code, item_name: itemById.get(l.item_id).item_name } : null,
        uom_master: uomById.get(l.uom_id) ? { uom_code: uomById.get(l.uom_id).uom_code } : null,
      })),
    },
    error: null,
  };
}

const POST_NOT_WRITTEN = Object.freeze([
  'inventory_ledger', 'inventory_balance', 'movement_types',
  'accounting_ledger', 'sales_invoice_headers', 'sales_invoice_lines',
]);

// ─── PUBLIC: post Sales Invoice — SI-5 (stock guard + canonical deduction) ───
// 1) require status='draft'; 2) pre-check FG-STORE stock (block INSUFFICIENT_STOCK, no negative);
// 3) if stock OK: deduct ONLY via canonical atomic RPC fn_post_sales_invoice (sibling of
//    fn_post_grn / fn_post_production_log) which does the OUT-move, in-txn negative guard,
//    idempotency, and the status/posted_by/posted_at update. We never write inventory directly.
// Gate sales_invoice_post_enabled is OFF by default -> behaves as a read-only stock check.
// If the RPC is not applied, returns POST_RPC_MISSING and writes nothing.
export async function postSalesInvoice(invoiceId, userId = null) {
  if (!invoiceId) return { data: null, error: { code: 'VALIDATION_ERROR', message: 'invoiceId is required.' } };

  // 1) header + status gate
  const { data: hdr, error: hErr } = await supabase
    .from('sales_invoice_headers')
    .select('id, invoice_number, status, so_id, fg_warehouse_id')
    .eq('id', invoiceId)
    .single();
  if (hErr || !hdr) return { data: null, error: hErr ?? { code: 'NOT_FOUND', message: 'Sales invoice not found.' } };
  const status = String(hdr.status || '').toLowerCase();
  if (status !== 'draft') {
    return { data: { posted: false, reason: 'NOT_DRAFT', status, message: `Invoice status is '${status}'. Only draft invoices can be posted.`, not_written: POST_NOT_WRITTEN }, error: null };
  }

  // 2) lines
  const { data: lines, error: lErr } = await supabase
    .from('sales_invoice_lines')
    .select('id, line_number, item_id, uom_id, invoice_qty')
    .eq('invoice_id', invoiceId)
    .order('line_number', { ascending: true });
  if (lErr) return { data: null, error: { code: lErr.code || 'INTERNAL_ERROR', message: lErr.message } };
  const lns = lines || [];
  if (!lns.length) return { data: { posted: false, reason: 'NO_LINES', message: 'Invoice has no lines.', not_written: POST_NOT_WRITTEN }, error: null };

  // 3) resolve FG warehouse (header's fg_warehouse_id; fallback FG-STORE)
  let fgId = hdr.fg_warehouse_id || null;
  let fgCode = null;
  if (!fgId) {
    const { data: wh } = await supabase.from('warehouse_master').select('id, warehouse_code').eq('warehouse_code', 'FG-STORE').maybeSingle();
    if (!wh) return { data: { posted: false, reason: 'WAREHOUSE_MISSING', message: "FG warehouse 'FG-STORE' not found.", not_written: POST_NOT_WRITTEN }, error: null };
    fgId = wh.id; fgCode = wh.warehouse_code;
  }

  // 4) balances for these items at FG warehouse (exact cols: item_id, warehouse_id, quantity, uom_id)
  const itemIds = [...new Set(lns.map((l) => l.item_id).filter(Boolean))];
  const { data: bals, error: bErr } = itemIds.length
    ? await supabase.from('inventory_balance').select('item_id, warehouse_id, quantity, uom_id').eq('warehouse_id', fgId).in('item_id', itemIds)
    : { data: [] };
  if (bErr) return { data: null, error: { code: bErr.code || 'INTERNAL_ERROR', message: bErr.message } };
  const balByItem = new Map((bals || []).map((b) => [b.item_id, b]));

  // item codes for readable messages
  const { data: items } = itemIds.length ? await supabase.from('item_master').select('id, item_code').in('id', itemIds) : { data: [] };
  const codeById = new Map((items || []).map((i) => [i.id, i.item_code]));

  // 5) per-line check; shortages + uom mismatches (no qty conversion guessing)
  const shortages = [];
  const uom_mismatches = [];
  for (const l of lns) {
    const need = Number(l.invoice_qty) || 0;
    const bal = balByItem.get(l.item_id) || null;
    const have = bal ? Number(bal.quantity) || 0 : 0;
    if (bal && l.uom_id && bal.uom_id && l.uom_id !== bal.uom_id) {
      uom_mismatches.push({ item_id: l.item_id, item_code: codeById.get(l.item_id) ?? null, line_uom_id: l.uom_id, balance_uom_id: bal.uom_id });
      continue;
    }
    if (have < need) {
      shortages.push({ item_id: l.item_id, item_code: codeById.get(l.item_id) ?? null, required: n2(need), available: n2(have), warehouse_id: fgId, warehouse_code: fgCode || 'FG-STORE' });
    }
  }

  if (shortages.length || uom_mismatches.length) {
    return {
      data: {
        posted: false,
        reason: 'INSUFFICIENT_STOCK',
        invoice_number: hdr.invoice_number,
        shortages,
        ...(uom_mismatches.length ? { uom_mismatches } : {}),
        message: 'Cannot post: insufficient FG stock for one or more lines.',
        not_written: POST_NOT_WRITTEN,
      },
      error: null,
    };
  }

  // 6) stock sufficient.
  // SI-5: deduct ONLY via the canonical atomic RPC fn_post_sales_invoice (same family as
  // fn_post_grn / fn_post_production_log). No direct inventory_ledger/balance writes here.
  if (!invoicePostEnabled()) {
    // gate off (default) -> behave as SI-4: report ready, write nothing, stay draft.
    return {
      data: {
        posted: false, can_post: true, reason: 'STOCK_OK_DEFERRED',
        invoice_number: hdr.invoice_number,
        message: 'Stock sufficient. Posting gate is off (sales_invoice_post_enabled=false). No inventory written; invoice remains draft.',
        not_written: POST_NOT_WRITTEN,
      }, error: null,
    };
  }

  // gate on -> call the canonical RPC. The RPC owns the atomic OUT-move, negative-stock guard,
  // idempotency, and the status/posted_by/posted_at update. We only map its result.
  const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_post_sales_invoice', {
    p_invoice_id: invoiceId,
    p_posted_by: userId,
  });

  if (rpcErr) {
    const msg = String(rpcErr.message || '');
    const code = String(rpcErr.code || '');
    // RPC absent (not yet applied) -> clean stop, nothing written.
    if (code === '42883' || /fn_post_sales_invoice/.test(msg) && /(does not exist|could not find|not found|undefined function|no function)/i.test(msg)) {
      return { data: { posted: false, reason: 'POST_RPC_MISSING', invoice_number: hdr.invoice_number, message: 'Canonical RPC fn_post_sales_invoice is not present. Apply the approved SI-5 SQL first. No inventory written.', not_written: POST_NOT_WRITTEN }, error: null };
    }
    // negative-stock / insufficient guard raised inside the RPC.
    if (/insufficient|negative|stock/i.test(msg)) {
      return { data: { posted: false, reason: 'INSUFFICIENT_STOCK', invoice_number: hdr.invoice_number, message: msg, not_written: POST_NOT_WRITTEN }, error: null };
    }
    // anything else: surface as error (no assumptions).
    return { data: null, error: { code: code || 'INTERNAL_ERROR', message: msg || 'Post failed.' } };
  }

  const rstatus = String(rpcData?.status || '').toUpperCase();
  if (rstatus === 'ALREADY_POSTED') {
    return { data: { posted: false, reason: 'ALREADY_POSTED', invoice_number: hdr.invoice_number, message: 'Invoice already posted (idempotent).', rpc: rpcData }, error: null };
  }
  // POSTED.
  return {
    data: {
      posted: true,
      reason: 'POSTED',
      invoice_id: invoiceId,
      invoice_number: hdr.invoice_number,
      posted_rows: rpcData?.posted_rows ?? null,
      rpc: rpcData,
      message: 'Invoice posted. FG stock deducted via fn_post_sales_invoice (atomic).',
    },
    error: null,
  };
}
