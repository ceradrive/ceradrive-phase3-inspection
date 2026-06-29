'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api.js';
import { useToast } from '../../../../components/ui/Toast.jsx';

const LIMIT = 50;

const wrap   = { padding: 24, maxWidth: 1000, margin: '0 auto' };
const h1     = { fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 };
const btn    = { background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer', textDecoration: 'none' };
const input  = { height: 38, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, outline: 'none', width: 260 };
const th     = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E5E7EB' };
const td     = { padding: '10px 12px', fontSize: 14, color: '#374151', borderBottom: '1px solid #F3F4F6' };

function ActiveBadge({ active }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
      color: active ? '#059669' : '#9CA3AF', background: active ? '#ECFDF5' : '#F3F4F6' }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function ItemCategoryListPage() {
  const toast = useToast();
  const [rows, setRows]   = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search.trim()) params.set('search', search.trim());
    const { data, error, meta } = await api.get(`/api/v1/item-categories/master?${params.toString()}`);
    if (error) { toast('Failed to load item categories.'); setLoading(false); return; }
    setRows(data ?? []);
    setTotal(meta?.total ?? 0);
    setLoading(false);
  }, [page, search, toast]);

  useEffect(() => { load(); }, [load]);

  async function toggle(row) {
    const { error } = await api.post(`/api/v1/item-categories/master/${row.id}/toggle-active`, { is_active: !row.is_active });
    if (error) { toast('Failed to update status.'); return; }
    toast(`Category ${!row.is_active ? 'activated' : 'deactivated'}.`);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 style={h1}>Item Category Master</h1>
        <Link href="/masters/item-categories/new" style={btn}>+ New Category</Link>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input style={input} placeholder="Search code or name…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Code</th>
              <th style={th}>Name</th>
              <th style={th}>Description</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td style={td} colSpan={5}>Loading…</td></tr>
              : rows.length === 0
                ? <tr><td style={td} colSpan={5}>No categories found.</td></tr>
                : rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.category_code}</td>
                      <td style={td}>{r.category_name}</td>
                      <td style={{ ...td, color: '#6B7280' }}>{r.description || '—'}</td>
                      <td style={td}><ActiveBadge active={r.is_active} /></td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <Link href={`/masters/item-categories/${r.id}`} style={{ color: '#4F46E5', marginRight: 12, textDecoration: 'none' }}>Edit</Link>
                        <button onClick={() => toggle(r)} style={{ background: 'none', border: 'none', color: r.is_active ? '#DC2626' : '#059669', cursor: 'pointer', fontSize: 14 }}>
                          {r.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ ...btn, background: page <= 1 ? '#E5E7EB' : '#4F46E5', cursor: page <= 1 ? 'default' : 'pointer' }}>Prev</button>
          <span style={{ fontSize: 13, color: '#6B7280' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            style={{ ...btn, background: page >= totalPages ? '#E5E7EB' : '#4F46E5', cursor: page >= totalPages ? 'default' : 'pointer' }}>Next</button>
        </div>
      )}
    </div>
  );
}
