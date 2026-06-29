'use client';

/**
 * CERADRIVE ERP — Shift Master list.
 * DB table: shift_master. API: /api/v1/shifts.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

const GRID = '110px minmax(180px,1fr) 105px 105px 110px 130px 90px 80px';

function fmtTime(v) {
  return v ? String(v).slice(0, 5) : '—';
}

export default function ShiftMasterPage() {
  const router = useRouter();
  const searchRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = {};
    if (search) params.search = search;
    const { data, error: err } = await api.get('/api/v1/shifts', params);
    if (err) {
      setError(err.message ?? 'Failed to load shifts.');
      setLoading(false);
      return;
    }
    setRows(data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Shift Master</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Manage shift timings used by production logs and attendance</p>
        </div>
        <button onClick={() => router.push('/masters/shifts/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}>
          + New Shift
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', marginBottom: 14, maxWidth: 320 }}>
        <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shift"
          style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: '100%' }} />
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['Code', 'Name', 'Start', 'End', 'Midnight', 'Working Days', 'Active', ''].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {loading ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
          : error ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
          : rows.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏱️</div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No shifts found</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search ? 'Try a different search' : 'Create your first shift'}</div>
            </div>
          ) : rows.map(row => (
            <div key={row.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 48, cursor: 'pointer' }}
              onClick={() => router.push(`/masters/shifts/${row.id}`)}>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 600, fontFamily: 'monospace' }}>{row.shift_code}</div>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{row.shift_name}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{fmtTime(row.start_time)}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{fmtTime(row.end_time)}</div>
              <div style={{ fontSize: 13, color: row.crosses_midnight ? '#B45309' : '#6B7280' }}>{row.crosses_midnight ? 'Yes' : 'No'}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{row.working_days || '—'}</div>
              <div><span style={{ fontSize: 12, color: row.is_active ? '#047857' : '#9CA3AF' }}>{row.is_active ? 'Active' : 'Inactive'}</span></div>
              <button onClick={e => { e.stopPropagation(); router.push(`/masters/shifts/${row.id}`); }}
                style={{ justifySelf: 'end', height: 30, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>Edit</button>
            </div>
          ))}
      </div>
    </div>
  );
}
