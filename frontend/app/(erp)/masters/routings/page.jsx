'use client';

/**
 * CERADRIVE ERP — Process Flow (Routing Master) List
 * CRUD only. Routing identity = item + routing type + version. No is_active toggle (header uses status).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter }                        from 'next/navigation';
import { api }                              from '../../../../lib/api.js';
import { useToast }                         from '../../../../components/ui/Toast.jsx';

const STATUS_LABELS = { draft: 'Draft', active: 'Active', superseded: 'Superseded' };
const STATUS_COLORS = {
  draft:      { fg: '#B45309', bg: '#FFFBEB', bd: '#F59E0B' },
  active:     { fg: '#059669', bg: '#ECFDF5', bd: '#059669' },
  superseded: { fg: '#6B7280', bg: '#F9FAFB', bd: '#D1D5DB' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.superseded;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      border: `1px solid ${c.bd}`, color: c.fg, background: c.bg,
    }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function RoutingListPage() {
  const router = useRouter();
  const addToast = useToast();

  const [routings,     setRoutings]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, meta, count, error } = await api.get('/api/v1/routings/master', {
      status: statusFilter, page, limit: LIMIT,
    });
    if (error) addToast('Failed to load process flows.');
    else { setRoutings(data ?? []); setTotal(meta?.total ?? count ?? 0); }
    setLoading(false);
  }, [statusFilter, page, addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>Process Flow</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{total} records</p>
        </div>
        <button
          onClick={() => router.push('/masters/routings/new')}
          style={{ height: 36, padding: '0 18px', borderRadius: 6, background: '#4F46E5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          + New Process Flow
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ height: 34, padding: '0 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['Item', 'Routing Type', 'Version', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : routings.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>
                No process flows found.{' '}
                <span style={{ color: '#4F46E5', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/masters/routings/new')}>
                  Add the first one.
                </span>
              </td></tr>
            ) : routings.map((r, i) => (
              <tr key={r.id}
                style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }}
                onClick={() => router.push(`/masters/routings/${r.id}`)}>
                <td style={{ padding: '10px 14px', color: '#374151', fontWeight: 500 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#111827', fontWeight: 600 }}>{r.item?.item_code || '—'}</span>
                  {r.item?.item_name && <span style={{ color: '#6B7280', marginLeft: 8 }}>{r.item.item_name}</span>}
                </td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontSize: 12 }}>{r.routing_type?.type_name || '—'}</td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontFamily: 'monospace', fontSize: 12 }}>v{r.version_number}</td>
                <td style={{ padding: '10px 14px' }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => router.push(`/masters/routings/${r.id}`)}
                    style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, cursor: page === 1 ? 'not-allowed' : 'pointer', color: '#374151' }}>
            Previous
          </button>
          <span style={{ fontSize: 13, color: '#6B7280' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, cursor: page === totalPages ? 'not-allowed' : 'pointer', color: '#374151' }}>
            Next
          </button>
        </div>
      )}

    </div>
  );
}
