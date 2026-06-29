'use client';

import { useState } from 'react';
import { api } from '../../../../lib/api.js';
import { useToast } from '../../../../components/ui/Toast.jsx';

const DOCS = [
  ['ITEM_MASTER', 'Item Master'],
  ['RECIPE_BUILDER', 'Recipe Builder'],
  ['CUSTOMER_MASTER', 'Customers'],
  ['SUPPLIER_MASTER', 'Suppliers'],
];

const TEMPLATES = {
  ITEM_MASTER: ['item_code','item_name','item_type_code','category_code','uom_code','purchase_uom_code','sales_uom_code','stage_type','planning_unit','make_policy','is_purchasable','is_sellable','is_manufactured','is_stocked','calculation_basis','pcs_per_set','bp_weight_g','weight_g','notes'],
  RECIPE_BUILDER: ['recipe_code','recipe_name','fg_item_code','status','step_no','output_item_code','to_make_qty','to_make_uom','process_code','machine_code','calculation_basis','input_item_code','input_qty','input_uom','qty_basis','qc_required','fpa_required','notes'],
  CUSTOMER_MASTER: ['customer_code','customer_name','customer_type','gstin','pan','contact_name','contact_mobile','contact_email','address_line1','address_line2','city','state','pincode','country','credit_days','credit_limit','notes','is_active'],
  SUPPLIER_MASTER: ['supplier_code','supplier_name','supplier_type','gstin','pan','contact_name','contact_mobile','contact_email','city','state','credit_days','payment_terms','default_currency','notes','is_active'],
};

function parseCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(x => x.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function downloadCsv(filename, headers) {
  const blob = new Blob([`${headers.join(',')}\n`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function DataImportPage() {
  const toast = useToast();
  const [docType, setDocType] = useState('ITEM_MASTER');
  const [mode, setMode] = useState('create');
  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState([]);
  const [busy, setBusy] = useState(false);

  async function loadFile(file) {
    const text = await file.text();
    setCsv(text);
    const parsed = parseCsv(text);
    setRows(parsed);
    setResult([]);
    toast(`Loaded ${parsed.length} rows.`);
  }

  async function preview() {
    const parsed = rows.length ? rows : parseCsv(csv);
    setRows(parsed);
    setBusy(true);
    const { data, error } = await api.post('/api/v1/data-import/preview', { doc_type: docType, mode, rows: parsed });
    setBusy(false);
    if (error) { toast(error.message || 'Preview failed'); return; }
    setResult(data || []);
  }

  async function runImport() {
    if (!confirm('Import valid rows now?')) return;
    const parsed = rows.length ? rows : parseCsv(csv);
    setBusy(true);
    const { data, error } = await api.post('/api/v1/data-import/run', { doc_type: docType, mode, rows: parsed });
    setBusy(false);
    if (error) { toast(error.message || 'Import failed'); return; }
    setResult(data || []);
    toast('Import completed.');
  }

  const parsedCount = rows.length || parseCsv(csv).length;
  const okCount = result.filter(r => r.ok).length;
  const issueCount = result.filter(r => !r.ok).length;

  return (
    <div style={S.page}>
      <div style={S.hero}>
        <div>
          <div style={S.kicker}>ERPNext-style import</div>
          <h1 style={S.title}>Data Import</h1>
          <p style={S.sub}>Download template, upload CSV, preview row errors, then import only after review.</p>
        </div>
        <div style={S.heroStats}>
          <div><b>{parsedCount}</b><span>Rows loaded</span></div>
          <div><b>{okCount}</b><span>Valid</span></div>
          <div><b>{issueCount}</b><span>Issues</span></div>
        </div>
      </div>

      <section style={S.card}>
        <div style={S.toolbar}>
          <label style={S.field}>Document Type
            <select value={docType} onChange={e => { setDocType(e.target.value); setCsv(''); setRows([]); setResult([]); }} style={S.select}>
              {DOCS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={S.field}>Import Mode
            <select value={mode} onChange={e => setMode(e.target.value)} style={S.select}>
              <option value="create">Create only</option>
              <option value="upsert">Create or update</option>
            </select>
          </label>
          <button onClick={() => downloadCsv(`${docType.toLowerCase()}_template.csv`, TEMPLATES[docType])} style={S.secondaryBtn}>Download Template</button>
        </div>

        <div style={S.uploadBox}>
          <div>
            <div style={S.uploadTitle}>Upload CSV</div>
            <div style={S.muted}>Excel can save as CSV. XLSX support will come later.</div>
          </div>
          <label style={S.fileBtn}>
            Choose CSV
            <input type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} style={{ display: 'none' }} />
          </label>
        </div>

        <textarea value={csv} onChange={e => { setCsv(e.target.value); setRows([]); setResult([]); }} placeholder="Paste CSV here..." style={S.textarea} />

        <div style={S.actions}>
          <button onClick={preview} disabled={busy} style={S.primaryBtn}>{busy ? 'Working…' : 'Preview Import'}</button>
          <button onClick={runImport} disabled={busy || !result.length} style={S.primaryBtn}>Import Valid Rows</button>
          <span style={S.muted}>Preview is mandatory. No blind import.</span>
        </div>
      </section>

      <section style={S.card}>
        <div style={S.sectionHead}>
          <div>
            <h2 style={S.head}>Preview / Import Result</h2>
            <div style={S.muted}>Every row shows status, action and error before import.</div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['Row', 'Status', 'Action', 'Code', 'Error'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {result.map((r, idx) => (
                <tr key={idx}>
                  <td style={S.td}>{r.row_no || '—'}</td>
                  <td style={S.td}><span style={r.ok ? S.ok : S.bad}>{r.ok ? 'OK' : 'ISSUE'}</span></td>
                  <td style={S.td}>{r.action}</td>
                  <td style={S.td}><b>{r.item_code || r.recipe_code || r.customer_code || r.supplier_code || '—'}</b></td>
                  <td style={{ ...S.td, color: r.error ? '#B91C1C' : '#64748B' }}>{r.error || '—'}</td>
                </tr>
              ))}
              {!result.length && <tr><td style={S.td} colSpan={5}>No preview yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const S = {
  page: { padding: '24px 28px', background: '#F8FAFC', minHeight: '100vh', color: '#0F172A' },
  hero: { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'end', background: 'linear-gradient(135deg, #004AC6, #0F172A)', color: '#fff', borderRadius: 22, padding: 24, marginBottom: 18, boxShadow: '0 18px 40px rgba(0,74,198,0.22)' },
  kicker: { fontSize: 12, opacity: 0.82, textTransform: 'uppercase', letterSpacing: 1 },
  title: { margin: '4px 0', fontSize: 30, fontWeight: 850 },
  sub: { margin: 0, opacity: 0.86, fontSize: 14 },
  heroStats: { display: 'flex', gap: 10 },
  card: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 18, padding: 18, marginBottom: 16, boxShadow: '0 10px 28px rgba(15,23,42,0.06)' },
  toolbar: { display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 },
  field: { display: 'grid', gap: 6, fontSize: 12, fontWeight: 800, color: '#0F172A' },
  select: { height: 42, border: '1px solid #CBD5E1', borderRadius: 12, padding: '0 12px', background: '#fff', minWidth: 220 },
  secondaryBtn: { height: 42, border: '1px solid #BFDBFE', background: '#EEF4FF', color: '#004AC6', borderRadius: 12, padding: '0 16px', fontWeight: 800, cursor: 'pointer' },
  uploadBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px dashed #94A3B8', background: '#F8FAFC', borderRadius: 16, padding: 16, marginBottom: 12 },
  uploadTitle: { fontWeight: 850, fontSize: 14 },
  fileBtn: { height: 40, display: 'inline-flex', alignItems: 'center', border: 'none', background: '#004AC6', color: '#fff', borderRadius: 12, padding: '0 16px', fontWeight: 800, cursor: 'pointer' },
  textarea: { width: '100%', height: 190, border: '1px solid #CBD5E1', borderRadius: 14, padding: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, boxSizing: 'border-box', background: '#FFFFFF' },
  actions: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' },
  primaryBtn: { height: 42, background: '#004AC6', color: '#fff', border: 'none', borderRadius: 12, padding: '0 16px', fontWeight: 850, cursor: 'pointer' },
  muted: { color: '#64748B', fontSize: 13 },
  sectionHead: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 },
  head: { margin: 0, fontSize: 18, fontWeight: 850 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: 11, borderBottom: '1px solid #E2E8F0', color: '#64748B', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { padding: 11, borderBottom: '1px solid #E2E8F0' },
  ok: { background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '4px 9px', fontWeight: 850, fontSize: 11 },
  bad: { background: '#FEE2E2', color: '#B91C1C', borderRadius: 999, padding: '4px 9px', fontWeight: 850, fontSize: 11 },
};
