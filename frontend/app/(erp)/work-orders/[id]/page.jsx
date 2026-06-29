'use client';

/**
 * CERADRIVE ERP — Work Order Detail (Phase A: Floor Usability)
 * Tabs: Overview · Steps · Components · Production Logs · Audit.
 * Overview shows progress cards (final-step-only Produced per PM D1). Print renders a
 * clean traveler (header + steps + components) independent of the active tab. Lifecycle
 * endpoints unchanged (release/complete/close/cancel). Dead Edit button removed.
 * Read-only: no inventory, WIP, QC, scheduler, MRP, no writes beyond existing lifecycle.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams }             from 'next/navigation';
import { api }                              from '../../../../lib/api.js';
import { useToast }                         from '../../../../components/ui/Toast.jsx';

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 3 };

const STATUS_STYLE = {
  draft:       { color: '#6B7280', borderColor: '#D1D5DB', bg: '#F9FAFB' },
  released:    { color: '#2563EB', borderColor: '#2563EB', bg: '#EFF6FF' },
  in_progress: { color: '#D97706', borderColor: '#D97706', bg: '#FFFBEB' },
  completed:   { color: '#059669', borderColor: '#059669', bg: '#ECFDF5' },
  closed:      { color: '#6B7280', borderColor: '#D1D5DB', bg: '#F9FAFB' },
  cancelled:   { color: '#DC2626', borderColor: '#DC2626', bg: '#FEF2F2' },
};
const STATUS_LABEL = {
  draft: 'Draft', released: 'Released', in_progress: 'In Progress',
  completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled',
};
const TIMELINE = ['draft', 'released', 'completed', 'closed'];
const STAGE_RANK = { draft: 0, released: 1, in_progress: 1, completed: 2, closed: 3 };
const STEP_STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };

const TABS = ['overview', 'steps', 'components', 'logs', 'audit'];
const TAB_LABEL = { overview: 'Overview', steps: 'Steps', components: 'Components', logs: 'Logs / Corrections', audit: 'Audit' };

function formatDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function num(v) { return v == null || isNaN(v) ? 0 : Number(v); }
function qtyFmt(v) { return num(v).toLocaleString('en-IN'); }

export default function WorkOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const addToast = useToast();
  const id = params?.id;

  const [wo,        setWo]        = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [tab,       setTab]       = useState('overview');
  const [logs,      setLogs]      = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await api.get(`/api/v1/work-orders/master/${id}`);
    if (error || !data) { addToast('Work order not found'); setWo(null); }
    else setWo(data);
    setLoading(false);
  }, [id, addToast]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    const { data } = await api.get('/api/v1/production-logs/master', { wo_id: id, limit: 500 });
    setLogs(data ?? []);
    setLogsLoading(false);
  }, [id]);

  useEffect(() => { if (id) load(); }, [id, load]);
  useEffect(() => { if (id) loadLogs(); }, [id, loadLogs]);

  async function runConfirmed() {
    if (!confirmAction || actionBusy) return;
    const { path, label } = confirmAction;
    setActionBusy(true);
    const { data, error } = await api.post(`/api/v1/work-orders/master/${id}/${path}`, {});
    setActionBusy(false);
    setConfirmAction(null);
    if (error) { addToast(`${label} failed`, error.message ?? ''); return; }
    if (data) setWo(data);
    addToast(`Work order ${label.toLowerCase()}d`);
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!wo)     return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Work order not found.</div>;

  const st = STATUS_STYLE[wo.status] ?? STATUS_STYLE.draft;
  const isDraft     = wo.status === 'draft';
  const isPpoGeneratedWo =
    Boolean(wo.source_ppo_id) ||
    String(wo.wo_kind || '').toUpperCase() === 'PPO_STAGE';
  const isInternalPlan =
    String(wo.wo_kind || '').toUpperCase() === 'INTERNAL_PLAN';
  const isReleased  = wo.status === 'released';
  const isCompleted = wo.status === 'completed';
  const isCancelled = wo.status === 'cancelled';
  const readOnly    = wo.status === 'closed' || isCancelled;
  const rank        = STAGE_RANK[wo.status] ?? 0;

  const roVal = (v) => <div style={{ fontSize: 14, color: v != null && v !== '' ? '#374151' : '#9CA3AF', padding: '6px 0', minHeight: 20 }}>{v != null && v !== '' ? v : '—'}</div>;
  const verLabel = (rel) => rel ? `v${rel.version_number}${rel.status ? ` (${rel.status})` : ''}` : null;

  const auditRows = [
    ['Created',   wo.created_by,   wo.created_at],
    ['Released',  wo.released_by,  wo.released_at],
    ['Completed', wo.completed_by, wo.completed_at],
    ['Closed',    wo.closed_by,    wo.closed_at],
    ['Cancelled', wo.cancelled_by, wo.cancelled_at],
  ];

  function askConfirm(path, label) { setConfirmAction({ path, label }); }

  // ─── Progress (PM D1: final output step = highest seq_no; Produced = Σ good_qty on that step) ──
  const stepLines = Array.isArray(wo.step_lines) ? [...wo.step_lines].sort((a, b) => num(a.seq_no) - num(b.seq_no)) : [];
  const componentLines = Array.isArray(wo.component_lines) ? wo.component_lines : [];
  const finalSeq = stepLines.length ? Math.max(...stepLines.map(s => num(s.seq_no))) : null;
  const finalStep = finalSeq != null ? stepLines.find(s => num(s.seq_no) === finalSeq) : null;
  const planned = num(wo.planned_qty);
  const producedGood = finalSeq == null ? 0 : logs.reduce((s, l) => s + (num(l.step?.seq_no) === finalSeq ? num(l.net_good_qty ?? l.good_qty) : 0), 0);
  const balance = planned - producedGood;
  const completionPct = planned > 0 ? Math.round((producedGood / planned) * 1000) / 10 : 0;
  const totalRework = logs.reduce((s, l) => s + num(l.rework_qty), 0);
  const totalScrap  = logs.reduce((s, l) => s + num(l.net_scrap_qty ?? l.scrap_qty), 0);

  const PROGRESS = [
    { label: 'Planned Qty',  value: qtyFmt(planned),              accent: '#4F46E5' },
    { label: 'Produced (final step)', value: qtyFmt(producedGood), accent: '#059669' },
    { label: 'Balance Qty',  value: qtyFmt(balance),              accent: '#2563EB' },
    { label: 'Completion %', value: `${completionPct}%`,          accent: '#7C3AED' },
    { label: 'Total Rework', value: qtyFmt(totalRework),          accent: '#D97706' },
    { label: 'Total Scrap',  value: qtyFmt(totalScrap),           accent: '#DC2626' },
  ];

  const flagBadges = (s) => {
    const out = [];
    if (s.is_wo_driven)     out.push('WO-driven');
    if (s.wip_produced)     out.push('WIP');
    if (s.qc_required)      out.push('QC');
    if (s.machine_required) out.push('Machine');
    if (s.die_required)     out.push('Die');
    if (s.labour_required)  out.push('Labour');
    return out;
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1040, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <style>{`@media print { .wo-no-print { display: none !important; } .wo-print-only { display: block !important; } body { background: #fff; } } .wo-print-only { display: none; }`}</style>

      {/* ══════════════════ ON-SCREEN (hidden when printing) ══════════════════ */}
      <div className="wo-no-print">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => router.push('/work-orders')}
            style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Work Orders</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{wo.wo_number}</h1>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: `1px solid ${st.borderColor}`, color: st.color, background: st.bg }}>
              {STATUS_LABEL[wo.status] ?? wo.status}
            </span>
            <button onClick={() => window.print()} style={{ marginLeft: 'auto', height: 32, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>🖨 Print Work Order</button>
          </div>
          {readOnly && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 12, color: '#6B7280' }}>This work order is {STATUS_LABEL[wo.status]?.toLowerCase()} and read-only.</div>}
          {isInternalPlan && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, border: '1px solid #FED7AA', background: '#FFF7ED', fontSize: 12, color: '#9A3412' }}>Internal Plan Work Order — release is managed from Internal Production Plan.</div>}
          {wo.source_ppo_id && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, border: '1px solid #BFDBFE', background: '#EFF6FF', fontSize: 12, color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>Source: PPO generated Work Order · Release is managed in the parent PPO.</span>
              <button onClick={() => router.push(`/production-plan-orders/${wo.source_ppo_id}`)}
                style={{ height: 28, padding: '0 10px', border: '1px solid #93C5FD', borderRadius: 6, background: '#fff', color: '#2563EB', fontSize: 12, cursor: 'pointer' }}>
                Open PPO to Release →
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E5E7EB', marginBottom: 16 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 14px', border: 'none', background: 'none', fontSize: 13, cursor: 'pointer',
                color: tab === t ? '#4F46E5' : '#6B7280', fontWeight: tab === t ? 600 : 400,
                borderBottom: tab === t ? '2px solid #4F46E5' : '2px solid transparent', marginBottom: -1 }}>
              {TAB_LABEL[t]}{t === 'steps' && stepLines.length ? ` (${stepLines.length})` : ''}{t === 'components' && componentLines.length ? ` (${componentLines.length})` : ''}{t === 'logs' && logs.length ? ` (${logs.length})` : ''}
            </button>
          ))}
        </div>

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
              {PROGRESS.map(c => (
                <div key={c.label} className="kpi-card">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, whiteSpace: 'nowrap' }}>{c.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: c.accent, lineHeight: 1.1 }}>{c.value}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div><label style={labelStyle}>Item</label>{roVal(wo.item ? `${wo.item.item_code} — ${wo.item.item_name}` : '')}</div>
                <div><label style={labelStyle}>Routing</label>{roVal(verLabel(wo.routing) ?? wo.routing_id)}</div>
                <div><label style={labelStyle}>BOM</label>{roVal(verLabel(wo.bom))}</div>
                <div><label style={labelStyle}>SKU Plan</label>{roVal(verLabel(wo.sku_plan))}</div>
                <div><label style={labelStyle}>Planned Qty</label>{roVal(wo.planned_qty != null ? Number(wo.planned_qty).toLocaleString('en-IN') : '')}</div>
                <div><label style={labelStyle}>Priority</label>{roVal(wo.priority_level)}</div>
                <div><label style={labelStyle}>WO Date</label>{roVal(formatDate(wo.wo_date))}</div>
                <div><label style={labelStyle}>Final Output Step</label>{roVal(finalStep ? `${finalStep.seq_no}. ${finalStep.step_name}` : '—')}</div>
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Lifecycle</div>
              {isCancelled ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', fontSize: 13, fontWeight: 500 }}>
                  ✕ Cancelled{wo.cancelled_at ? ` · ${formatDateTime(wo.cancelled_at)}` : ''}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {TIMELINE.map((stage, i) => {
                    const reached = rank >= STAGE_RANK[stage];
                    const color = reached ? '#059669' : '#D1D5DB';
                    return (
                      <div key={stage} style={{ display: 'flex', alignItems: 'center', flex: i < TIMELINE.length - 1 ? 1 : '0 0 auto' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', border: `2px solid ${color}`, background: reached ? '#059669' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>
                            {reached ? '✓' : ''}
                          </div>
                          <span style={{ fontSize: 12, color: reached ? '#111827' : '#9CA3AF', fontWeight: reached ? 500 : 400 }}>{STATUS_LABEL[stage]}</span>
                        </div>
                        {i < TIMELINE.length - 1 && <div style={{ flex: 1, height: 2, background: rank > STAGE_RANK[stage] ? '#059669' : '#E5E7EB', margin: '0 8px', alignSelf: 'flex-start', marginTop: 13 }} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Steps tab ── */}
        {tab === 'steps' && (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px minmax(160px,1fr) 120px 1fr 110px', padding: '10px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['Seq', 'Step', 'Status', 'Flags', 'Planned Qty'].map((h, i) => <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: i === 4 ? 'right' : 'left' }}>{h}</div>)}
            </div>
            {stepLines.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No steps. Steps are generated when the work order is released.</div>
            ) : stepLines.map(s => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '60px minmax(160px,1fr) 120px 1fr 110px', padding: '10px 14px', borderBottom: '1px solid #F3F4F6', alignItems: 'center' }}>
                <div style={{ fontSize: 13, color: '#6B7280' }}>{s.seq_no}{finalSeq != null && num(s.seq_no) === finalSeq ? ' ★' : ''}</div>
                <div style={{ fontSize: 13, color: '#111827' }}>{s.step_name}</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>{STEP_STATUS_LABEL[s.step_status] ?? s.step_status ?? '—'}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {flagBadges(s).map(f => <span key={f} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#EEF2FF', color: '#4F46E5' }}>{f}</span>)}
                </div>
                <div style={{ fontSize: 13, color: '#111827', textAlign: 'right' }}>{qtyFmt(s.planned_qty)}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Components tab ── */}
        {tab === 'components' && (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 120px 120px 110px 90px', padding: '10px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['Component', 'Type', 'Required Qty', 'Issued Qty', 'Optional'].map((h, i) => <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: i === 2 || i === 3 ? 'right' : 'left' }}>{h}</div>)}
            </div>
            {componentLines.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No components. Components are snapshotted from the BOM when the work order is released (none if no BOM is attached).</div>
            ) : componentLines.map(c => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 120px 120px 110px 90px', padding: '10px 14px', borderBottom: '1px solid #F3F4F6', alignItems: 'center' }}>
                <div style={{ fontSize: 13, color: '#111827' }}>{c.component ? `${c.component.item_code} — ${c.component.item_name}` : (c.component_item_id ?? '—')}</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>{c.component_type ?? '—'}</div>
                <div style={{ fontSize: 13, color: '#111827', textAlign: 'right' }}>{qtyFmt(c.required_qty)}</div>
                <div style={{ fontSize: 13, color: '#111827', textAlign: 'right' }}>{qtyFmt(c.issued_qty)}</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>{c.is_optional ? 'Yes' : 'No'}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Production Logs tab ── */}
        {tab === 'logs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              {isReleased && !isPpoGeneratedWo && (
                <button onClick={() => router.push(`/production-logs/new?wo_id=${id}&wo_number=${encodeURIComponent(wo.wo_number)}`)}
                  style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}>+ New Production Log (this WO)</button>
              )}
              {isReleased && isPpoGeneratedWo && (
                <button onClick={() => router.push('/production-work')}
                  style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 6, background: '#059669', fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer' }}>Log from Shop Floor →</button>
              )}
            </div>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(140px,1fr) 150px 90px 90px 90px', padding: '10px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                {['Date', 'Step', 'Worker', 'Good', 'Rework', 'Scrap'].map((h, i) => <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>)}
              </div>
              {logsLoading ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading production logs…</div>
              ) : logs.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No production logs recorded against this work order yet.</div>
              ) : logs.map(l => (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '120px minmax(140px,1fr) 150px 90px 90px 90px', padding: '10px 14px', borderBottom: '1px solid #F3F4F6', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, color: '#6B7280' }}>{formatDate(l.entry_date)}</div>
                  <div style={{ fontSize: 13, color: '#111827' }}>{l.step ? `${l.step.seq_no ?? ''} ${l.step.step_name ?? ''}`.trim() : '—'}</div>
                  <div style={{ fontSize: 13, color: '#111827' }}>{l.worker ? `${l.worker.worker_code} — ${l.worker.worker_name}` : '—'}</div>
                  <div style={{ fontSize: 13, color: '#059669', textAlign: 'right' }}>{qtyFmt(l.net_good_qty ?? l.good_qty)}{l.correction_count > 0 && <div style={{ fontSize: 10, color: '#92400E' }}>was {qtyFmt(l.good_qty)}</div>}</div>
                  <div style={{ fontSize: 13, color: '#D97706', textAlign: 'right' }}>{qtyFmt(l.rework_qty)}</div>
                  <div style={{ fontSize: 13, color: '#DC2626', textAlign: 'right' }}>{qtyFmt(l.net_scrap_qty ?? l.scrap_qty)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Audit tab ── */}
        {tab === 'audit' && (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Audit</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', rowGap: 8, columnGap: 12, fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: '#6B7280' }}>Event</div>
              <div style={{ fontWeight: 600, color: '#6B7280' }}>By</div>
              <div style={{ fontWeight: 600, color: '#6B7280' }}>At</div>
              {auditRows.map(([ev, by, at]) => (
                <Fragmentish key={ev} ev={ev} by={by} at={at} />
              ))}
            </div>
          </div>
        )}

        {/* Lifecycle buttons (always reachable; Edit removed) */}
        {!readOnly && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            {isDraft && !isPpoGeneratedWo && !isInternalPlan && <button onClick={() => askConfirm('release', 'Release')} disabled={actionBusy} style={btn('#2563EB', actionBusy)}>Release</button>}
            {isReleased && !isPpoGeneratedWo && <button onClick={() => askConfirm('complete', 'Complete')} disabled={actionBusy} style={btn('#059669', actionBusy)}>Complete</button>}
            {isReleased && isPpoGeneratedWo && <button onClick={() => router.push('/production-work')} style={btn('#059669', false)}>Complete from Shop Floor →</button>}
            {isCompleted && <button onClick={() => askConfirm('close', 'Close')} disabled={actionBusy} style={btn('#6B7280', actionBusy)}>Close</button>}
            {(isDraft || isReleased) && !isPpoGeneratedWo && <button onClick={() => askConfirm('cancel', 'Cancel')} disabled={actionBusy} style={btnOutline('#DC2626', actionBusy)}>Cancel</button>}
            {(isDraft || isReleased) && isPpoGeneratedWo && wo.source_ppo_id && <button onClick={() => router.push(`/production-plan-orders/${wo.source_ppo_id}`)} style={btnOutline('#DC2626', false)}>Managed in PPO →</button>}
          </div>
        )}

        {/* Inline confirm */}
        {confirmAction && (
          <div onClick={() => !actionBusy && setConfirmAction(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{confirmAction.label} work order?</div>
              <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
                {confirmAction.label} <span style={{ fontFamily: 'monospace', color: '#374151' }}>{wo.wo_number}</span>? This action cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setConfirmAction(null)} disabled={actionBusy} style={{ height: 36, padding: '0 16px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
                <button onClick={runConfirmed} disabled={actionBusy} style={btn('#4F46E5', actionBusy)}>{actionBusy ? 'Working…' : `Confirm ${confirmAction.label}`}</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ══════════════════ PRINT TRAVELER (print only) ══════════════════ */}
      <div className="wo-print-only">
        <h2 style={{ fontSize: 18, margin: '0 0 4px', fontFamily: 'monospace' }}>{wo.wo_number}</h2>
        <div style={{ fontSize: 12, marginBottom: 12, color: '#374151' }}>
          {wo.item ? `${wo.item.item_code} — ${wo.item.item_name}` : ''} · Status: {STATUS_LABEL[wo.status] ?? wo.status} · WO Date: {formatDate(wo.wo_date)}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
          <tbody>
            <tr><td style={{ padding: 3, fontWeight: 600 }}>Planned</td><td style={{ padding: 3 }}>{qtyFmt(planned)}</td><td style={{ padding: 3, fontWeight: 600 }}>Produced (final step)</td><td style={{ padding: 3 }}>{qtyFmt(producedGood)}</td><td style={{ padding: 3, fontWeight: 600 }}>Balance</td><td style={{ padding: 3 }}>{qtyFmt(balance)}</td><td style={{ padding: 3, fontWeight: 600 }}>Completion</td><td style={{ padding: 3 }}>{completionPct}%</td></tr>
          </tbody>
        </table>
        <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0 4px' }}>Steps</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
          <thead><tr>{['Seq', 'Step', 'Status', 'Planned Qty'].map(h => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #000', padding: 3 }}>{h}</th>)}</tr></thead>
          <tbody>
            {stepLines.map(s => <tr key={s.id}><td style={{ padding: 3 }}>{s.seq_no}</td><td style={{ padding: 3 }}>{s.step_name}</td><td style={{ padding: 3 }}>{STEP_STATUS_LABEL[s.step_status] ?? s.step_status ?? ''}</td><td style={{ padding: 3 }}>{qtyFmt(s.planned_qty)}</td></tr>)}
          </tbody>
        </table>
        <div style={{ fontWeight: 700, fontSize: 13, margin: '8px 0 4px' }}>Components</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Component', 'Required', 'Issued'].map(h => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #000', padding: 3 }}>{h}</th>)}</tr></thead>
          <tbody>
            {componentLines.length === 0
              ? <tr><td colSpan={3} style={{ padding: 3, color: '#6B7280' }}>No components.</td></tr>
              : componentLines.map(c => <tr key={c.id}><td style={{ padding: 3 }}>{c.component ? `${c.component.item_code} — ${c.component.item_name}` : c.component_item_id}</td><td style={{ padding: 3 }}>{qtyFmt(c.required_qty)}</td><td style={{ padding: 3 }}>{qtyFmt(c.issued_qty)}</td></tr>)}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function Fragmentish({ ev, by, at }) {
  const roCell = (v) => <div style={{ color: v != null && v !== '' ? '#374151' : '#9CA3AF' }}>{v != null && v !== '' ? v : '—'}</div>;
  const dt = at ? new Date(at) : null;
  const atTxt = dt && !isNaN(dt) ? dt.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <>
      <div style={{ color: '#111827', fontWeight: 500 }}>{ev}</div>
      {roCell(by)}
      {roCell(atTxt)}
    </>
  );
}

function btn(bg, busy) {
  return { height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: busy ? '#9CA3AF' : bg, fontSize: 13, color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500 };
}
function btnOutline(color, busy) {
  return { height: 36, padding: '0 18px', border: `1px solid ${color}`, borderRadius: 6, background: '#fff', fontSize: 13, color, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500 };
}
