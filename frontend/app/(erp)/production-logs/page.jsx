'use client';

/**
 * CERADRIVE ERP — Production Logs List (Phase 1)
 * KPIs: Total / Today / Good / Rework / Scrap. Filters: WO, Date, Worker, Machine.
 * Columns: Log No (derived) · WO No · Step · Date · Worker · Machine · Good · Rework · Scrap.
 * Reuses api, useToast (addToast), global erp-* / kpi-* CSS. No edit/delete (immutable ENTRY).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter }                                from 'next/navigation';
import { api }                                      from '../../../lib/api.js';
import { useToast }                                 from '../../../components/ui/Toast.jsx';

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function num(v) { return v == null || isNaN(v) ? 0 : Number(v); }
function qty(v) { return num(v).toLocaleString('en-IN'); }

// Phase 1 display-derived log number (no schema column / number series).
function logNo(row) {
  const d = row.entry_date || row.created_at;
  const ymd = d ? new Date(d).toISOString().slice(0, 10).replace(/-/g, '') : '00000000';
  return `PL-${ymd}-${String(row.id).slice(0, 6)}`;
}

function KPICard({ label, value, accent }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon" style={{ background: '#EEF2FF', color: accent ?? '#4F46E5' }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="M4 6h14M4 11h14M4 16h9" stroke={accent ?? '#4F46E5'} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>{value == null ? '—' : value}</div>
      </div>
    </div>
  );
}

const GRID = '150px 120px minmax(130px,1fr) 100px 135px 135px 70px 70px 70px';

export default function ProductionLogsPage() {
  const router = useRouter();
  const addToast = useToast();

  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);

  const [woFilter,      setWoFilter]      = useState('');
  const [dateFilter,    setDateFilter]    = useState('');
  const [workerFilter,  setWorkerFilter]  = useState('');
  const [machineFilter, setMachineFilter] = useState('');

  const [workers,  setWorkers]  = useState([]);
  const [machines, setMachines] = useState([]);
  const [kpis,     setKpis]     = useState({ total: null, today: null, good: null, rework: null, scrap: null });

  const [correctionRow, setCorrectionRow] = useState(null);
  const [correctionForm, setCorrectionForm] = useState({ actual_good_qty: '', actual_scrap_qty: '', reason: '', note: '' });
  const [correcting, setCorrecting] = useState(false);

  const LIMIT = 20;

  const buildFilters = useCallback(() => {
    const f = {};
    if (woFilter)      f.wo_id      = woFilter;
    if (dateFilter)    f.entry_date = dateFilter;
    if (workerFilter)  f.worker_id  = workerFilter;
    if (machineFilter) f.machine_id = machineFilter;
    return f;
  }, [woFilter, dateFilter, workerFilter, machineFilter]);

  const fetchLogs = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err, meta } = await api.get('/api/v1/production-logs/master', { ...buildFilters(), page, limit: LIMIT });
    if (err) { setError(err.message ?? 'Failed to load production logs.'); setLoading(false); return; }
    setLogs(data ?? []);
    setTotal(meta?.total ?? 0);
    setLoading(false);
  }, [buildFilters, page]);

  // KPIs: Total/Today accurate via count; Good/Rework/Scrap summed over up to 500 matching
  // rows (Phase 1 foundation — a backend aggregate can replace this later for scale).
  const fetchKpis = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const filters = buildFilters();
    const [totalRes, todayRes, sumRes] = await Promise.all([
      api.get('/api/v1/production-logs/master', { ...filters, limit: 1 }),
      api.get('/api/v1/production-logs/master', { ...filters, entry_date: today, limit: 1 }),
      api.get('/api/v1/production-logs/master', { ...filters, limit: 500 }),
    ]);
    const rows = sumRes.data ?? [];
    setKpis({
      total:  totalRes.error ? null : (totalRes.meta?.total ?? 0),
      today:  todayRes.error ? null : (todayRes.meta?.total ?? 0),
      good:   rows.reduce((s, r) => s + num(r.net_good_qty ?? r.good_qty), 0),
      rework: rows.reduce((s, r) => s + num(r.rework_qty), 0),
      scrap:  rows.reduce((s, r) => s + num(r.net_scrap_qty ?? r.scrap_qty), 0),
    });
  }, [buildFilters]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchKpis(); }, [fetchKpis]);
  useEffect(() => {
    api.get('/api/v1/production-logs/workers').then(({ data }) => setWorkers(data ?? []));
    api.get('/api/v1/production-logs/machines').then(({ data }) => setMachines(data ?? []));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  function openCorrection(row) {
    setCorrectionRow(row);
    setCorrectionForm({
      actual_good_qty: String(row.net_good_qty ?? row.good_qty ?? 0),
      actual_scrap_qty: String(row.net_scrap_qty ?? row.scrap_qty ?? 0),
      reason: '',
      note: '',
    });
  }

  async function submitCorrection() {
    if (!correctionRow?.id) return;

    if (!String(correctionForm.reason || '').trim()) {
      addToast('Correction reason is required.', 'error');
      return;
    }

    setCorrecting(true);
    const { data, error } = await api.post(`/api/v1/production-logs/master/${correctionRow.id}/correct`, {
      actual_good_qty: Number(correctionForm.actual_good_qty || 0),
      actual_scrap_qty: Number(correctionForm.actual_scrap_qty || 0),
      reason: correctionForm.reason.trim(),
      note: correctionForm.note.trim() || null,
    });
    setCorrecting(false);

    if (error) {
      addToast(error.message ?? 'Correction failed.', 'error');
      return;
    }

    addToast(data?.status === 'NO_CHANGE' ? 'No correction needed.' : 'Correction saved.', 'success');
    setCorrectionRow(null);
    setCorrectionForm({ actual_good_qty: '', actual_scrap_qty: '', reason: '', note: '' });
    await fetchLogs();
    await fetchKpis();
  }

  return (
    <div style={{ maxWidth: 1180, overflowX: 'hidden' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#111827', margin: 0 }}>Production Logs</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Record production against released work orders</p>
        </div>
        <button onClick={() => router.push('/production-logs/new')}
          style={{ height: 38, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          + New Production Log
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 12, marginBottom: 20 }}>
        <KPICard label="Total Logs"  value={kpis.total}  accent="#4F46E5" />
        <KPICard label="Today Logs"  value={kpis.today}  accent="#2563EB" />
        <KPICard label="Good Qty"    value={kpis.good == null ? null : qty(kpis.good)}     accent="#059669" />
        <KPICard label="Rework Qty"  value={kpis.rework == null ? null : qty(kpis.rework)} accent="#D97706" />
        <KPICard label="Scrap Qty"   value={kpis.scrap == null ? null : qty(kpis.scrap)}   accent="#DC2626" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={woFilter} onChange={e => { setWoFilter(e.target.value.trim()); setPage(1); }} placeholder="WO id…"
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151', width: 200 }} />
        <input type="date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} title="Filter by production date"
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151' }} />
        <select value={workerFilter} onChange={e => { setWorkerFilter(e.target.value); setPage(1); }}
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <option value="">All Workers</option>
          {workers.map(w => <option key={w.id} value={w.id}>{w.worker_code} — {w.worker_name}</option>)}
        </select>
        <select value={machineFilter} onChange={e => { setMachineFilter(e.target.value); setPage(1); }}
          style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 10px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <option value="">All Machines</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
        </select>
        {(woFilter || dateFilter || workerFilter || machineFilter) && (
          <button onClick={() => { setWoFilter(''); setDateFilter(''); setWorkerFilter(''); setMachineFilter(''); setPage(1); }}
            style={{ height: 34, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 12px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Clear</button>
        )}
      </div>

      {correctionRow && (
        <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>Correct Production Log</div>
              <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>
                {correctionRow.wo?.wo_number || 'WO'} · Original good {qty(correctionRow.good_qty)} · Current net {qty(correctionRow.net_good_qty ?? correctionRow.good_qty)}
              </div>
            </div>
            <button onClick={() => setCorrectionRow(null)} style={{ border: 'none', background: 'transparent', color: '#92400E', cursor: 'pointer', fontSize: 13 }}>Close</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '140px 140px minmax(220px,1fr) minmax(180px,1fr)', gap: 10, alignItems: 'end' }}>
            <label style={{ fontSize: 12, color: '#374151' }}>
              Actual Good Qty
              <input type="number" min="0" step="any" value={correctionForm.actual_good_qty} onChange={e => setCorrectionForm({ ...correctionForm, actual_good_qty: e.target.value })}
                style={{ width: '100%', height: 34, marginTop: 4, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 8px' }} />
            </label>
            <label style={{ fontSize: 12, color: '#374151' }}>
              Actual Scrap Qty
              <input type="number" min="0" step="any" value={correctionForm.actual_scrap_qty} onChange={e => setCorrectionForm({ ...correctionForm, actual_scrap_qty: e.target.value })}
                style={{ width: '100%', height: 34, marginTop: 4, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 8px' }} />
            </label>
            <label style={{ fontSize: 12, color: '#374151' }}>
              Reason *
              <input value={correctionForm.reason} onChange={e => setCorrectionForm({ ...correctionForm, reason: e.target.value })} placeholder="Why correcting?"
                style={{ width: '100%', height: 34, marginTop: 4, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 8px' }} />
            </label>
            <label style={{ fontSize: 12, color: '#374151' }}>
              Note
              <input value={correctionForm.note} onChange={e => setCorrectionForm({ ...correctionForm, note: e.target.value })} placeholder="Optional"
                style={{ width: '100%', height: 34, marginTop: 4, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 8px' }} />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={submitCorrection} disabled={correcting}
              style={{ height: 34, border: 'none', borderRadius: 6, padding: '0 10px', background: correcting ? '#FBBF24' : '#D97706', color: '#fff', fontSize: 13, fontWeight: 600, cursor: correcting ? 'not-allowed' : 'pointer' }}>
              {correcting ? 'Saving…' : 'Save Correction'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="erp-table">
        <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '8px 10px' }}>
          {['Log No', 'WO No', 'Step', 'Date', 'Worker', 'Machine', 'Good', 'Rework', 'Scrap'].map((h, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', textAlign: i >= 6 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading production logs…</div>
        ) : error ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#DC2626', fontSize: 13 }}>{error}</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧾</div>
            <div style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>No production logs found</div>
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>Record production against a released work order</div>
          </div>
        ) : (
          logs.map(row => (
            <div key={row.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 10px', alignItems: 'center', minHeight: 48 }}>
              <div style={{ fontSize: 12, color: '#6B7280', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                <div>{logNo(row)}</div>
                <button onClick={() => openCorrection(row)}
                  style={{ height: 22, marginTop: 3, border: '1px solid #D97706', borderRadius: 5, background: '#FFFBEB', color: '#92400E', padding: '0 6px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Correct
                </button>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                {row.wo_id
                  ? <span onClick={() => router.push(`/work-orders/${row.wo_id}`)} style={{ color: '#2563EB', cursor: 'pointer' }}>{row.wo?.wo_number ?? '—'}</span>
                  : <span style={{ color: '#6B7280' }}>{row.wo?.wo_number ?? '—'}</span>}
              </div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{row.step ? `${row.step.seq_no ?? ''} ${row.step.step_name ?? ''}`.trim() : '—'}</div>
              <div style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap' }}>{formatDate(row.entry_date)}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{row.worker ? `${row.worker.worker_code} — ${row.worker.worker_name}` : '—'}</div>
              <div style={{ fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{row.machine ? `${row.machine.machine_code} — ${row.machine.machine_name}` : '—'}</div>
              <div style={{ fontSize: 13, color: '#059669', textAlign: 'right' }}>
                {qty(row.net_good_qty ?? row.good_qty)}
                {row.correction_count > 0 && <div style={{ fontSize: 10, color: '#92400E' }}>was {qty(row.good_qty)}</div>}
              </div>
              <div style={{ fontSize: 13, color: '#D97706', textAlign: 'right' }}>{qty(row.rework_qty)}</div>
              <div style={{ fontSize: 13, color: '#DC2626', textAlign: 'right' }}>
                {qty(row.net_scrap_qty ?? row.scrap_qty)}
                {row.correction_count > 0 && <div style={{ fontSize: 10, color: '#92400E' }}>corrected</div>}
              </div>

            </div>
          ))
        )}

        {!loading && !error && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>Showing {logs.length} of {total} entries</span>
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
