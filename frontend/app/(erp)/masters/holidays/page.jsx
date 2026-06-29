'use client';

/**
 * CERADRIVE ERP — Holiday Master list.
 * DB table: holiday_master. API: /api/v1/holidays.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';

const GRID = '120px minmax(190px,1fr) 120px 90px 90px 80px 80px';

function fmtDate(v) {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

export default function HolidayMasterPage() {
  const router = useRouter();
  const searchRef = useRef(null);
  const currentYear = String(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(currentYear);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = {};
    if (search) params.search = search;
    if (year) params.year = year;
    const { data, error: err } = await api.get('/api/v1/holidays', params);
    if (err) {
      setError(err.message ?? 'Failed to load holidays.');
      setLoading(false);
      return;
    }
    setRows(data ?? []);
    setLoading(false);
  }, [search, year]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  return (
    <div style={{ maxWidth: 1060 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Holiday Master</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Editable holiday list for attendance and salary calculations</p>
        </div>
        <button onClick={() => router.push('/masters/holidays/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}>
          + New Holiday
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', width: 300 }}>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search holiday"
            style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: '100%' }} />
        </div>
        <input value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="Year" style={{ height: 36, width: 90, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none' }} />
        {year && <button onClick={() => setYear('')} style={{ height: 36, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>All years</button>}
      </div>

      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['Date', 'Name', 'Type', 'Paid', 'Active', 'Notes', ''].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</div>
          ))}
        </div>
        {loading ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading…</div>
          : error ? <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
          : rows.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No holidays found</div>
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search ? 'Try a different search' : 'Create your first holiday'}</div>
            </div>
          ) : rows.map(row => (
            <div key={row.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 48, cursor: 'pointer' }}
              onClick={() => router.push(`/masters/holidays/${row.id}`)}>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 600, fontFamily: 'monospace' }}>{fmtDate(row.holiday_date)}</div>
              <div style={{ fontSize: 13, color: '#111827', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{row.holiday_name}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{row.holiday_type || 'GENERAL'}</div>
              <div style={{ fontSize: 13, color: row.is_paid ? '#047857' : '#B45309' }}>{row.is_paid ? 'Paid' : 'Unpaid'}</div>
              <div><span style={{ fontSize: 12, color: row.is_active ? '#047857' : '#9CA3AF' }}>{row.is_active ? 'Active' : 'Inactive'}</span></div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{row.notes || '—'}</div>
              <button onClick={e => { e.stopPropagation(); router.push(`/masters/holidays/${row.id}`); }}
                style={{ justifySelf: 'end', height: 30, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>Edit</button>
            </div>
          ))}
      </div>
    </div>
  );
}
