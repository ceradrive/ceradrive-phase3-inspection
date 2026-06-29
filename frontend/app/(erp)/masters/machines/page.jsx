'use client';

/**
 * CERADRIVE ERP — Machine Master List
 * R46: Search first, plain labels, large touch targets.
 * Mandatory at create: machine_code, machine_name, machine_type.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter }                        from 'next/navigation';
import { api }                              from '../../../../lib/api.js';
import { useToast }                         from '../../../../components/ui/Toast.jsx';

const STATUS_LABELS = { active: 'Active', under_maintenance: 'Under maintenance', retired: 'Retired' };
const STATUS_COLORS = {
  active:            { fg: '#059669', bg: '#ECFDF5', bd: '#059669' },
  under_maintenance: { fg: '#B45309', bg: '#FFFBEB', bd: '#F59E0B' },
  retired:           { fg: '#6B7280', bg: '#F9FAFB', bd: '#D1D5DB' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.retired;
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

function ActiveBadge({ is_active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      border:     `1px solid ${is_active ? '#059669' : '#D1D5DB'}`,
      color:      is_active ? '#059669' : '#6B7280',
      background: is_active ? '#ECFDF5' : '#F9FAFB',
    }}>
      {is_active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function MachineListPage() {
  const router = useRouter();
  const addToast = useToast();

  const [machines,     setMachines]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [toggling,     setToggling]     = useState(null);

  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, count, error } = await api.get('/api/v1/machines/master', {
      search, is_active: activeFilter, page, limit: LIMIT,
    });
    if (error) addToast('Failed to load machines.', 'error');
    else { setMachines(data ?? []); setTotal(count ?? 0); }
    setLoading(false);
  }, [search, activeFilter, page, addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, activeFilter]);

  async function handleToggle(mc) {
    setToggling(mc.id);
    const { data, error } = await api.post(`/api/v1/machines/master/${mc.id}/toggle-active`, {});
    setToggling(null);
    if (error) {
      addToast(error.message ?? 'Failed to update status.', 'error');
    } else {
      addToast(`${data.machine_code} ${data.is_active ? 'activated' : 'deactivated'}.`, 'success');
      setMachines(prev => prev.map(m => m.id === data.id ? { ...m, is_active: data.is_active } : m));
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>Machines</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{total} records</p>
        </div>
        <button
          onClick={() => router.push('/masters/machines/new')}
          style={{ height: 36, padding: '0 18px', borderRadius: 6, background: '#4F46E5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          + New Machine
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search code or name…"
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
              {['Code', 'Name', 'Type', 'Capacity', 'Status', 'Active', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
            ) : machines.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>
                No machines found.{' '}
                <span style={{ color: '#4F46E5', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/masters/machines/new')}>
                  Add the first one.
                </span>
              </td></tr>
            ) : machines.map((m, i) => (
              <tr key={m.id}
                style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }}
                onClick={() => router.push(`/masters/machines/${m.id}`)}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#111827', fontFamily: 'monospace', fontSize: 12 }}>{m.machine_code}</td>
                <td style={{ padding: '10px 14px', color: '#374151', fontWeight: 500 }}>
                  {m.machine_name}
                  {m.is_bottleneck && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: '#B45309', background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 3, padding: '1px 5px' }}>BOTTLENECK</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontSize: 12 }}>{m.machine_type?.type_name || '—'}</td>
                <td style={{ padding: '10px 14px', color: '#6B7280', fontSize: 12 }}>
                  {m.capacity_basis
                    ? `${m.capacity_basis}${m.planning_capacity != null ? ` · ${m.planning_capacity}${m.capacity_uom ? ` ${m.capacity_uom}` : ''}` : ''}`
                    : '—'}
                </td>
                <td style={{ padding: '10px 14px' }}><StatusBadge status={m.status} /></td>
                <td style={{ padding: '10px 14px' }}><ActiveBadge is_active={m.is_active} /></td>
                <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => router.push(`/masters/machines/${m.id}`)}
                      style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggle(m)}
                      disabled={toggling === m.id}
                      style={{
                        height: 28, padding: '0 10px', borderRadius: 5, fontSize: 12,
                        cursor: toggling === m.id ? 'not-allowed' : 'pointer',
                        border:      `1px solid ${m.is_active ? '#FECACA' : '#BBF7D0'}`,
                        background:  m.is_active ? '#FEF2F2' : '#F0FDF4',
                        color:       m.is_active ? '#DC2626' : '#059669',
                      }}>
                      {toggling === m.id ? '…' : m.is_active ? 'Deactivate' : 'Activate'}
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
