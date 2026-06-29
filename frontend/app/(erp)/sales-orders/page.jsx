'use client';

/**
 * CERADRIVE ERP — Sales Orders (list). Draft-only. GET /api/v1/sales-orders/master.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter }                                from 'next/navigation';
import { api }                                      from '../../../lib/api.js';

const GRID = '150px minmax(180px,1fr) 110px 120px 90px 120px';

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d); if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const STATUS_STYLE = { draft: { color: '#6B7280', borderColor: '#D1D5DB' } };
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: `1px solid ${s.borderColor}`, color: s.color, background: '#fff' }}>{status ?? 'draft'}</span>;
}
function custName(o) { return o.customer_master?.customer_name ?? o.customer_name ?? '—'; }

export default function SalesOrdersPage() {
  const router = useRouter();
  const searchRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  const fetchRows = useCallback(async () => {
    setLoading(true); setError(null);
    const params = { page, limit: LIMIT };
    if (search) params.search = search;
    if (dateFilter) { params.date_from = dateFilter; params.date_to = dateFilter; }
    const { data, error: err, meta } = await api.get('/api/v1/sales-orders/master', params);
    if (err) { setError(err.message ?? 'Failed to load sales orders.'); setLoading(false); return; }
    setRows(data ?? []); setTotal(meta?.total ?? 0); setLoading(false);
  }, [page, search, dateFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Sales Orders</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Customer sales orders</p>
        </div>
        <button onClick={() => router.push('/sales-orders/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}>+ New Sales Order</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input type="date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} title="Filter by SO date"
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px' }}>
          <input ref={searchRef} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search SO #"
            style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: 200 }} />
        </div>
        {dateFilter && <button onClick={() => { setDateFilter(''); setPage(1); }} style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 12px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Clear date</button>}
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['SO Number', 'Customer', 'SO Date', 'Delivery', 'Status', 'Created'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {loading ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
          : error ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
          : rows.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🧾</div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No sales orders found</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search || dateFilter ? 'Try different filters' : 'Create your first sales order'}</div>
            </div>
          ) : rows.map(o => (
            <div key={o.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 50, cursor: 'pointer' }}
              onClick={() => router.push(`/sales-orders/${o.id}`)}>
              <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, whiteSpace: 'nowrap' }}>{o.so_number}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{custName(o)}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{formatDate(o.so_date)}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{o.delivery_date ? formatDate(o.delivery_date) : '—'}</div>
              <div><StatusBadge status={o.status} /></div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{formatDate(o.created_at)}</div>
            </div>
          ))}
        {!loading && !error && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>Showing {rows.length} of {total} entries</span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E5E7EB', background: '#fff', cursor: page === 1 ? 'default' : 'pointer', color: '#6B7280', opacity: page === 1 ? 0.4 : 1 }}>‹</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E5E7EB', background: '#fff', cursor: page === totalPages ? 'default' : 'pointer', color: '#6B7280', opacity: page === totalPages ? 0.4 : 1 }}>›</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
