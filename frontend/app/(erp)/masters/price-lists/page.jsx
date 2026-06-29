'use client';

/**
 * CERADRIVE ERP — Price List Master (list). Mirrors master list pattern.
 * Data: GET /api/v1/price-lists/master (paged, meta.total).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter }                                from 'next/navigation';
import { api }                                      from '../../../../lib/api.js';
import { useToast }                                 from '../../../../components/ui/Toast.jsx';

const GRID = '160px minmax(180px,1fr) 90px 90px 90px';

function ActiveBadge({ active }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      border: `1px solid ${active ? '#059669' : '#D1D5DB'}`, color: active ? '#059669' : '#6B7280', background: '#fff', whiteSpace: 'nowrap' }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function PriceListsPage() {
  const router = useRouter();
  const addToast = useToast();
  const searchRef = useRef(null);

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);
  const LIMIT = 20;

  const fetchRows = useCallback(async () => {
    setLoading(true); setError(null);
    const params = { page, limit: LIMIT };
    if (search) params.search = search;
    const { data, error: err, meta } = await api.get('/api/v1/price-lists/master', params);
    if (err) { setError(err.message ?? 'Failed to load price lists.'); setLoading(false); return; }
    setRows(data ?? []); setTotal(meta?.total ?? 0); setLoading(false);
  }, [page, search]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Price List Master</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Item price lists with revisions</p>
        </div>
        <button onClick={() => router.push('/masters/price-lists/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + New Price List
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px' }}>
          <input ref={searchRef} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search code or name"
            style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: 240 }} />
        </div>
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['Code', 'Name', 'Revision', 'Currency', 'Status'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🏷️</div>
            <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No price lists found</div>
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search ? 'Try a different search' : 'Create your first price list'}</div>
          </div>
        ) : (
          rows.map(r => (
            <div key={r.id} className="erp-table-row"
              style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 50, cursor: 'pointer' }}
              onClick={() => router.push(`/masters/price-lists/${r.id}`)}>
              <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.price_list_code}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{r.price_list_name}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>v{r.revision}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{r.currency}</div>
              <div><ActiveBadge active={r.is_active} /></div>
            </div>
          ))
        )}
        {!loading && !error && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>Showing {rows.length} of {total} entries</span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E5E7EB', background: '#fff', cursor: page === 1 ? 'default' : 'pointer', color: '#6B7280', opacity: page === 1 ? 0.4 : 1 }}>‹</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E5E7EB', background: '#fff', cursor: page === totalPages ? 'default' : 'pointer', color: '#6B7280', opacity: page === totalPages ? 0.4 : 1 }}>›</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
