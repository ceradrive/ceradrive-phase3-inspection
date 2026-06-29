'use client';

/**
 * CERADRIVE ERP — Work Orders List (WO Phase 1 FE)
 * Theme V1: KPI cards + filter row + table. Mirrors the Purchase Orders list pattern.
 * Data: GET /api/v1/work-orders/master (paged). KPI counts: lightweight status-filtered
 * GETs reading meta.total (no new endpoint). Reuses api, useToast, and global erp-* / kpi-* CSS.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter }                                from 'next/navigation';
import { api }                                      from '../../../lib/api.js';
import { useToast }                                 from '../../../components/ui/Toast.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatQty(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN');
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  draft:       { color: '#6B7280', borderColor: '#D1D5DB' },
  released:    { color: '#2563EB', borderColor: '#2563EB' },
  in_progress: { color: '#D97706', borderColor: '#D97706' },
  completed:   { color: '#059669', borderColor: '#059669' },
  closed:      { color: '#6B7280', borderColor: '#D1D5DB' },
  cancelled:   { color: '#DC2626', borderColor: '#DC2626' },
};
const STATUS_LABEL = {
  draft: 'Draft', released: 'Released', in_progress: 'In Progress',
  completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled',
};
const PRIORITY_COLOR = { LOW: '#6B7280', NORMAL: '#374151', HIGH: '#D97706', URGENT: '#DC2626' };

function StatusBadge({ status }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, border: `1px solid ${style.borderColor}`,
      color: style.color, background: '#fff', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, accent }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon" style={{ background: '#EEF2FF', color: accent ?? '#4F46E5' }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="M4 6h14M4 11h14M4 16h9" stroke={accent ?? '#4F46E5'} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, whiteSpace: 'nowrap' }}>
          {label}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>
          {value == null ? '—' : value}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['', 'draft', 'released', 'in_progress', 'completed', 'closed', 'cancelled'];
const STATUS_FILTER_LABEL = {
  '': 'All Status', draft: 'Draft', released: 'Released', in_progress: 'In Progress',
  completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled',
};
const KPI_DEFS = [
  { key: 'total',     label: 'Total WOs',  status: null,        accent: '#4F46E5' },
  { key: 'draft',     label: 'Draft',      status: 'draft',     accent: '#6B7280' },
  { key: 'released',  label: 'Released',   status: 'released',  accent: '#2563EB' },
  { key: 'completed', label: 'Completed',  status: 'completed', accent: '#059669' },
  { key: 'closed',    label: 'Closed',     status: 'closed',    accent: '#6B7280' },
  { key: 'cancelled', label: 'Cancelled',  status: 'cancelled', accent: '#DC2626' },
];

const GRID = '150px 110px minmax(180px,1fr) 120px 100px 110px 90px 110px';

export default function WorkOrdersPage() {
  const router = useRouter();
  const addToast = useToast();
  const searchRef = useRef(null);

  const [wos,          setWos]          = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter,   setDateFilter]   = useState('');
  const [itemSearch,   setItemSearch]   = useState('');
  const [page,         setPage]         = useState(1);
  const [total,        setTotal]        = useState(0);
  const [counts,       setCounts]       = useState({});

  const LIMIT = 20;

  const fetchWOs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = { page, limit: LIMIT };
    if (statusFilter) params.status = statusFilter;
    if (dateFilter)   params.wo_date = dateFilter;
    const { data, error: err, meta } = await api.get('/api/v1/work-orders/master', params);
    if (err) { setError(err.message ?? 'Failed to load work orders.'); setLoading(false); return; }
    setWos(data ?? []);
    setTotal(meta?.total ?? 0);
    setLoading(false);
  }, [page, statusFilter, dateFilter]);

  // Accurate KPI counts: one limit=1 GET per status, reading meta.total. No new endpoint.
  const fetchCounts = useCallback(async () => {
    const results = await Promise.all(
      KPI_DEFS.map(d =>
        api.get('/api/v1/work-orders/master', d.status ? { status: d.status, limit: 1 } : { limit: 1 })
      )
    );
    const next = {};
    KPI_DEFS.forEach((d, i) => { next[d.key] = results[i].error ? null : (results[i].meta?.total ?? 0); });
    setCounts(next);
  }, []);

  useEffect(() => { fetchWOs(); }, [fetchWOs]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Client-side "Item" filter over the loaded page (wo_number + item code/name).
  const filtered = itemSearch.trim()
    ? wos.filter(w => {
        const q = itemSearch.toLowerCase();
        return (
          w.wo_number?.toLowerCase().includes(q) ||
          w.item?.item_code?.toLowerCase().includes(q) ||
          w.item?.item_name?.toLowerCase().includes(q)
        );
      })
    : wos;

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ maxWidth: 1200 }}>

      {/* P-3G.8: ledger-role helper note */}
      <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 12, color: '#6B7280' }}>
        Ledger / detail page. Execution happens in Production Work.
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Work Orders</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Manage production work orders and their lifecycle</p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#6B7280', maxWidth: 260 }}>
          New Work Orders are generated from PPO only.
          <br />
          <button onClick={() => router.push('/production-plan-orders')}
            style={{ marginTop: 6, height: 30, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
            Go to PPO
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {KPI_DEFS.map(d => <KPICard key={d.key} label={d.label} value={counts[d.key]} accent={d.accent} />)}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151', cursor: 'pointer' }}
        >
          {STATUS_OPTIONS.map(s => <option key={s || 'all'} value={s}>{STATUS_FILTER_LABEL[s]}</option>)}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={e => { setDateFilter(e.target.value); setPage(1); }}
          title="Filter by WO date"
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px' }}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" stroke="#9CA3AF" strokeWidth="1.3"/>
            <path d="M10.5 10.5L13.5 13.5" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            value={itemSearch}
            onChange={e => setItemSearch(e.target.value)}
            placeholder="Search WO # or item"
            style={{ border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', width: 220 }}
          />
        </div>
        {dateFilter && (
          <button onClick={() => { setDateFilter(''); setPage(1); }}
            style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 12px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            Clear date
          </button>
        )}
      </div>

      {/* Table */}
      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, columnGap: 12, padding: '9px 14px' }}>
          {['WO Number', 'WO Date', 'Item', 'Planned Qty', 'Source', 'Status', 'Priority', 'Created At'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', textAlign: i === 3 ? 'right' : 'left' }}>
              {h}
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading work orders…</div>
        ) : error ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🛠️</div>
            <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No work orders found</div>
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>{itemSearch || statusFilter || dateFilter ? 'Try different filters' : 'Create your first work order'}</div>
          </div>
        ) : (
          filtered.map(wo => (
            <div
              key={wo.id}
              className="erp-table-row"
              style={{ display: 'grid', gridTemplateColumns: GRID, columnGap: 12, padding: '0 14px', alignItems: 'center', minHeight: 50, cursor: 'pointer' }}
              onClick={() => router.push(`/work-orders/${wo.id}`)}
            >
              <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                {wo.wo_number}
              </div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap', paddingRight: 8 }}>{formatDate(wo.wo_date)}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                {wo.item ? `${wo.item.item_code} — ${wo.item.item_name}` : '—'}
              </div>
              <div style={{ fontSize: 13, color: '#111827', textAlign: 'right', paddingRight: 8 }}>{formatQty(wo.planned_qty)}</div>
              <div>
                {wo.source_ppo_id ? (
                  <button onClick={(e) => { e.stopPropagation(); router.push(`/production-plan-orders/${wo.source_ppo_id}`); }}
                    style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: '1px solid #BFDBFE', color: '#2563EB', background: '#EFF6FF', cursor: 'pointer' }}>
                    PPO →
                  </button>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: '1px solid #D1D5DB', color: '#6B7280', background: '#F9FAFB' }}>
                    Manual
                  </span>
                )}
              </div>
              <div><StatusBadge status={wo.status} /></div>
              <div style={{ fontSize: 13, color: PRIORITY_COLOR[wo.priority_level] ?? '#374151', whiteSpace: 'nowrap' }}>{wo.priority_level ?? '—'}</div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap' }}>{formatDate(wo.created_at)}</div>
            </div>
          ))
        )}

        {!loading && !error && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>Showing {filtered.length} of {total} entries</span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E5E7EB', background: '#fff', cursor: page === 1 ? 'default' : 'pointer', color: '#6B7280', fontSize: 13, opacity: page === 1 ? 0.4 : 1 }}>‹</button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: page === p ? '#2563EB' : 'none', color: page === p ? '#fff' : '#374151', cursor: 'pointer', fontSize: 13 }}>{p}</button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E5E7EB', background: '#fff', cursor: page === totalPages ? 'default' : 'pointer', color: '#6B7280', fontSize: 13, opacity: page === totalPages ? 0.4 : 1 }}>›</button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
