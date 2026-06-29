'use client';

/**
 * CERADRIVE ERP — Tax Master (list). Simple editable tax rates. GET /api/v1/taxes.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter }                                from 'next/navigation';
import { api }                                      from '../../../../lib/api.js';

const GRID = 'minmax(180px,1fr) 100px 90px minmax(160px,1fr) 80px';

export default function TaxMasterPage() {
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
    const { data, error: err } = await api.get('/api/v1/taxes', params);
    if (err) { setError(err.message ?? 'Failed to load taxes.'); setLoading(false); return; }
    setRows(data ?? []); setLoading(false);
  }, [search]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Tax Master</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Simple editable tax rates</p>
        </div>
        <button onClick={() => router.push('/masters/taxes/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}>+ New Tax</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', marginBottom: 14, maxWidth: 280 }}>
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tax name"
          style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: '100%' }} />
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['Tax Code', 'Tax Name', 'Tax %', 'Active', 'Notes', ''].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {loading ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
          : error ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
          : rows.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>％</div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No taxes found</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search ? 'Try a different search' : 'Create your first tax'}</div>
            </div>
          ) : rows.map(t => (
            <div key={t.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 48, cursor: 'pointer' }}
              onClick={() => router.push(`/masters/taxes/${t.id}`)}>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{t.tax_code || '—'}</div>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{t.tax_name}</div>
              <div style={{ fontSize: 13, color: '#111827' }}>{t.tax_percent}%</div>
              <div><span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: `1px solid ${t.is_active ? '#059669' : '#D1D5DB'}`, color: t.is_active ? '#059669' : '#6B7280', background: '#fff' }}>{t.is_active ? 'Active' : 'Inactive'}</span></div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{t.notes || '—'}</div>
              <div style={{ fontSize: 13, color: '#2563EB' }}>Edit</div>
            </div>
          ))}
      </div>
    </div>
  );
}
