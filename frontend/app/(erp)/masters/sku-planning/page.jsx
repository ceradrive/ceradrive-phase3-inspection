'use client';

/**
 * CERADRIVE ERP — SKU Planning Master (list)
 * Plans = how-fast/how-much parameters layered on a chosen routing. CRUD only (S1).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api }       from '../../../../lib/api.js';
import { useToast }  from '../../../../components/ui/Toast.jsx';

const LIMIT = 50;
const STATUS_STYLE = {
  draft:      { border: '#F59E0B', color: '#B45309', bg: '#FFFBEB' },
  active:     { border: '#059669', color: '#059669', bg: '#ECFDF5' },
  superseded: { border: '#D1D5DB', color: '#6B7280', bg: '#F9FAFB' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      border: `1px solid ${s.border}`, color: s.color, background: s.bg, textTransform: 'capitalize' }}>{status}</span>
  );
}

export default function SkuPlanningListPage() {
  const router = useRouter();
  const addToast = useToast();

  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (statusFilter) params.status = statusFilter;
    const { data, meta, count, error } = await api.get('/api/v1/sku-planning/master', params);
    if (error) addToast('Failed to load SKU plans.');
    else { setRows(data ?? []); setTotal(meta?.total ?? count ?? 0); }
    setLoading(false);
  }, [page, statusFilter, addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1000, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>SKU Planning</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{total} plan{total === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => router.push('/masters/sku-planning/new')}
          style={{ height: 36, padding: '0 18px', borderRadius: 6, background: '#4F46E5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>+ New Plan</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ height: 34, padding: '0 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['Item', 'Routing type', 'Status', 'Created'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>
                No SKU plans found.{' '}
                <span style={{ color: '#4F46E5', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/masters/sku-planning/new')}>Add the first one.</span>
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }}
                onClick={() => router.push(`/masters/sku-planning/${r.id}`)}>
                <td style={{ padding: '10px 14px', color: '#111827' }}>
                  {r.item ? <><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.item.item_code}</span> <span style={{ color: '#6B7280' }}>{r.item.item_name}</span></> : '—'}
                </td>
                <td style={{ padding: '10px 14px', color: '#374151' }}>{r.routing_type?.type_name ?? '—'}</td>
                <td style={{ padding: '10px 14px' }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: '10px 14px', color: '#6B7280' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, cursor: page === 1 ? 'not-allowed' : 'pointer', color: '#374151' }}>Previous</button>
          <span style={{ fontSize: 13, color: '#6B7280' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, cursor: page === totalPages ? 'not-allowed' : 'pointer', color: '#374151' }}>Next</button>
        </div>
      )}

    </div>
  );
}
