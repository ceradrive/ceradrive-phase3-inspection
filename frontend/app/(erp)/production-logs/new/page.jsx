'use client';

/**
 * CERADRIVE ERP — Production Log (create)  [Phase 1]
 * Workflow: select released WO -> load steps -> select step -> date/shift/worker/machine
 * -> good/rework/scrap -> save. Immutable ENTRY; no edit/delete/reversal. Redirects to list.
 * Shift required; worker/machine optional. Uses real Toast signature (addToast).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams }  from 'next/navigation';
import { api }                         from '../../../../lib/api.js';
import { useToast }                    from '../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const selectStyle = (err) => ({ ...inputStyle(err), background: '#fff', cursor: 'pointer' });
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 3 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

// Defensive shift label — shift_master columns weren't dumped; adapt to whatever exists.
function shiftLabel(s) {
  return s.shift_name ?? s.shift_code ?? s.name ?? s.code ?? String(s.id).slice(0, 8);
}

function WOSearchSelect({ valueLabel, onPick, error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const boxRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/production-logs/work-orders', { search: q, limit: 20 });
      if (!cancelled) setResults(data ?? []);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(true)} style={{ ...inputStyle(error), display: 'flex', alignItems: 'center', cursor: 'pointer', color: valueLabel ? '#111827' : '#9CA3AF' }}>
        {valueLabel || 'Search released work order…'}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type WO number…"
            style={{ width: '100%', height: 36, padding: '0 10px', border: 'none', borderBottom: '1px solid #E5E7EB', outline: 'none', fontSize: 13, boxSizing: 'border-box' }} />
          {results.map(wo => (
            <div key={wo.id} onClick={() => { onPick(wo); setOpen(false); setQ(''); }}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{wo.wo_number}</span>
              {wo.item ? <span style={{ color: '#6B7280' }}> · {wo.item.item_code}</span> : null}
            </div>
          ))}
          {results.length === 0 && <div style={{ padding: 10, fontSize: 12, color: '#9CA3AF' }}>No released work orders.</div>}
        </div>
      )}
    </div>
  );
}

export default function NewProductionLogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addToast = useToast();

  const [woId,    setWoId]    = useState('');
  const [woLabel, setWoLabel] = useState('');
  const [steps,   setSteps]   = useState([]);
  const [stepId,  setStepId]  = useState('');
  const [shifts,  setShifts]  = useState([]);
  const [workers, setWorkers] = useState([]);
  const [machines, setMachines] = useState([]);

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shiftId,   setShiftId]   = useState('');
  const [workerId,  setWorkerId]  = useState('');
  const [machineId, setMachineId] = useState('');
  const [goodQty,   setGoodQty]   = useState('');
  const [reworkQty, setReworkQty] = useState('');
  const [scrapQty,  setScrapQty]  = useState('');
  const [remarks,   setRemarks]   = useState('');

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/v1/production-logs/shifts').then(({ data }) => setShifts(data ?? []));
    api.get('/api/v1/production-logs/workers').then(({ data }) => setWorkers(data ?? []));
    api.get('/api/v1/production-logs/machines').then(({ data }) => setMachines(data ?? []));
  }, []);

  // Preselect WO when arriving from a WO detail page (?wo_id=&wo_number=). One-time.
  useEffect(() => {
    const preWoId = searchParams?.get('wo_id');
    if (!preWoId) return;
    const preWoNumber = searchParams?.get('wo_number');
    setWoId(preWoId);
    setWoLabel(preWoNumber || preWoId);
    api.get('/api/v1/production-logs/steps', { wo_id: preWoId }).then(({ data }) => setSteps(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickWO(wo) {
    setWoId(wo.id);
    setWoLabel(`${wo.wo_number}${wo.item ? ` · ${wo.item.item_code}` : ''}`);
    setErrors(p => ({ ...p, wo: undefined }));
    setStepId(''); setSteps([]);
    api.get('/api/v1/production-logs/steps', { wo_id: wo.id }).then(({ data }) => setSteps(data ?? []));
  }

  function validate() {
    const errs = {};
    if (!woId)    errs.wo    = 'Work order is required.';
    if (!stepId)  errs.step  = 'Step is required.';
    if (!shiftId) errs.shift = 'Shift is required.';
    for (const [k, v, label] of [['good', goodQty, 'Good'], ['rework', reworkQty, 'Rework'], ['scrap', scrapQty, 'Scrap']]) {
      if (v !== '' && (isNaN(Number(v)) || Number(v) < 0)) errs[k] = `${label} qty must be zero or greater.`;
    }
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/production-logs/master', {
      wo_id:        woId,
      step_line_id: stepId,
      entry_date:   entryDate || null,
      shift_id:     shiftId,
      worker_id:    workerId  || null,
      machine_id:   machineId || null,
      good_qty:     goodQty   === '' ? 0 : Number(goodQty),
      rework_qty:   reworkQty === '' ? 0 : Number(reworkQty),
      scrap_qty:    scrapQty  === '' ? 0 : Number(scrapQty),
      notes:        remarks.trim() || null,
    });
    setSaving(false);
    if (error) { addToast('Could not save production log', error.message ?? ''); return; }
    addToast('Production log saved', data?.wo?.wo_number ?? '');
    router.push('/production-logs');
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/production-logs')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Production Logs</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Production Log</h1>
      </div>

      {/* WO + Step */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Work Order * <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(released only)</span></label>
            <WOSearchSelect valueLabel={woLabel} onPick={pickWO} error={errors.wo} />
            {errors.wo && <span style={errStyle}>{errors.wo}</span>}
          </div>
          <div>
            <label style={labelStyle}>WO Step *</label>
            <select value={stepId} onChange={e => { setStepId(e.target.value); setErrors(p => ({ ...p, step: undefined })); }} disabled={!woId} style={selectStyle(errors.step)}>
              <option value="">{woId ? 'Select step…' : 'Pick a work order first'}</option>
              {steps.map(s => <option key={s.id} value={s.id}>{s.seq_no != null ? `${s.seq_no}. ` : ''}{s.step_name}</option>)}
            </select>
            {errors.step && <span style={errStyle}>{errors.step}</span>}
          </div>
        </div>
      </div>

      {/* Context */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Production Date</label>
            <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} style={inputStyle()} />
          </div>
          <div>
            <label style={labelStyle}>Shift *</label>
            <select value={shiftId} onChange={e => { setShiftId(e.target.value); setErrors(p => ({ ...p, shift: undefined })); }} style={selectStyle(errors.shift)}>
              <option value="">Select shift…</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{shiftLabel(s)}</option>)}
            </select>
            {errors.shift && <span style={errStyle}>{errors.shift}</span>}
          </div>
          <div>
            <label style={labelStyle}>Worker <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(optional)</span></label>
            <select value={workerId} onChange={e => setWorkerId(e.target.value)} style={selectStyle()}>
              <option value="">None</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.worker_code} — {w.worker_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Machine <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(optional)</span></label>
            <select value={machineId} onChange={e => setMachineId(e.target.value)} style={selectStyle()}>
              <option value="">None</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Quantities */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Good Qty</label>
            <input value={goodQty} onChange={e => { setGoodQty(e.target.value); setErrors(p => ({ ...p, good: undefined })); }} type="number" step="any" min="0" style={inputStyle(errors.good)} />
            {errors.good && <span style={errStyle}>{errors.good}</span>}
          </div>
          <div>
            <label style={labelStyle}>Rework Qty</label>
            <input value={reworkQty} onChange={e => { setReworkQty(e.target.value); setErrors(p => ({ ...p, rework: undefined })); }} type="number" step="any" min="0" style={inputStyle(errors.rework)} />
            {errors.rework && <span style={errStyle}>{errors.rework}</span>}
          </div>
          <div>
            <label style={labelStyle}>Scrap Qty</label>
            <input value={scrapQty} onChange={e => { setScrapQty(e.target.value); setErrors(p => ({ ...p, scrap: undefined })); }} type="number" step="any" min="0" style={inputStyle(errors.scrap)} />
            {errors.scrap && <span style={errStyle}>{errors.scrap}</span>}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/production-logs')} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

    </div>
  );
}
