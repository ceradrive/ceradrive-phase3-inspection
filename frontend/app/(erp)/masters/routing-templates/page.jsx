'use client';

/**
 * CERADRIVE ERP — Routing Template Master (list)
 * CRUD + copy + active toggle. Reusable step library; not tied to any item.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter }   from 'next/navigation';
import { api }         from '../../../../lib/api.js';
import { useToast }    from '../../../../components/ui/Toast.jsx';

const LIMIT = 50;

function ActiveBadge({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      border: `1px solid ${active ? '#059669' : '#D1D5DB'}`,
      color: active ? '#059669' : '#6B7280', background: active ? '#ECFDF5' : '#F9FAFB',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function RoutingTemplateListPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [togglingId,   setTogglingId]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = { search, page, limit: LIMIT };
    if (statusFilter) params.is_active = statusFilter === 'active';
    const { data, meta, count, error } = await api.get('/api/v1/routing-templates/master', params);
    if (error) showToast('Failed to load routing templates.', 'error');
    else { setRows(data ?? []); setTotal(meta?.total ?? count ?? 0); }
    setLoading(false);
  }, [search, page, statusFilter, showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  async function handleToggle(row) {
    setTogglingId(row.id);
    const { error } = await api.post(`/api/v1/routing-templates/master/${row.id}/toggle-active`, { is_active: !row.is_active });
    setTogglingId(null);
    if (error) { showToast(error.message ?? 'Failed to update status.', 'error'); return; }
    showToast(`${row.template_code} ${!row.is_active ? 'activated' : 'inactivated'}.`, 'success');
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1000, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>Routing Templates</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{total} reusable process flow{total === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => router.push('/masters/routing-templates/new')}
          style={{ height: 36, padding: '0 18px', borderRadius: 6, background: '#4F46E5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
          + New Template
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name…"
          style={{ height: 34, width: 280, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#111827', outline: 'none' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ height: 34, padding: '0 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['Code', 'Name', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>
                No routing templates found.{' '}
                <span style={{ color: '#4F46E5', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/masters/routing-templates/new')}>Add the first one.</span>
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }}
                onClick={() => router.push(`/masters/routing-templates/${r.id}`)}>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#111827', fontWeight: 600 }}>{r.template_code}</td>
                <td style={{ padding: '10px 14px', color: '#374151' }}>{r.template_name}</td>
                <td style={{ padding: '10px 14px' }}><ActiveBadge active={r.is_active} /></td>
                <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => router.push(`/masters/routing-templates/${r.id}`)}
                    style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer', marginRight: 6 }}>Open</button>
                  <button onClick={() => handleToggle(r)} disabled={togglingId === r.id}
                    style={{ height: 28, padding: '0 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
                      border: `1px solid ${r.is_active ? '#FECACA' : '#BBF7D0'}`, background: '#fff', color: r.is_active ? '#DC2626' : '#059669' }}>
                    {togglingId === r.id ? '…' : r.is_active ? 'Inactivate' : 'Activate'}
                  </button>
                </td>
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
