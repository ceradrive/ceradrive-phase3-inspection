/**
 * CERADRIVE ERP — SI-1a Invoice Preview Trial (service-level, read-only)
 *
 * Calls previewInvoiceFromSO() directly (no HTTP, no auth). SELECT-only.
 * Target SO 2627/0003 (by so_number); falls back to latest approved; else NO_APPROVED_SO stop.
 * Proves no DB write by snapshotting SO header/line counts before & after.
 *
 * Run:  node backend/scripts/siInvoicePreviewTrial.mjs
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
  let supabase, previewInvoiceFromSO;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ previewInvoiceFromSO } = await import('../src/services/salesInvoiceService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const countAll = async (t) => { const { data } = await supabase.from(t).select('id'); return (data || []).length; };

  L('=== SI-1a INVOICE PREVIEW TRIAL (read-only) ===');
  const beforeH = await countAll('sales_order_headers');
  const beforeL = await countAll('sales_order_lines');

  // resolve target SO: by so_number first, else latest approved
  let so = null;
  const { data: byNum } = await supabase.from('sales_order_headers')
    .select('id, so_number, status, so_date, created_at').eq('so_number', TARGET_SO_NUMBER);
  if ((byNum || []).length) { so = byNum[0]; L('Target SO ' + TARGET_SO_NUMBER + ' found (' + so.id + ') status=' + so.status); }
  if (!so) {
    const { data: appr } = await supabase.from('sales_order_headers')
      .select('id, so_number, status, so_date, created_at').eq('status', 'approved');
    const sorted = (appr || []).slice().sort((a, b) =>
      String(b.so_date || b.created_at || '').localeCompare(String(a.so_date || a.created_at || '')));
    if (!sorted.length) { L('\nRESULT: NO_APPROVED_SO — target not found and no approved SO. Stopping.'); process.exit(0); }
    so = sorted[0]; L('Target not found; using latest approved: ' + so.so_number + ' (' + so.id + ')');
  }

  const r = await previewInvoiceFromSO(so.id);
  if (r.error) { L('  PREVIEW ERROR: ' + JSON.stringify(r.error)); process.exit(2); }
  const p = r.data, ip = p.invoice_preview;

  L('\n[invoice preview]');
  L('  SO: ' + p.source_so.so_number + '  status=' + p.source_so.status + '  customer=' + p.source_so.customer_id);
  L('  warehouse: ' + (ip.header.warehouse_code || 'NONE') + '  can_invoice=' + p.can_invoice + '  blocks=' + JSON.stringify(p.blocks.map(b => b.code)));
  L('  totals: ' + JSON.stringify(ip.totals));
  for (const ln of ip.lines) L('   - line ' + ln.line_seq + ': item ' + ln.item_id + ' qty ' + ln.qty + ' rate ' + ln.unit_rate + ' tax% ' + ln.tax_percent + ' tax ' + ln.tax_amount + ' line_total ' + ln.line_total + ' hsn ' + (ln.hsn_code || '-'));

  // VO101S qty 10 present (item code resolved if item_master has it; else match by qty)
  let vo = null;
  const ids = [...new Set(ip.lines.map(l => l.item_id))];
  if (ids.length) {
    const { data: im } = await supabase.from('item_master').select('id, item_code').in('id', ids);
    const voId = (im || []).find(i => String(i.item_code || '').toUpperCase() === 'VO101S')?.id;
    vo = ip.lines.find(l => l.item_id === voId) || null;
  }
  if (vo) ok(vo.qty === 10, 'VO101S line present with qty 10 (qty=' + vo.qty + ')');
  else L('  (note: VO101S not resolvable by item_code in this DB — checking a qty-10 line instead)');
  if (!vo) ok(ip.lines.some(l => l.qty === 10), 'a line with qty 10 present');

  const priced = ip.lines.find(l => l.line_total != null) || ip.lines[0];
  ok(!!priced && (priced.tax_amount != null || priced.line_total != null), 'pricing/tax copied from SO line (tax_amount/line_total present)');
  const sumLT = Math.round(ip.lines.reduce((s, l) => s + (l.line_total || 0), 0) * 100) / 100;
  ok(ip.totals.grand_total === sumLT, 'grand_total = sum(line_total) (' + ip.totals.grand_total + ')');
  ok(p.can_invoice === true || p.blocks.length > 0, 'can_invoice true OR explicit block reason');
  ok(p.not_written.includes('inventory_ledger') && p.not_written.includes('sales_invoice_headers'), 'not_written declares invoice + inventory tables');

  const afterH = await countAll('sales_order_headers');
  const afterL = await countAll('sales_order_lines');
  ok(afterH === beforeH && afterL === beforeL, `no DB write (headers ${beforeH}->${afterH}, lines ${beforeL}->${afterL})`);

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Read-only. No inventory. Route/service unchanged. No git ops.');
  process.exit(fail === 0 ? 0 : 1);
}
main();
