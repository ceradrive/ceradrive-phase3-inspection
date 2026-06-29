'use client';

/**
 * CERADRIVE ERP — Process Type Master (list)
 * Mirrors Item Type Master list. Search + table + active toggle + pagination.
 */

import { useCallback, useEffect, useState } from 'react';
import Link            from 'next/link';
import { useRouter }   from 'next/navigation';
import { api }         from '../../../../lib/api.js';
import { useToast }    from '../../../../components/ui/Toast.jsx';

const PAGE_SIZE = 20;

function ActiveBadge({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 999,
      fontSize: 12, fontWeight: 500,
      background: active ? '#ECFDF5' : '#F3F4F6',
      color: active ? '#059669' : '#6B7280',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function FlagPills({ row }) {
  const pills = [];
  if (row.is_bottleneck) pills.push(['Bottleneck', '#FEF2F2', '#DC2626']);
  if (row.is_wo_driven) pills.push(['WO-driven', '#EEF2FF', '#4F46E5']);
  if (row.generates_stage_item) pills.push(['Stage item', '#F0FDF4', '#059669']);
  if (pills.length === 0) return <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {pills.map(([t, bg, c]) => (
        <span key={t} style={{ fontSize: 11, fontWeight: 500, padding: '1px 7px', borderRadius: 4, background: bg, color: c }}>{t}</span>
      ))}
    </span>
  );
}

export default function ProcessTypesPage() {
  const router = useRouter();
  const toast = useToast();

  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, meta, error } = await api.get('/api/v1/process-types/master', {
      page,
      limit: PAGE_SIZE,
      search,
    });
    setLoading(false);
    if (error) { toast(error.message ?? 'Failed to load process types.'); return; }
    setRows(data ?? []);
    setTotal(meta?.total ?? 0);
  }, [page, search, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(row) {
    setTogglingId(row.id);
    const { error } = await api.post(`/api/v1/process-types/master/${row.id}/toggle-active`, {
      is_active: !row.is_active,
    });
    setTogglingId(null);
    if (error) { toast(error.message ?? 'Failed to update status.'); return; }
    toast(`${row.type_code} ${!row.is_active ? 'activated' : 'deactivated'}.`);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', margin: 0 }}>Process Type Master</h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>Manufacturing process stages and their stage-item configuration.</p>
        </div>
        <Link href="/masters/process-types/new"
          style={{ height: 36, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#4F46E5', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          + New Process Type
        </Link>
      </div>

      <div style={{ marginBottom: 14, maxWidth: 320 }}>
        <input
          value={search}
          onChange={e => { setPage(1); setSearch(e.target.value); }}
          placeholder="Search by code or name…"
          style={{ width: '100%', height: 36, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6,
            fontSize: 13, color: '#111827', outline: 'none' }}
        />
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', textAlign: 'left', color: '#6B7280' }}>
              <th style={{ padding: '10px 14px', fontWeight: 500, width: 60 }}>Seq</th>
              <th style={{ padding: '10px 14px', fontWeight: 500, width: 130 }}>Code</th>
              <th style={{ padding: '10px 14px', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '10px 14px', fontWeight: 500 }}>Flags</th>
              <th style={{ padding: '10px 14px', fontWeight: 500, width: 90 }}>Status</th>
              <th style={{ padding: '10px 14px', fontWeight: 500, width: 150, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>No process types found.</td></tr>
            ) : rows.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={{ padding: '10px 14px', color: '#6B7280' }}>{row.seq_no}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#111827' }}>{row.type_code}</td>
                <td style={{ padding: '10px 14px', color: '#111827' }}>{row.type_name}</td>
                <td style={{ padding: '10px 14px' }}><FlagPills row={row} /></td>
                <td style={{ padding: '10px 14px' }}><ActiveBadge active={row.is_active} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                  <button
                    onClick={() => router.push(`/masters/process-types/${row.id}`)}
                    style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 6, padding: '4px 10px',
                      fontSize: 12, color: '#374151', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                  <button
                    onClick={() => handleToggle(row)}
                    disabled={togglingId === row.id}
                    style={{ background: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                      border: `1px solid ${row.is_active ? '#FECACA' : '#BBF7D0'}`,
                      color: row.is_active ? '#DC2626' : '#059669' }}>
                    {togglingId === row.id ? '…' : row.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, fontSize: 13, color: '#6B7280' }}>
        <span>{total} process type{total === 1 ? '' : 's'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ padding: '4px 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff',
              cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? '#9CA3AF' : '#374151' }}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            style={{ padding: '4px 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer', color: page >= totalPages ? '#9CA3AF' : '#374151' }}>Next</button>
        </div>
      </div>
    </div>
  );
}
