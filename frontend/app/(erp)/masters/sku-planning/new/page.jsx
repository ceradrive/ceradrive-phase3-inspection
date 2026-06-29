'use client';

/**
 * CERADRIVE ERP — SKU Planning Master (create)
 * Header: item + active routing (seeds steps) + packaging/dimensions + preferred machine/die.
 * Steps: per-stage parameters (cavity planned/used, cycle/piece/setup times, time basis,
 *   batch, tray, curing/drying, target rate, manpower, machine/die, QC flags, notes).
 * bp_weight_g is derived from item_master (shown read-only). New plan saves as draft.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api }       from '../../../../../lib/api.js';
import { useToast }  from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const cell = { width: '100%', height: 32, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 3 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

const HEADER_NUM = [
  ['weight_g', 'Weight (g)'], ['pcs_per_set', 'Pcs / set'], ['pcs_per_tray', 'Pcs / tray'],
  ['trays_per_batch', 'Trays / batch'], ['pcs_in_crate', 'Pcs / crate'],
  ['length_mm', 'Length (mm)'], ['width_mm', 'Width (mm)'], ['thickness_mm', 'Thickness (mm)'],
  ['box_length_mm', 'Box L (mm)'], ['box_width_mm', 'Box W (mm)'], ['box_height_mm', 'Box H (mm)'],
  ['carton_length_mm', 'Carton L (mm)'], ['carton_width_mm', 'Carton W (mm)'], ['carton_height_mm', 'Carton H (mm)'],
];
const STEP_NUM = [
  ['effective_cavity_count', 'Planned cavities'], ['cavities_used', 'Cavities used'],
  ['cycle_time_sec', 'Cycle time (s)'], ['time_per_piece_sec', 'Per-piece (s)'], ['setup_time_min', 'Setup (min)'],
  ['batch_size_kg', 'Batch (kg)'], ['batch_time_min', 'Batch time (min)'], ['tray_capacity', 'Tray cap'],
  ['drying_time_min', 'Drying (min)'], ['curing_time_min', 'Curing (min)'], ['target_rate_pcs_hr', 'Target (pcs/hr)'],
  ['manpower_count', 'Manpower'],
];
const STEP_FLAGS = [
  ['machine_required', 'Machine'], ['die_required', 'Die'], ['labour_required', 'Labour'],
  ['wip_produced', 'WIP produced'], ['qc_required', 'QC'], ['fpa_required', 'FPA'],
  ['inprocess_qc_required', 'In-process QC'], ['final_qc_required', 'Final QC'], ['packing_qc_required', 'Packing QC'],
];
const TIME_BASES = ['PIECE', 'BATCH', 'KG', 'TRAY'];

function ItemSearchSelect({ valueLabel, onPick, error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const boxRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/sku-planning/items', { search: q, limit: 20 });
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
        {valueLabel || 'Search item…'}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type to search…"
            style={{ width: '100%', height: 36, padding: '0 10px', border: 'none', borderBottom: '1px solid #E5E7EB', outline: 'none', fontSize: 13, boxSizing: 'border-box' }} />
          {results.map(it => (
            <div key={it.id} onClick={() => { onPick(it); setOpen(false); setQ(''); }}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{it.item_code}</span> {it.item_name}
            </div>
          ))}
          {results.length === 0 && <div style={{ padding: 10, fontSize: 12, color: '#9CA3AF' }}>No items.</div>}
        </div>
      )}
    </div>
  );
}

export default function NewSkuPlanPage() {
  const router = useRouter();
  const addToast = useToast();
  const stepKey = useRef(1);

  function emptyStep() {
    const base = { key: stepKey.current++, routing_step_id: '', process_type_id: '', step_name: '', time_basis: '', preferred_machine_id: '', preferred_die_id: '', notes: '' };
    for (const [f] of STEP_NUM) base[f] = '';
    for (const [f] of STEP_FLAGS) base[f] = false;
    return base;
  }

  const [itemId,    setItemId]    = useState('');
  const [itemLabel, setItemLabel] = useState('');
  const [bpWeight,  setBpWeight]  = useState(null);
  const [routings,  setRoutings]  = useState([]);
  const [routingId, setRoutingId] = useState('');
  const [routingTypeId, setRoutingTypeId] = useState('');
  const [header,    setHeader]    = useState(() => Object.fromEntries(HEADER_NUM.map(([f]) => [f, ''])));
  const [preferredMachineId, setPreferredMachineId] = useState('');
  const [preferredDieId,     setPreferredDieId]     = useState('');
  const [notes,     setNotes]     = useState('');
  const [steps,     setSteps]     = useState([]);
  const [processTypes, setProcessTypes] = useState([]);
  const [machines,  setMachines]  = useState([]);
  const [dies,      setDies]      = useState([]);
  const [errors,    setErrors]    = useState({});
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    api.get('/api/v1/sku-planning/process-types').then(({ data }) => setProcessTypes(data ?? []));
    api.get('/api/v1/sku-planning/machines').then(({ data }) => setMachines(data ?? []));
    api.get('/api/v1/sku-planning/dies').then(({ data }) => setDies(data ?? []));
  }, []);

  function pickItem(it) {
    setItemId(it.id);
    setItemLabel(`${it.item_code} — ${it.item_name}`);
    setBpWeight(it.bp_weight_g ?? null);
    setErrors(p => ({ ...p, item: undefined }));
    setRoutingId(''); setRoutingTypeId(''); setRoutings([]);
    api.get('/api/v1/sku-planning/routings', { item_id: it.id }).then(({ data }) => setRoutings(data ?? []));
  }

  function pickRouting(rid) {
    setRoutingId(rid);
    const r = routings.find(x => x.id === rid);
    setRoutingTypeId(r?.routing_type_id ?? '');
    // Seed steps from the routing's steps (routing_step_id set; planners fill parameters).
    if (r && Array.isArray(r.steps)) {
      const seeded = [...r.steps].sort((a, b) => (a.seq_no ?? 0) - (b.seq_no ?? 0)).map(rs => {
        const s = emptyStep();
        s.routing_step_id  = rs.id;
        s.process_type_id  = rs.process_type_id ?? '';
        s.step_name        = rs.step_name ?? '';
        s.machine_required = Boolean(rs.machine_required);
        s.die_required     = Boolean(rs.die_required);
        s.labour_required  = Boolean(rs.labour_required);
        s.wip_produced     = Boolean(rs.wip_produced);
        s.qc_required      = Boolean(rs.qc_required);
        return s;
      });
      setSteps(seeded);
    }
  }

  function setStep(key, patch) { setSteps(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); }
  function addStep()       { setSteps(prev => [...prev, emptyStep()]); }
  function removeStep(key) { setSteps(prev => prev.filter(s => s.key !== key)); }
  function moveStep(idx, dir) {
    setSteps(prev => { const n = [...prev]; const j = idx + dir; if (j < 0 || j >= n.length) return prev; [n[idx], n[j]] = [n[j], n[idx]]; return n; });
  }

  function validate() {
    const errs = {};
    if (!itemId) errs.item = 'Item is required.';
    for (const s of steps) if (!s.step_name.trim()) errs.steps = 'Every step needs a name.';
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const headerNums = Object.fromEntries(HEADER_NUM.map(([f]) => [f, header[f] === '' ? null : header[f]]));
    const payloadSteps = steps.map((s, i) => {
      const out = { seq_no: i + 1, step_name: s.step_name.trim(), time_basis: s.time_basis || null,
        routing_step_id: s.routing_step_id || null, process_type_id: s.process_type_id || null,
        preferred_machine_id: s.preferred_machine_id || null, preferred_die_id: s.preferred_die_id || null,
        notes: s.notes.trim() || null };
      for (const [f] of STEP_NUM)   out[f] = s[f] === '' ? null : s[f];
      for (const [f] of STEP_FLAGS) out[f] = Boolean(s[f]);
      return out;
    });
    const { data, error } = await api.post('/api/v1/sku-planning/master', {
      item_id: itemId, routing_id: routingId || null, routing_type_id: routingTypeId || null,
      ...headerNums, preferred_machine_id: preferredMachineId || null, preferred_die_id: preferredDieId || null,
      notes: notes.trim() || null, steps: payloadSteps,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ item: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ steps: error.message });
      else addToast(error.message ?? 'Failed to create plan.');
    } else {
      addToast('SKU plan created.');
      router.push(`/masters/sku-planning/${data.id}`);
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1040, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/sku-planning')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← SKU Planning</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New SKU Plan</h1>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Item *</label>
            <ItemSearchSelect valueLabel={itemLabel} onPick={pickItem} error={errors.item} />
            {errors.item && <span style={errStyle}>{errors.item}</span>}
            {bpWeight != null && <span style={{ fontSize: 11, color: '#6B7280' }}>BP weight (from item): {bpWeight} g</span>}
          </div>
          <div>
            <label style={labelStyle}>Routing (active)</label>
            <select value={routingId} onChange={e => pickRouting(e.target.value)} disabled={!itemId}
              style={{ ...inputStyle(), background: '#fff', cursor: itemId ? 'pointer' : 'not-allowed' }}>
              <option value="">{itemId ? 'Select routing…' : 'Pick an item first'}</option>
              {routings.map(r => <option key={r.id} value={r.id}>v{r.version_number} · {r.routing_type?.type_name ?? 'routing'}</option>)}
            </select>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>Selecting a routing seeds its steps.</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          {HEADER_NUM.map(([f, label]) => (
            <div key={f}>
              <label style={labelStyle}>{label}</label>
              <input value={header[f]} onChange={e => setHeader(h => ({ ...h, [f]: e.target.value }))} type="number" step="any" style={cell} />
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Preferred machine</label>
            <select value={preferredMachineId} onChange={e => setPreferredMachineId(e.target.value)} style={{ ...cell, height: 38, background: '#fff', cursor: 'pointer' }}>
              <option value="">None</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Preferred die</label>
            <select value={preferredDieId} onChange={e => setPreferredDieId(e.target.value)} style={{ ...cell, height: 38, background: '#fff', cursor: 'pointer' }}>
              <option value="">None</option>
              {dies.map(d => <option key={d.id} value={d.id}>{d.die_code} — {d.die_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...cell, height: 38 }} />
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Steps</span>
          <button onClick={addStep} style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add step</button>
        </div>
        {errors.steps && <div style={{ ...errStyle, marginBottom: 8 }}>{errors.steps}</div>}

        {steps.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>No steps. Pick a routing to seed, or add manually.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {steps.map((s, idx) => (
              <div key={s.key} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, background: '#FCFCFD' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4F46E5' }}>Step {idx + 1}{s.routing_step_id ? ' · from routing' : ''}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↑</button>
                    <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↓</button>
                    <button onClick={() => removeStep(s.key)} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label style={labelStyle}>Step name *</label><input value={s.step_name} onChange={e => setStep(s.key, { step_name: e.target.value })} style={cell} /></div>
                  <div><label style={labelStyle}>Process</label>
                    <select value={s.process_type_id} onChange={e => setStep(s.key, { process_type_id: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                      <option value="">—</option>{processTypes.map(p => <option key={p.id} value={p.id}>{p.type_name}</option>)}
                    </select>
                  </div>
                  <div><label style={labelStyle}>Time basis</label>
                    <select value={s.time_basis} onChange={e => setStep(s.key, { time_basis: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                      <option value="">—</option>{TIME_BASES.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginBottom: 10 }}>
                  {STEP_NUM.map(([f, label]) => (
                    <div key={f}><label style={labelStyle}>{label}</label><input value={s[f]} onChange={e => setStep(s.key, { [f]: e.target.value })} type="number" step="any" style={cell} /></div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label style={labelStyle}>Preferred machine</label>
                    <select value={s.preferred_machine_id} onChange={e => setStep(s.key, { preferred_machine_id: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                      <option value="">None</option>{machines.map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
                    </select>
                  </div>
                  <div><label style={labelStyle}>Preferred die</label>
                    <select value={s.preferred_die_id} onChange={e => setStep(s.key, { preferred_die_id: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                      <option value="">None</option>{dies.map(d => <option key={d.id} value={d.id}>{d.die_code} — {d.die_name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
                  {STEP_FLAGS.map(([f, label]) => (
                    <label key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                      <input type="checkbox" checked={s[f]} onChange={e => setStep(s.key, { [f]: e.target.checked })} style={{ width: 15, height: 15, cursor: 'pointer' }} />{label}
                    </label>
                  ))}
                </div>

                <div><label style={labelStyle}>Notes</label><input value={s.notes} onChange={e => setStep(s.key, { notes: e.target.value })} style={cell} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/masters/sku-planning')} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
          {saving ? 'Saving…' : 'Create Plan'}
        </button>
      </div>

    </div>
  );
}
