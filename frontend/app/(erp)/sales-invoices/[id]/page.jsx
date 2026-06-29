'use client';

/**
 * CERADRIVE ERP — Sales Invoice detail (read-only). GET /api/v1/sales-invoices/:id.
 * Header + lines. Draft status shown. No post / no stock deduction / no edit.
 */
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }                  from '../../../../lib/api.js';

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d); if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v); if (isNaN(n)) return String(v);
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const STATUS_STYLE = {
  draft:     { color: '#6B7280', borderColor: '#D1D5DB', bg: '#F9FAFB' },
  posted:    { color: '#047857', borderColor: '#6EE7B7', bg: '#ECFDF5' },
  cancelled: { color: '#B91C1C', borderColor: '#FCA5A5', bg: '#FEF2F2' },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500, border: `1px solid ${s.borderColor}`, color: s.color, background: s.bg }}>{status ?? 'draft'}</span>;
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#111827' }}>{children}</div>
    </div>
  );
}

const LGRID = '40px minmax(160px,1fr) 90px 80px 110px 80px 120px';

export default function SalesInvoiceDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState(null);

  async function onPost() {
    setPosting(true); setPostResult(null);
    const { data, error: err } = await api.post(`/api/v1/sales-invoices/${id}/post`, {});
    setPosting(false);
    if (err) { setPostResult({ kind: 'error', message: err.message ?? 'Post failed.' }); return; }
    const reason = data?.reason;
    let kind = 'block';
    if (data?.posted === true) kind = 'success';
    else if (reason === 'STOCK_OK_DEFERRED') kind = 'ok';
    else if (reason === 'POST_RPC_MISSING' || reason === 'ALREADY_POSTED') kind = 'warn';
    setPostResult({ kind, data });
    if (data?.posted === true) load(); // refresh -> status flips to posted, button hides
  }

  async function load() {
    setLoading(true); setError(null);
    const { data, error: err } = await api.get(`/api/v1/sales-invoices/${id}`);
    if (err) { setError(err.message ?? 'Failed to load invoice.'); setLoading(false); return; }
    setInv(data); setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (error) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>{error}</div>;
  if (!inv) return null;

  const lines = inv.lines ?? [];

  return (
    <div style={{ maxWidth: 980 }}>
      <button onClick={() => router.push('/sales-invoices')}
        style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14 }}>‹ Back to Sales Invoices</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>{inv.invoice_number}</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Sales invoice (read-only)</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusBadge status={inv.status} />
          {inv.status === 'draft' && (
            <button type="button" onClick={onPost} disabled={posting}
              style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: posting ? '#A5B4FC' : '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: posting ? 'default' : 'pointer' }}>
              {posting ? 'Checking stock…' : 'Post Invoice'}
            </button>
          )}
        </div>
      </div>

      {postResult && (
        <div style={{ marginBottom: 18, borderRadius: 8, padding: 14, border: `1px solid ${postResult.kind === 'success' ? '#6EE7B7' : (postResult.kind === 'ok' || postResult.kind === 'warn') ? '#FCD34D' : '#FCA5A5'}`, background: postResult.kind === 'success' ? '#ECFDF5' : (postResult.kind === 'ok' || postResult.kind === 'warn') ? '#FFFBEB' : '#FEF2F2' }}>
          {postResult.kind === 'error' && <div style={{ fontSize: 13, color: '#B91C1C' }}>{postResult.message}</div>}
          {postResult.kind === 'success' && (
            <div style={{ fontSize: 13, color: '#065F46', fontWeight: 600 }}>
              Invoice posted. FG stock deducted{postResult.data?.posted_rows != null ? ` (${postResult.data.posted_rows} line${postResult.data.posted_rows === 1 ? '' : 's'})` : ''}.
            </div>
          )}
          {postResult.kind === 'ok' && (
            <div style={{ fontSize: 13, color: '#92400E' }}>
              Stock is sufficient. Posting is turned off — nothing was written and the invoice stays draft.
            </div>
          )}
          {postResult.kind === 'warn' && (
            <div style={{ fontSize: 13, color: '#92400E' }}>{postResult.data?.message ?? 'Action could not complete.'}</div>
          )}
          {postResult.kind === 'block' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#B91C1C', marginBottom: 6 }}>Cannot post — insufficient FG stock</div>
              {(postResult.data?.shortages ?? []).map((s, i) => (
                <div key={i} style={{ fontSize: 13, color: '#7F1D1D' }}>
                  {s.item_code ?? s.item_id}: required {s.required}, available {s.available} @ {s.warehouse_code}
                </div>
              ))}
              {(postResult.data?.uom_mismatches ?? []).map((u, i) => (
                <div key={`u${i}`} style={{ fontSize: 13, color: '#7F1D1D' }}>
                  {u.item_code ?? u.item_id}: UOM mismatch (line vs stock) — resolve before posting
                </div>
              ))}
              {postResult.data?.reason === 'NOT_DRAFT' && <div style={{ fontSize: 13, color: '#7F1D1D' }}>{postResult.data?.message}</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, background: '#fff', padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Field label="Customer">{inv.customer_master?.customer_name ?? '—'}</Field>
          <Field label="SO Number">{inv.sales_order_headers?.so_number ?? '—'}</Field>
          <Field label="Invoice Date">{formatDate(inv.invoice_date)}</Field>
          <Field label="Status">{inv.status ?? 'draft'}</Field>
        </div>
      </div>

      <div className="erp-table" style={{ marginBottom: 18 }}>
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: LGRID, padding: '9px 14px' }}>
          {['#', 'Item', 'Qty', 'Rate', 'Tax', 'Tax %', 'Line Total'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No lines</div>
        ) : lines.map(l => (
          <div key={l.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: LGRID, padding: '0 14px', alignItems: 'center', minHeight: 46 }}>
            <div style={{ fontSize: 13, color: '#6B7280' }}>{l.line_number}</div>
            <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
              {l.item_master?.item_code ?? '—'}{l.item_master?.item_name ? ` — ${l.item_master.item_name}` : ''}
            </div>
            <div style={{ fontSize: 13, color: '#111827' }}>{l.invoice_qty}{l.uom_master?.uom_code ? ` ${l.uom_master.uom_code}` : ''}</div>
            <div style={{ fontSize: 13, color: '#6B7280' }}>{money(l.unit_rate)}</div>
            <div style={{ fontSize: 13, color: '#6B7280' }}>{money(l.tax_amount)}</div>
            <div style={{ fontSize: 13, color: '#6B7280' }}>{l.tax_percent != null ? `${l.tax_percent}%` : '—'}</div>
            <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{money(l.line_total)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 280, border: '1px solid #E5E7EB', borderRadius: 8, background: '#fff', padding: 16 }}>
          <Row label="Subtotal" value={money(inv.subtotal)} />
          <Row label="Discount" value={money(inv.discount_amount)} />
          <Row label="Tax" value={money(inv.tax_amount)} />
          <div style={{ borderTop: '1px solid #E5E7EB', margin: '8px 0' }} />
          <Row label="Grand Total" value={money(inv.grand_total)} bold />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 13, color: bold ? '#111827' : '#6B7280', fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontSize: bold ? 15 : 13, color: '#111827', fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  );
}
