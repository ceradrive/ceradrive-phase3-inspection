'use client';

/**
 * CERADRIVE ERP — Item Master List (Phase 1B-1)
 * R46: Search first, plain labels, large touch targets.
 * Template: Warehouse list + Supplier /master API idiom.
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

export default function ItemListPage() {
  const router = useRouter();
  const toast = useToast();

  const [items,          setItems]          = useState([]);
  const [types,          setTypes]          = useState([]);
  const [categories,     setCategories]     = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [search,         setSearch]         = useState('');
  const [activeFilter,   setActiveFilter]   = useState('');
  const [typeFilter,     setTypeFilter]     = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [toggling,       setToggling]       = useState(null);

  const LIMIT = 50;

  // Load lookups once for filter dropdowns + id→name maps for table display.
  useEffect(() => {
    api.get('/api/v1/items/lookups').then(({ data }) => {
      setTypes(data?.item_types ?? []);
      setCategories(data?.item_categories ?? []);
    });
  }, []);

  const typeName = (id) => types.find(t => t.id === id)?.type_name ?? '—';
  const catName  = (id) => categories.find(c => c.id === id)?.category_name ?? '—';

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error, meta } = await api.get('/api/v1/items/master', {
      search, is_active: activeFilter, item_type_id: typeFilter, category_id: categoryFilter,
      page, limit: LIMIT,
    });
    if (error) toast('Failed to load items.');
    else { setItems(data ?? []); setTotal(meta?.total ?? 0); }
    setLoading(false);
  }, [search, activeFilter, typeFilter, categoryFilter, page, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, activeFilter, typeFilter, categoryFilter]);

  async function handleToggle(item) {
    setToggling(item.id);
    const { data, error } = await api.post(`/api/v1/items/master/${item.id}/toggle-active`, { is_active: !item.is_active });
    setToggling(null);
    if (error) {
      toast(error.message ?? 'Failed to update status.');
    } else {
      toast(`${data.item_code} ${data.is_active ? 'activated' : 'deactivated'}.`);
      setItems(prev => prev.map(it => it.id === data.id ? { ...it, is_active: data.is_active } : it));
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>Items</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{total} records</p>
        </div>
        <button
          onClick={() => router.push('/masters/items/new')}
          style={{ height: 36, padding: '0 18px', borderRadius: 6, background: '#4F46E5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          + New Item
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search code or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ height: 34, width: 220, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, outline: 'none', color: '#374151' }}
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{ height: 34, padding: '0 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">All types</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{ height: 34, padding: '0 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.category_name}</option>)}
        </select>
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
              {['Code', 'Name', 'Type', 'Category', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>
                No items found.{' '}
                <span style={{ color: '#4F46E5', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/masters/items/new')}>
                  Create the first one.
                </span>
              </td></tr>
            ) : items.map((item, i) => (
              <tr key={item.id}
                style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }}
                onClick={() => router.push(`/masters/items/${item.id}`)}>
                <td style={{ padding: '10px 16px', fontWeight: 600, color: '#111827', fontFamily: 'monospace', fontSize: 13 }}>{item.item_code}</td>
                <td style={{ padding: '10px 16px', color: '#374151' }}>{item.item_name}</td>
                <td style={{ padding: '10px 16px', color: '#6B7280', fontSize: 12 }}>{typeName(item.item_type_id)}</td>
                <td style={{ padding: '10px 16px', color: '#6B7280', fontSize: 12 }}>{catName(item.category_id)}</td>
                <td style={{ padding: '10px 16px' }}><ActiveBadge is_active={item.is_active} /></td>
                <td style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => router.push(`/masters/items/${item.id}`)}
                      style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggle(item)}
                      disabled={toggling === item.id}
                      style={{
                        height: 28, padding: '0 10px', borderRadius: 5, fontSize: 12,
                        cursor: toggling === item.id ? 'not-allowed' : 'pointer',
                        border:      `1px solid ${item.is_active ? '#FECACA' : '#BBF7D0'}`,
                        background:  item.is_active ? '#FEF2F2' : '#F0FDF4',
                        color:       item.is_active ? '#DC2626' : '#059669',
                      }}>
                      {toggling === item.id ? '…' : item.is_active ? 'Deactivate' : 'Activate'}
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
