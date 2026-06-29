'use client';

/**
 * CERADRIVE ERP — Sales Invoices (list). Read-only. GET /api/v1/sales-invoices.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter }                                from 'next/navigation';
import { api }                                      from '../../../lib/api.js';

const GRID = '150px minmax(180px,1fr) 130px 110px 90px 120px';

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
  draft:     { color: '#6B7280', borderColor: '#D1D5DB' },
  posted:    { color: '#047857', borderColor: '#6EE7B7' },
  cancelled: { color: '#B91C1C', borderColor: '#FCA5A5' },
};
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: `1px solid ${s.borderColor}`, color: s.color, background: '#fff' }}>{status ?? 'draft'}</span>;
}
function custName(o) { return o.customer_master?.customer_name ?? '—'; }
function soNumber(o) { return o.sales_order_headers?.so_number ?? '—'; }

export default function SalesInvoicesPage() {
  const router = useRouter();
  const searchRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true); setError(null);
    const params = {};
    if (search) params.search = search;
    const { data, error: err } = await api.get('/api/v1/sales-invoices', params);
    if (err) { setError(err.message ?? 'Failed to load sales invoices.'); setLoading(false); return; }
    setRows(data ?? []); setLoading(false);
  }, [search]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Sales Invoices</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Customer sale bills (read-only)</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px' }}>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice #"
            style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: 220 }} />
        </div>
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['Invoice #', 'Customer', 'SO Number', 'Date', 'Status', 'Total'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {loading ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
          : error ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
          : rows.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🧾</div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No sales invoices found</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search ? 'Try a different search' : 'Create an invoice from an approved sales order'}</div>
            </div>
          ) : rows.map(o => (
            <div key={o.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 50, cursor: 'pointer' }}
              onClick={() => router.push(`/sales-invoices/${o.id}`)}>
              <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, whiteSpace: 'nowrap' }}>{o.invoice_number}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{custName(o)}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{soNumber(o)}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{formatDate(o.invoice_date)}</div>
              <div><StatusBadge status={o.status} /></div>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{money(o.grand_total)}</div>
            </div>
          ))}
        {!loading && !error && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', background: '#fff' }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>Showing {rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
