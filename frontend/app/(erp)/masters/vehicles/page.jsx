'use client';

/**
 * CERADRIVE ERP — Vehicle Master List
 * Standalone master page for item/vehicle compatibility.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';
import { useToast } from '../../../../components/ui/Toast.jsx';

function notify(toast, message, type = 'info') {
  if (typeof toast === 'function') return toast(message, type);
  if (typeof toast?.showToast === 'function') return toast.showToast(message, type);
  if (typeof toast?.toast === 'function') return toast.toast(message, type);
  if (type === 'success' && typeof toast?.success === 'function') return toast.success(message);
  if (type === 'error' && typeof toast?.error === 'function') return toast.error(message);
  if (typeof toast?.addToast === 'function') return toast.addToast({ message, type });
  if (type === 'error') console.error(message);
  else console.log(message);
}

function ActiveBadge({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      border: `1px solid ${active ? '#059669' : '#D1D5DB'}`,
      color: active ? '#059669' : '#6B7280',
      background: active ? '#ECFDF5' : '#F9FAFB',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

const GRID = 'minmax(220px, 1fr) minmax(160px, 220px) 100px';

export default function VehicleListPage() {
  const router = useRouter();
  const toast = useToast();
  const searchRef = useRef(null);

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = { page, limit: LIMIT };
    if (search) params.search = search;
    if (activeFilter !== '') params.is_active = activeFilter;
    const { data, error: err, meta } = await api.get('/api/v1/vehicles/master', params);
    if (err) {
      setError(err.message ?? 'Failed to load vehicles.');
      notify(toast, err.message ?? 'Failed to load vehicles.', 'error');
    } else {
      setVehicles(data ?? []);
      setTotal(meta?.total ?? 0);
    }
    setLoading(false);
  }, [page, search, activeFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, activeFilter]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ maxWidth: 1050 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Vehicle Master</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Vehicles used for item compatibility and sales order printing</p>
        </div>
        <button onClick={() => router.push('/masters/vehicles/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + New Vehicle
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px' }}>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicle or make"
            style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: 260 }} />
        </div>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', fontSize: 13, color: '#374151', background: '#fff' }}>
          <option value="">All statuses</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['Vehicle', 'Make', 'Status'].map(h => (
            <div key={h} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
        ) : vehicles.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🚗</div>
            <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No vehicles found</div>
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search ? 'Try a different search' : 'Create your first vehicle'}</div>
          </div>
        ) : (
          vehicles.map(v => (
            <div key={v.id} className="erp-table-row"
              style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 50, cursor: 'pointer' }}
              onClick={() => router.push(`/masters/vehicles/${v.id}`)}>
              <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{v.vehicle_name}</div>
              <div style={{ fontSize: 13, color: v.make ? '#374151' : '#9CA3AF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{v.make || '—'}</div>
              <div><ActiveBadge active={v.is_active} /></div>
            </div>
          ))
        )}

        {!loading && !error && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>Showing {vehicles.length} of {total} entries</span>
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
