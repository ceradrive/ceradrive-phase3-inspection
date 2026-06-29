/**
 * CERADRIVE ERP — SI-2 Draft Invoice Trial (service-level)
 *
 * Calls createDraftInvoiceFromSO() directly (no HTTP, no auth).
 * Enables SALES_INVOICE_COMMIT_ENABLED=true in-process only (committed flag stays false).
 * Creates a DRAFT invoice from SO 2627/0003 (or latest approved). Idempotent re-run.
 * Verifies: header+line created, invoice_number present, invoice_qty 10 + total 500, USE_EXISTING on re-run,
 * NO inventory write, SO remains approved.
 *
 * Run:  node backend/scripts/siDraftInvoiceTrial.mjs
 * This WRITES a draft invoice row. Rollback SQL is printed at the end (not executed).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(HERE, '../.env');
const TARGET_SO_NUMBER = process.env.TARGET_SO_NUMBER || '2627/0003';

async function loadEnv() {
  try { const d = await import('dotenv'); d.config({ path: ENV_PATH }); return; } catch {}
  try {
    for (const l of readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i === -1) continue;
      const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {}
}
function L(s = '') { process.stdout.write(s + '\n'); }

async function main() {
  await loadEnv();
  process.env.SALES_INVOICE_COMMIT_ENABLED = 'true'; // runtime-only enable

  let supabase, createDraftInvoiceFromSO, invoiceCommitEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ createDraftInvoiceFromSO, invoiceCommitEnabled } = await import('../src/services/salesInvoiceService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const countAll = async (t) => { const { data } = await supabase.from(t).select('id'); return (data || []).length; };

  L('=== SI-2 DRAFT INVOICE TRIAL ===');
  L('commit flag (runtime): ' + invoiceCommitEnabled());

  // resolve target SO
  let so = null;
  const { data: byNum } = await supabase.from('sales_order_headers').select('id, so_number, status').eq('so_number', TARGET_SO_NUMBER);
  if ((byNum || []).length) so = byNum[0];
  if (!so) {
    const { data: appr } = await supabase.from('sales_order_headers').select('id, so_number, status').eq('status', 'approved');
    if (!(appr || []).length) { L('\nRESULT: NO_APPROVED_SO — stop.'); process.exit(0); }
    so = appr[0];
  }
  if (String(so.status).toLowerCase() !== 'approved') { L('\nTarget SO ' + so.so_number + ' status=' + so.status + ' (not approved). Stop.'); process.exit(0); }
  L('Target SO: ' + so.so_number + ' (' + so.id + ') status=' + so.status);

  // snapshots (no-inventory proof + SO immutability)
  const invLedgerBefore = await countAll('inventory_ledger');
  const invBalBefore = await countAll('inventory_balance');

  L('\n[1] create draft #1');
  const r1 = await createDraftInvoiceFromSO(so.id, null);
  if (r1.error) { L('  ERROR ' + JSON.stringify(r1.error)); process.exit(2); }
  if (r1.data.committed === false) { L('  BLOCKED: ' + (r1.data.reason || JSON.stringify(r1.data.blocks))); process.exit(2); }
  const inv = r1.data.invoice;
  L('  ' + JSON.stringify(inv));
  ok(['CREATED', 'USE_EXISTING'].includes(inv.action), 'committed (CREATED or USE_EXISTING)');
  ok(typeof inv.invoice_number === 'string' && inv.invoice_number.trim().length > 0, 'invoice_number present/non-empty (' + inv.invoice_number + ') — prefix is series-config-defined, not required to be SINV');

  // read back header + lines
  const { data: hdrs } = await supabase.from('sales_invoice_headers').select('id, invoice_number, status, fg_warehouse_id, subtotal, tax_amount, grand_total, so_id').eq('id', inv.id);
  const hdr = hdrs?.[0];
  ok(!!hdr, 'header row exists');
  ok(hdr && hdr.status === 'draft' && hdr.so_id === so.id, 'header: status draft, so_id matches');
  const { data: lns } = await supabase.from('sales_invoice_lines').select('id, item_id, invoice_qty, unit_rate, line_total, line_number').eq('invoice_id', inv.id);
  ok((lns || []).length >= 1, 'line row(s) exist (' + (lns || []).length + ')');

  // invoice_qty 10 + total 500 (subtotal or grand)
  const qty10 = (lns || []).some(l => Number(l.invoice_qty) === 10);
  ok(qty10, 'a line with invoice_qty 10 present');
  const total500 = [hdr?.subtotal, hdr?.grand_total].map(Number).includes(500);
  ok(total500, 'total 500 present (subtotal/grand_total) — subtotal=' + hdr?.subtotal + ' grand=' + hdr?.grand_total);

  L('\n[2] re-run -> USE_EXISTING (no duplicate)');
  const beforeH = await countAll('sales_invoice_headers');
  const r2 = await createDraftInvoiceFromSO(so.id, null);
  ok(r2.data.invoice?.action === 'USE_EXISTING', 're-run -> USE_EXISTING');
  ok((await countAll('sales_invoice_headers')) === beforeH, 'no new invoice header (no duplicate)');
  ok(r2.data.invoice?.id === inv.id, 'same invoice id returned');

  L('\n[3] no inventory write');
  ok((await countAll('inventory_ledger')) === invLedgerBefore, 'inventory_ledger unchanged (' + invLedgerBefore + ')');
  ok((await countAll('inventory_balance')) === invBalBefore, 'inventory_balance unchanged (' + invBalBefore + ')');
  ok(r1.data.not_written.includes('inventory_ledger') && r1.data.not_written.includes('accounting_ledger'), 'not_written declares inventory + accounting');

  L('\n[4] SO remains approved');
  const { data: soAfter } = await supabase.from('sales_order_headers').select('status').eq('id', so.id);
  ok(String(soAfter?.[0]?.status).toLowerCase() === 'approved', 'SO still approved');

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Rollback (manual, review first): DELETE FROM sales_invoice_lines WHERE invoice_id=\'' + inv.id + '\'; ' +
    'DELETE FROM sales_invoice_headers WHERE id=\'' + inv.id + '\';');
  L('No inventory. No posting. No git ops.');
  process.exit(fail === 0 ? 0 : 1);
}
main();
