'use client';

/**
 * CERADRIVE ERP — GRN List (Phase 9F-FE)
 * Mirrors Work Orders / Purchase Orders list pattern: KPI cards + filter row + erp-table.
 * Data: GET /api/v1/grns (paged, meta.total). KPI counts: limit=1 status GETs reading meta.total.
 * Read-only list. "New GRN" intentionally DISABLED — no create endpoint yet (Phase 9D backend).
 * Reuses api, useToast, and global erp-* / kpi-* CSS. No backend/DB changes.
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

// Defensive readers — primary = nested *_master embed (PO convention), then flat fallbacks.
function supplierName(g) {
  return g.supplier_master?.supplier_name ?? g.supplier?.supplier_name ?? g.supplier_name ?? '—';
}
function warehouseName(g) {
  return g.warehouse_master?.warehouse_name ?? g.warehouse?.warehouse_name ?? g.warehouse_name ?? '—';
}
function poNumber(g) {
  return g.purchase_orders?.po_number ?? g.po?.po_number ?? g.po_number ?? '—';
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  draft:     { color: '#6B7280', borderColor: '#D1D5DB' },
  posted:    { color: '#059669', borderColor: '#059669' },
  cancelled: { color: '#DC2626', borderColor: '#DC2626' },
};
const STATUS_LABEL = { draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' };

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

const STATUS_OPTIONS = ['', 'draft', 'posted', 'cancelled'];
const STATUS_FILTER_LABEL = { '': 'All Status', draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' };
const KPI_DEFS = [
  { key: 'total',     label: 'Total GRNs', status: null,        accent: '#4F46E5' },
  { key: 'draft',     label: 'Draft',      status: 'draft',     accent: '#6B7280' },
  { key: 'posted',    label: 'Posted',     status: 'posted',    accent: '#059669' },
  { key: 'cancelled', label: 'Cancelled',  status: 'cancelled', accent: '#DC2626' },
];

const GRID = '150px 110px minmax(150px,1fr) 130px 120px 110px 120px';

export default function GRNListPage() {
  const router = useRouter();
  const addToast = useToast();
  const searchRef = useRef(null);

  const [grns,         setGrns]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter,   setDateFilter]   = useState('');
  const [search,       setSearch]       = useState('');
  const [page,         setPage]         = useState(1);
  const [total,        setTotal]        = useState(0);
  const [counts,       setCounts]       = useState({});

  const LIMIT = 20;

  const fetchGRNs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = { page, limit: LIMIT };
    if (statusFilter) params.status = statusFilter;
    if (dateFilter)   { params.date_from = dateFilter; params.date_to = dateFilter; }
    const { data, error: err, meta } = await api.get('/api/v1/grns', params);
    if (err) { setError(err.message ?? 'Failed to load GRNs.'); setLoading(false); return; }
    setGrns(data ?? []);
    setTotal(meta?.total ?? 0);
    setLoading(false);
  }, [page, statusFilter, dateFilter]);

  const fetchCounts = useCallback(async () => {
    const results = await Promise.all(
      KPI_DEFS.map(d =>
        api.get('/api/v1/grns', d.status ? { status: d.status, limit: 1 } : { limit: 1 })
      )
    );
    const next = {};
    KPI_DEFS.forEach((d, i) => { next[d.key] = results[i].error ? null : (results[i].meta?.total ?? 0); });
    setCounts(next);
  }, []);

  useEffect(() => { fetchGRNs(); }, [fetchGRNs]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const filtered = search.trim()
    ? grns.filter(g => {
        const q = search.toLowerCase();
        return (
          g.grn_number?.toLowerCase().includes(q) ||
          supplierName(g).toLowerCase().includes(q)
        );
      })
    : grns;

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ maxWidth: 1200 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Goods Receipts</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>View goods receipts and post or cancel inventory</p>
        </div>
        <span title="Create GRN backend endpoint not available yet" style={{ display: 'inline-flex', cursor: 'not-allowed' }}>
          <button
            disabled
            style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#9CA3AF', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'not-allowed', whiteSpace: 'nowrap', flexShrink: 0, opacity: 0.7, pointerEvents: 'none' }}>
            + New GRN
          </button>
        </span>
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
          title="Filter by GRN date"
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px' }}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" stroke="#9CA3AF" strokeWidth="1.3"/>
            <path d="M10.5 10.5L13.5 13.5" stroke="#9CA3AF" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search GRN # or supplier"
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
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '9px 14px' }}>
          {['GRN Number', 'GRN Date', 'Supplier', 'Warehouse', 'PO #', 'Status', 'Created'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              {h}
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading goods receipts…</div>
        ) : error ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No goods receipts found</div>
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>{search || statusFilter || dateFilter ? 'Try different filters' : 'GRNs will appear here once created'}</div>
          </div>
        ) : (
          filtered.map(g => (
            <div
              key={g.id}
              className="erp-table-row"
              style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', alignItems: 'center', minHeight: 50, cursor: 'pointer' }}
              onClick={() => router.push(`/grns/${g.id}`)}
            >
              <div style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                {g.grn_number}
              </div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap', paddingRight: 8 }}>{formatDate(g.grn_date)}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{supplierName(g)}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{warehouseName(g)}</div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap', paddingRight: 8 }}>{poNumber(g)}</div>
              <div><StatusBadge status={g.status} /></div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap' }}>{formatDate(g.created_at)}</div>
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
