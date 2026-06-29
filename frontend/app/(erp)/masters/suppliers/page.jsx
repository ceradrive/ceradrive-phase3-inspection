'use client';

/**
 * CERADRIVE ERP — Supplier Master List
 * R46: Search first, plain labels, large touch targets.
 * R45: Mandatory fields = supplier_code + supplier_name only.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter }                        from 'next/navigation';
import { api }                              from '../../../../lib/api.js';
import { useToast }                         from '../../../../components/ui/Toast.jsx';

function ActiveBadge({ is_active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      border:     `1px solid ${is_active ? '#059669' : '#D1D5DB'}`,
      color:      is_active ? '#059669' : '#6B7280',
      background: is_active ? '#ECFDF5' : '#F9FAFB',
      whiteSpace: 'nowrap',
    }}>
      {is_active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function SupplierListPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [suppliers,    setSuppliers]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [toggling,     setToggling]     = useState(null);

  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, count, error } = await api.get('/api/v1/suppliers/master', {
      search, is_active: activeFilter, page, limit: LIMIT,
    });
    if (error) showToast('Failed to load suppliers.', 'error');
    else { setSuppliers(data ?? []); setTotal(count ?? 0); }
    setLoading(false);
  }, [search, activeFilter, page, showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, activeFilter]);

  async function handleToggle(sup) {
    setToggling(sup.id);
    const { data, error } = await api.post(`/api/v1/suppliers/master/${sup.id}/toggle-active`, {});
    setToggling(null);
    if (error) {
      showToast(error.message ?? 'Failed to update status.', 'error');
    } else {
      showToast(`${data.supplier_code} ${data.is_active ? 'activated' : 'deactivated'}.`, 'success');
      setSuppliers(prev => prev.map(s => s.id === data.id ? { ...s, is_active: data.is_active } : s));
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>Suppliers</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{total} records</p>
        </div>
        <button
          onClick={() => router.push('/masters/suppliers/new')}
          style={{ height: 36, padding: '0 18px', borderRadius: 6, background: '#4F46E5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          + New Supplier
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search code, name, or GSTIN…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ height: 34, width: 260, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, outline: 'none', color: '#374151' }}
        />
        <select
          value={activeFilter}
          onChange={e => setActiveFilter(e.target.value)}
          style={{ height: 34, padding: '0 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">All</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['Code', 'Name', 'Contact', 'City / State', 'GSTIN', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>
                No suppliers found.{' '}
                <span style={{ color: '#4F46E5', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/masters/suppliers/new')}>
                  Add the first one.
                </span>
              </td></tr>
            ) : suppliers.map((s, i) => (
              <tr key={s.id}
                style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }}
                onClick={() => router.push(`/masters/suppliers/${s.id}`)}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#111827', fontFamily: 'monospace', fontSize: 12 }}>{s.supplier_code}</td>
                <td style={{ padding: '10px 14px', color: '#374151', fontWeight: 500 }}>{s.supplier_name}</td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontSize: 12 }}>
                  {s.contact_name && <div>{s.contact_name}</div>}
                  {s.contact_mobile && <div>{s.contact_mobile}</div>}
                </td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontSize: 12 }}>
                  {[s.city, s.state].filter(Boolean).join(', ') || '—'}
                </td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontFamily: 'monospace', fontSize: 11 }}>{s.gstin || '—'}</td>
                <td style={{ padding: '10px 14px' }}><ActiveBadge is_active={s.is_active} /></td>
                <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => router.push(`/masters/suppliers/${s.id}`)}
                      style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggle(s)}
                      disabled={toggling === s.id}
                      style={{
                        height: 28, padding: '0 10px', borderRadius: 5, fontSize: 12,
                        cursor: toggling === s.id ? 'not-allowed' : 'pointer',
                        border:      `1px solid ${s.is_active ? '#FECACA' : '#BBF7D0'}`,
                        background:  s.is_active ? '#FEF2F2' : '#F0FDF4',
                        color:       s.is_active ? '#DC2626' : '#059669',
                      }}>
                      {toggling === s.id ? '…' : s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
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
