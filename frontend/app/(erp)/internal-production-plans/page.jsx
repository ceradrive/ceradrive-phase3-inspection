'use client';

/* P1-IPP-GUIDED — Internal Production Plans (list + detail drawer)
 * Phase-1 UX: one clear next-action, persisted blocker chips (from resolved_recipe_id /
 * resolved_routing_id), no UUID display, generated-WO link, progress stepper, inline error
 * banner + inline cancel reason, cleaner mobile layout. Uses existing backend routes only;
 * relies on getPlanById now returning per-line wo_number/wo_id + work_orders[]. No new route,
 * no schema change, no material posting, no navigation side-effects beyond fix/WO deep-links.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';

const S = {
  page:{ padding:'12px 18px', background:'#F9F9FF', minHeight:'100vh', fontFamily:'Inter, -apple-system, BlinkMacSystemFont, sans-serif', color:'#041B3C' },
  bar:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, gap:8, flexWrap:'wrap' },
  title:{ margin:0, fontSize:22, lineHeight:'28px', fontWeight:900, color:'#041B3C', letterSpacing:'-0.02em' },
  panel:{ background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:16, overflow:'hidden', boxShadow:'0 1px 3px rgba(15,23,42,0.05)' },
  tableWrap:{ overflowX:'auto', background:'#FFFFFF' },
  table:{ width:'100%', borderCollapse:'collapse', fontSize:14 },
  th:{ textAlign:'left', padding:'9px 12px', background:'#F1F3FF', borderBottom:'1px solid #DCDFE4', fontSize:11, color:'#434654', fontWeight:900, textTransform:'uppercase', letterSpacing:.3, whiteSpace:'nowrap' },
  td:{ padding:'11px 12px', borderBottom:'1px solid #EEF1F7', verticalAlign:'middle', color:'#041B3C' },
  row:{ cursor:'pointer' },
  btn:{ border:0, borderRadius:12, background:'#003D9B', color:'#FFFFFF', padding:'12px 18px', fontWeight:900, cursor:'pointer', fontSize:15, boxShadow:'0 8px 18px rgba(0,61,155,0.18)', minHeight:44 },
  btn2:{ border:'1px solid #C3C6D6', borderRadius:12, background:'#FFFFFF', color:'#041B3C', padding:'10px 16px', fontWeight:900, cursor:'pointer', fontSize:14, minHeight:44 },
  btnDanger:{ border:'1px solid #FCA5A5', borderRadius:12, background:'#FEF2F2', color:'#991B1B', padding:'10px 16px', fontWeight:900, cursor:'pointer', fontSize:14, minHeight:44 },
  linkBtn:{ display:'inline-flex', alignItems:'center', textDecoration:'none', border:0, borderRadius:12, background:'#003D9B', color:'#FFFFFF', padding:'12px 18px', fontWeight:900, fontSize:15, boxShadow:'0 8px 18px rgba(0,61,155,0.18)', minHeight:44 },
  state:{ padding:'28px 16px', textAlign:'center', color:'#737685', fontSize:14, fontWeight:700 },
  errBox:{ padding:'12px 14px', color:'#991B1B', background:'#FEE2E2', border:'1px solid #FCA5A5', borderRadius:10, fontSize:13, margin:'0 0 12px' },
  overlay:{ position:'fixed', inset:0, background:'rgba(4,27,60,0.32)', display:'flex', justifyContent:'flex-end', zIndex:50 },
  drawer:{ width:'min(720px, 96vw)', height:'100%', background:'#F9F9FF', boxShadow:'-12px 0 30px rgba(15,23,42,0.18)', overflowY:'auto', padding:'16px 18px' },
  drawerHead:{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:12 },
  metaGrid:{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px,1fr))', gap:8, margin:'8px 0 14px' },
  metaCell:{ background:'#FFFFFF', border:'1px solid #DCDFE4', borderRadius:10, padding:'8px 12px' },
  metaLabel:{ color:'#737685', fontSize:10, fontWeight:900, textTransform:'uppercase', letterSpacing:.45 },
  metaVal:{ fontSize:14, fontWeight:800, marginTop:2, color:'#041B3C', wordBreak:'break-word' },
  actions:{ display:'flex', gap:8, flexWrap:'wrap', margin:'6px 0 6px', alignItems:'center' },
  hint:{ fontSize:12, color:'#64748b', margin:'0 0 12px' },
  badge:{ display:'inline-flex', alignItems:'center', padding:'3px 9px', borderRadius:999, fontSize:11, fontWeight:900, whiteSpace:'nowrap' },
  chip:{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 9px', borderRadius:999, fontSize:11, fontWeight:900, whiteSpace:'nowrap' },
  fixLink:{ fontSize:11, fontWeight:900, color:'#003D9B', textDecoration:'none', marginLeft:6, whiteSpace:'nowrap' },
  noteBox:{ background:'#FFF8ED', border:'1px solid #FFB950', borderRadius:10, padding:'10px 12px', margin:'0 0 14px', fontSize:12, color:'#7D5200' },
  stepper:{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', margin:'0 0 14px' },
  step:{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:999, fontSize:11, fontWeight:900, border:'1px solid #DCDFE4', background:'#FFFFFF', color:'#737685' },
  stepDone:{ background:'#DCFCE7', borderColor:'#86EFAC', color:'#166534' },
  stepCurrent:{ background:'#DBEAFE', borderColor:'#93C5FD', color:'#1D4ED8' },
  cancelPanel:{ background:'#FFFFFF', border:'1px solid #FCA5A5', borderRadius:12, padding:'12px', margin:'0 0 12px' },
  textarea:{ width:'100%', minHeight:64, borderRadius:10, border:'1px solid #C3C6D6', padding:'8px 10px', fontSize:14, fontFamily:'inherit', boxSizing:'border-box' },
};

const STATUS = {
  DRAFT:        { c:'#6B7280', bg:'#F3F4F6', label:'Draft' },
  APPROVED:     { c:'#1D4ED8', bg:'#DBEAFE', label:'Approved' },
  WO_GENERATED: { c:'#166534', bg:'#DCFCE7', label:'Work orders created' },
  CANCELLED:    { c:'#991B1B', bg:'#FEE2E2', label:'Cancelled' },
};
function badgeFor(status) {
  const k = String(status || '').toUpperCase();
  return STATUS[k] || { c:'#6B7280', bg:'#F3F4F6', label:(status || '—') };
}
const TONE = {
  ok:{ c:'#166534', bg:'#DCFCE7' }, bad:{ c:'#991B1B', bg:'#FEE2E2' },
  wo:{ c:'#1D4ED8', bg:'#DBEAFE' }, muted:{ c:'#6B7280', bg:'#F3F4F6' },
};

function canCancel(status) { return ['DRAFT', 'APPROVED'].includes(String(status || '').toUpperCase()); }
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// One primary next-action, derived only from real states + work_orders[] from getPlanById.
function deriveNext(detail) {
  if (!detail) return null;
  const st = String(detail.status || '').toUpperCase();
  const wos = Array.isArray(detail.work_orders) ? detail.work_orders : [];
  // P1B-IPP-RELEASED-DONE: treat released AND completed child WOs as past-release.
  const isDone = (s) => { const x = String(s || '').toLowerCase(); return x === 'released' || x === 'completed'; };
  const anyReleased = wos.some((w) => String(w.status || '').toLowerCase() === 'released');
  const anyCompleted = wos.some((w) => String(w.status || '').toLowerCase() === 'completed');
  const anyPrepared = wos.some((w) => w.bom_id || w.readiness_status);
  const needRelease = wos.some((w) => (w.bom_id || w.readiness_status) && !isDone(w.status));
  if (st === 'DRAFT')    return { key:'approve',  label:'Approve plan' };
  if (st === 'APPROVED') return { key:'generate', label:'Generate Work Orders' };
  if (st === 'WO_GENERATED') {
    if (needRelease) return { key:'release', label:'Release to Production Work' };
    if (anyReleased) return { key:'view', label:'View on Production Floor', href:'/production-work' };
    if (anyCompleted) return { key:'open', label:'Open Work Order', href:'/work-orders' };
    if (anyPrepared) return { key:'release', label:'Release to Production Work' };
    return { key:'prepare', label:'Prepare for Release Review' };
  }
  return null; // CANCELLED / unknown -> no primary
}

// Persisted line state from resolved ids (no dependence on transient approve result).
function lineState(l) {
  const st = String(l.status || '').toUpperCase();
  if (st === 'WO_CREATED') return { tone:'wo', text:'Work order created' };
  if (st === 'CANCELLED')  return { tone:'muted', text:'Cancelled' };
  const r = l.resolved_recipe_id, ro = l.resolved_routing_id;
  if (!r && !ro) return { tone:'bad', text:'Missing recipe & routing', fixes:[['Add a recipe','/masters/stage-recipes'],['Add a routing','/masters/routings']] };
  if (!r)        return { tone:'bad', text:'Missing recipe',  fixes:[['Add a recipe','/masters/stage-recipes']] };
  if (!ro)       return { tone:'bad', text:'Missing routing', fixes:[['Add a routing','/masters/routings']] };
  return { tone:'ok', text:'Ready to generate' };
}

// Progress stepper model from status + prepared/released flags.
function stepperModel(detail) {
  const st = String((detail && detail.status) || '').toUpperCase();
  if (st === 'CANCELLED') return { cancelled:true, steps:[] };
  const wos = (detail && Array.isArray(detail.work_orders)) ? detail.work_orders : [];
  const released = wos.some((w) => { const s = String(w.status || '').toLowerCase(); return s === 'released' || s === 'completed'; });
  const prepared = wos.some((w) => w.bom_id || w.readiness_status);
  const done = {
    Create: true,
    Approve: ['APPROVED', 'WO_GENERATED'].includes(st),
    Generate: st === 'WO_GENERATED',
    Prepare: prepared,
    Release: released,
  };
  const order = ['Create', 'Approve', 'Generate', 'Prepare', 'Release'];
  const labels = { Create:'Create', Approve:'Approve', Generate:'Work orders', Prepare:'Prepare', Release:'Release' };
  let currentSet = false;
  const steps = order.map((k) => {
    const isDone = done[k];
    let cur = false;
    if (!isDone && !currentSet) { cur = true; currentSet = true; }
    return { key:k, label:labels[k], done:isDone, current:cur };
  });
  return { cancelled:false, steps };
}

function Badge({ status }) {
  const s = badgeFor(status);
  return <span style={{ ...S.badge, color:s.c, background:s.bg }}>{s.label}</span>;
}
function Stepper({ detail }) {
  const m = stepperModel(detail);
  if (m.cancelled) return <div style={S.stepper}><span style={{ ...S.step, ...S.stepCurrent, color:'#991B1B', background:'#FEE2E2', borderColor:'#FCA5A5' }}>Cancelled</span></div>;
  return (
    <div style={S.stepper}>
      {m.steps.map((s) => (
        <span key={s.key} style={{ ...S.step, ...(s.done ? S.stepDone : {}), ...(s.current ? S.stepCurrent : {}) }}>
          {s.done ? '✓' : (s.current ? '◉' : '○')} {s.label}
        </span>
      ))}
    </div>
  );
}

export default function InternalProductionPlansPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [resultNote, setResultNote] = useState(null); // transient summary after an action

  async function loadList() {
    setLoading(true); setError('');
    try {
      const { data, error: err } = await api.get('/api/v1/internal-production-plans', { limit: 200 });
      if (err) { setError(err.message || 'Failed to load internal production plans.'); setRows([]); }
      else setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e && e.message) || 'Failed to load internal production plans.'); setRows([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadList(); }, []);

  async function loadDetail(id) {
    setDetailLoading(true); setDetailError('');
    try {
      const { data, error: err } = await api.get('/api/v1/internal-production-plans/' + id);
      if (err) { setDetailError(err.message || 'Failed to load plan detail.'); setDetail(null); }
      else setDetail(data || null);
    } catch (e) {
      setDetailError((e && e.message) || 'Failed to load plan detail.'); setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function resetTransient() { setActionError(''); setResultNote(null); setCancelOpen(false); setCancelReason(''); }
  function openDetail(id) { setSelectedId(id); setDetail(null); resetTransient(); loadDetail(id); }
  function closeDrawer() { setSelectedId(null); setDetail(null); setDetailError(''); resetTransient(); }

  async function runAction(id, path, okNote) {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const { data, error: err } = await api.post('/api/v1/internal-production-plans/' + id + path, {});
      if (err) { setActionError(err.message || 'Action failed. Please try again.'); return; }
      await loadDetail(id);
      await loadList();
      setResultNote(okNote ? okNote(data || {}) : null);
    } catch (e) {
      setActionError((e && e.message) || 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function doApprove(id)    { return runAction(id, '/approve', (d) => `Approved — recipe resolved ${d.recipe_resolved_count ?? 0}, routing resolved ${d.routing_resolved_count ?? 0}, unresolved ${d.unresolved_count ?? 0}.`); }
  function doGenerate(id)   { return runAction(id, '/generate-work-orders', (d) => `Work Orders — created ${d.created_count ?? 0}${(d.already_created_count ?? 0) ? `, already ${d.already_created_count}` : ''}${(d.skipped_ineligible_count ?? 0) ? `, skipped ${d.skipped_ineligible_count}` : ''}.`); }
  function doPrepare(id)    { return runAction(id, '/prepare-work-orders', (d) => `Prepared ${d.prepared_count ?? 0} Work Order(s)${(d.skipped_count ?? 0) ? `, skipped ${d.skipped_count}` : ''}. Draft retained.`); }
  function doReleaseWOs(id) { return runAction(id, '/release-work-orders', (d) => `Released ${d.released_count ?? 0} Work Order(s)${(d.skipped_count ?? 0) ? `, skipped ${d.skipped_count}` : ''}.`); }

  async function submitCancel(id) {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const { error: err } = await api.post('/api/v1/internal-production-plans/' + id + '/cancel', { reason: cancelReason || '' });
      if (err) { setActionError(err.message || 'Failed to cancel plan.'); return; }
      setCancelOpen(false); setCancelReason('');
      await loadDetail(id);
      await loadList();
    } catch (e) {
      setActionError((e && e.message) || 'Failed to cancel plan.');
    } finally {
      setBusy(false);
    }
  }

  function runNext(next, id) {
    if (!next) return;
    if (next.key === 'approve')  return doApprove(id);
    if (next.key === 'generate') return doGenerate(id);
    if (next.key === 'prepare')  return doPrepare(id);
    if (next.key === 'release')  return doReleaseWOs(id);
  }

  const lines = (detail && Array.isArray(detail.lines)) ? detail.lines : [];
  const next = deriveNext(detail);

  return (
    <div style={S.page}>
      <div style={S.bar}>
        <h1 style={S.title}>Internal Production Plans</h1>
        <button style={S.btn2} onClick={loadList} disabled={loading} title="Reload the list.">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {error ? <div style={S.errBox}>{error}</div> : null}

      <div style={S.panel}>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Plan Number</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Lines</th>
                <th style={S.th}>Created</th>
                <th style={S.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={S.td} colSpan={5}><div style={S.state}>Loading…</div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td style={S.td} colSpan={5}><div style={S.state}>No internal production plans yet. Create one from the MRP page.</div></td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} style={S.row} onClick={() => openDetail(r.id)}>
                  <td style={{ ...S.td, fontWeight:900 }}>{r.plan_number || '—'}</td>
                  <td style={S.td}><Badge status={r.status} /></td>
                  <td style={S.td}>{r.line_count != null ? r.line_count : '—'}</td>
                  <td style={S.td}>{fmtDate(r.created_at)}</td>
                  <td style={{ ...S.td, maxWidth:320, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedId ? (
        <div style={S.overlay} onClick={closeDrawer}>
          <div style={S.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerHead}>
              <div>
                <div style={{ fontSize:18, fontWeight:900, color:'#041B3C' }}>{detail ? (detail.plan_number || 'Plan') : 'Plan'}</div>
                <div style={{ marginTop:6 }}>{detail ? <Badge status={detail.status} /> : null}</div>
              </div>
              <button style={S.btn2} onClick={closeDrawer} title="Close">Close</button>
            </div>

            {detailError ? <div style={S.errBox}>{detailError}</div> : null}
            {detailLoading ? <div style={S.state}>Loading detail…</div> : null}

            {detail ? (
              <>
                <Stepper detail={detail} />

                <div style={S.metaGrid}>
                  <div style={S.metaCell}><div style={S.metaLabel}>Status</div><div style={S.metaVal}>{badgeFor(detail.status).label}</div></div>
                  <div style={S.metaCell}><div style={S.metaLabel}>Created</div><div style={S.metaVal}>{fmtDate(detail.created_at)}</div></div>
                  <div style={S.metaCell}><div style={S.metaLabel}>Lines</div><div style={S.metaVal}>{lines.length}</div></div>
                  <div style={{ ...S.metaCell, gridColumn:'1 / -1' }}><div style={S.metaLabel}>Notes</div><div style={S.metaVal}>{detail.notes || '—'}</div></div>
                </div>

                {actionError ? <div style={S.errBox}>{actionError}</div> : null}

                <div style={S.actions}>
                  {next && next.href ? (
                    <Link href={next.href} style={S.linkBtn}>{next.label}</Link>
                  ) : next ? (
                    <button style={S.btn} onClick={() => runNext(next, detail.id)} disabled={busy}>{busy ? 'Working…' : next.label}</button>
                  ) : null}
                  {canCancel(detail.status) ? (
                    <button style={S.btnDanger} onClick={() => { setCancelOpen(true); setActionError(''); }} disabled={busy} title="Cancel this plan.">Cancel Plan</button>
                  ) : null}
                </div>

                {next && next.key === 'prepare' ? <div style={S.hint}>Sets BOM, snapshots steps/components, computes readiness. Draft stays. No inventory posting.</div> : null}
                {next && next.key === 'release' ? <div style={S.hint}>Recomputes readiness on current stock; releases ready / partial Work Orders. No inventory posting.</div> : null}

                {cancelOpen ? (
                  <div style={S.cancelPanel}>
                    <div style={{ fontWeight:900, marginBottom:6, color:'#991B1B' }}>Cancel this plan?</div>
                    <textarea style={S.textarea} placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                    <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                      <button style={S.btnDanger} onClick={() => submitCancel(detail.id)} disabled={busy}>{busy ? 'Working…' : 'Confirm Cancel'}</button>
                      <button style={S.btn2} onClick={() => { setCancelOpen(false); setCancelReason(''); }} disabled={busy}>Back</button>
                    </div>
                  </div>
                ) : null}

                {resultNote ? <div style={S.noteBox}>{resultNote}</div> : null}

                <div style={S.panel}>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>#</th>
                          <th style={S.th}>Item</th>
                          <th style={S.th}>Qty</th>
                          <th style={S.th}>Stage</th>
                          <th style={S.th}>Status</th>
                          <th style={S.th}>Work Order</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 ? (
                          <tr><td style={S.td} colSpan={6}><div style={S.state}>No lines.</div></td></tr>
                        ) : lines.map((l) => {
                          const ls = lineState(l);
                          const tone = TONE[ls.tone] || TONE.muted;
                          return (
                            <tr key={l.id}>
                              <td style={S.td}>{l.line_number}</td>
                              <td style={S.td}>
                                <div style={{ fontWeight:900 }}>{l.item_code || l.item_name || '—'}</div>
                                <div style={{ color:'#737685', fontSize:12 }}>{l.item_code ? (l.item_name || '') : ''}</div>
                              </td>
                              <td style={S.td}>{l.qty} {l.uom_code || ''}</td>
                              <td style={S.td}>{l.stage_type || '—'}</td>
                              <td style={S.td}>
                                <span style={{ ...S.chip, color:tone.c, background:tone.bg }}>{ls.text}</span>
                                {Array.isArray(ls.fixes) ? ls.fixes.map((f) => (
                                  <Link key={f[1]} href={f[1]} style={S.fixLink}>{f[0]}</Link>
                                )) : null}
                              </td>
                              <td style={S.td}>
                                {l.wo_number ? <Link href="/work-orders" style={{ color:'#003D9B', fontWeight:900, textDecoration:'none' }}>{l.wo_number}</Link> : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
