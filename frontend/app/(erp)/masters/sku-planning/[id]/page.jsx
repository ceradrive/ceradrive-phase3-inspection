'use client';

/**
 * CERADRIVE ERP — SKU Planning Master (edit)
 * Draft-only editing of header packaging/dimensions + preferred machine/die + step parameters.
 * Item & routing identity shown read-only in S1. bp_weight_g derived from item_master.
 * Step diff {add, update, remove} on PATCH. No lifecycle (S1).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }      from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

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
const STATUS_STYLE = {
  draft:      { border: '#F59E0B', color: '#B45309', bg: '#FFFBEB' },
  active:     { border: '#059669', color: '#059669', bg: '#ECFDF5' },
  superseded: { border: '#D1D5DB', color: '#6B7280', bg: '#F9FAFB' },
};

export default function SkuPlanDetailPage() {
  const router = useRouter();
  const params = useParams();
  const addToast = useToast();
  const id = params?.id;
  const stepKey = useRef(1);
  const originalIds = useRef([]);

  const [plan,    setPlan]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [header, setHeader] = useState(() => Object.fromEntries(HEADER_NUM.map(([f]) => [f, ''])));
  const [preferredMachineId, setPreferredMachineId] = useState('');
  const [preferredDieId,     setPreferredDieId]     = useState('');
  const [notes,  setNotes]  = useState('');
  const [steps,  setSteps]  = useState([]);
  const [processTypes, setProcessTypes] = useState([]);
  const [machines, setMachines] = useState([]);
  const [dies,     setDies]     = useState([]);
  const [errors, setErrors] = useState({});

  function hydrate(data) {
    setPlan(data);
    setHeader(Object.fromEntries(HEADER_NUM.map(([f]) => [f, data[f] ?? ''])));
    setPreferredMachineId(data.preferred_machine_id ?? '');
    setPreferredDieId(data.preferred_die_id ?? '');
    setNotes(data.notes ?? '');
    const ss = (data.steps ?? []).map(s => {
      const row = { key: stepKey.current++, id: s.id, seq_no: s.seq_no,
        routing_step_id: s.routing_step_id ?? '', process_type_id: s.process_type_id ?? '',
        process_label: s.process_type ? s.process_type.type_name : '',
        step_name: s.step_name ?? '', time_basis: s.time_basis ?? '',
        preferred_machine_id: s.preferred_machine_id ?? '', preferred_die_id: s.preferred_die_id ?? '',
        notes: s.notes ?? '' };
      for (const [f] of STEP_NUM)   row[f] = s[f] ?? '';
      for (const [f] of STEP_FLAGS) row[f] = Boolean(s[f]);
      return row;
    });
    setSteps(ss);
    originalIds.current = (data.steps ?? []).map(s => s.id);
  }

  useEffect(() => {
    if (!id) return;
    api.get(`/api/v1/sku-planning/master/${id}`).then(({ data, error }) => {
      if (error || !data) addToast('SKU plan not found.');
      else hydrate(data);
      setLoading(false);
    });
    api.get('/api/v1/sku-planning/process-types').then(({ data }) => setProcessTypes(data ?? []));
    api.get('/api/v1/sku-planning/machines').then(({ data }) => setMachines(data ?? []));
    api.get('/api/v1/sku-planning/dies').then(({ data }) => setDies(data ?? []));
  }, [id, addToast]);

  function emptyStep() {
    const base = { key: stepKey.current++, id: null, seq_no: null, routing_step_id: '', process_type_id: '', process_label: '', step_name: '', time_basis: '', preferred_machine_id: '', preferred_die_id: '', notes: '' };
    for (const [f] of STEP_NUM) base[f] = '';
    for (const [f] of STEP_FLAGS) base[f] = false;
    return base;
  }
  function setStep(key, patch) { setSteps(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); }
  function addStep()       { setSteps(prev => [...prev, emptyStep()]); }
  function removeStep(key) { setSteps(prev => prev.filter(s => s.key !== key)); }
  function moveStep(idx, dir) {
    setSteps(prev => { const n = [...prev]; const j = idx + dir; if (j < 0 || j >= n.length) return prev; [n[idx], n[j]] = [n[j], n[idx]]; return n; });
  }
  function handleCancel() { if (plan) hydrate(plan); setErrors({}); setEditing(false); }

  function validate() {
    const errs = {};
    for (const s of steps) if (!s.step_name.trim()) errs.steps = 'Every step needs a name.';
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const headerNums = Object.fromEntries(HEADER_NUM.map(([f]) => [f, header[f] === '' ? null : header[f]]));
    const stepFields = (s, seq) => {
      const out = { seq_no: seq, step_name: s.step_name.trim(), time_basis: s.time_basis || null,
        routing_step_id: s.routing_step_id || null, process_type_id: s.process_type_id || null,
        preferred_machine_id: s.preferred_machine_id || null, preferred_die_id: s.preferred_die_id || null,
        notes: s.notes.trim() || null };
      for (const [f] of STEP_NUM)   out[f] = s[f] === '' ? null : s[f];
      for (const [f] of STEP_FLAGS) out[f] = Boolean(s[f]);
      return out;
    };
    const ordered = steps.map((s, i) => ({ s, seq: i + 1 }));
    const add    = ordered.filter(x => !x.s.id).map(x => stepFields(x.s, x.seq));
    const update = ordered.filter(x => x.s.id).map(x => ({ id: x.s.id, ...stepFields(x.s, x.seq) }));
    const currentIds = steps.filter(s => s.id).map(s => s.id);
    const remove = originalIds.current.filter(oid => !currentIds.includes(oid));

    const { data, error } = await api.patch(`/api/v1/sku-planning/master/${id}`, {
      ...headerNums, preferred_machine_id: preferredMachineId || null, preferred_die_id: preferredDieId || null,
      notes: notes.trim() || null, steps: { add, update, remove },
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR') setErrors({ steps: error.message });
      else addToast(error.message ?? 'Failed to save.');
    } else { hydrate(data); setEditing(false); addToast('SKU plan updated.'); }
  }

  // ─── Lifecycle actions (S2b) — header owns lifecycle ──────────────────────────
  async function runAction(path, successMsg, { navigateToNew = false } = {}) {
    if (actionBusy) return;
    setActionBusy(true);
    const { data, error } = await api.post(`/api/v1/sku-planning/master/${id}/${path}`, {});
    setActionBusy(false);
    if (error) { addToast(error.message ?? 'Action failed.'); return; }
    addToast(successMsg);
    if (navigateToNew && data?.id) router.push(`/masters/sku-planning/${data.id}`);
    else if (data) hydrate(data);
  }
  const handleActivate   = () => runAction('activate',    'SKU plan activated.');
  const handleSupersede  = () => runAction('supersede',   'SKU plan superseded.');
  const handleNewVersion = () => runAction('new-version', 'New version created.', { navigateToNew: true });

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!plan) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>SKU plan not found.</div>;

  const st = STATUS_STYLE[plan.status] ?? STATUS_STYLE.draft;
  const isDraft = plan.status === 'draft';
  const roVal = (v) => <div style={{ fontSize: 14, color: v != null && v !== '' ? '#374151' : '#9CA3AF', padding: '6px 0', minHeight: 20 }}>{v != null && v !== '' ? v : '—'}</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1040, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 20 }}>
        <button onClick={() => router.push('/masters/sku-planning')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← SKU Planning</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
            {plan.item ? <><span style={{ fontFamily: 'monospace' }}>{plan.item.item_code}</span> <span style={{ color: '#6B7280', fontSize: 16 }}>{plan.item.item_name}</span></> : 'SKU Plan'}
          </h1>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: `1px solid ${st.border}`, color: st.color, background: st.bg, textTransform: 'capitalize' }}>{plan.status}</span>
        </div>
        {!isDraft && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 12, color: '#6B7280' }}>This plan is {plan.status} and read-only.</div>}
        {plan.routing_stale && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, border: '1px solid #FCD34D', background: '#FFFBEB', fontSize: 12, color: '#B45309' }}>
            ⚠ The routing linked to this plan has been superseded. This is a warning only — the plan stays usable. Create a new version to adopt the latest routing.
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div><label style={labelStyle}>Item</label>{roVal(plan.item ? `${plan.item.item_code} — ${plan.item.item_name}` : '')}</div>
          <div><label style={labelStyle}>Routing</label>{roVal(plan.routing ? `v${plan.routing.version_number} (${plan.routing.status})` : '')}</div>
          <div><label style={labelStyle}>Routing type</label>{roVal(plan.routing_type?.type_name)}</div>
        </div>
        <div style={{ marginBottom: 16 }}><label style={labelStyle}>BP weight (derived from item)</label>{roVal(plan.bp_weight_g != null ? `${plan.bp_weight_g} g` : '')}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          {HEADER_NUM.map(([f, label]) => (
            <div key={f}>
              <label style={labelStyle}>{label}</label>
              {editing ? <input value={header[f]} onChange={e => setHeader(h => ({ ...h, [f]: e.target.value }))} type="number" step="any" style={cell} /> : roVal(plan[f])}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
          <div><label style={labelStyle}>Preferred machine</label>
            {editing ? (
              <select value={preferredMachineId} onChange={e => setPreferredMachineId(e.target.value)} style={{ ...cell, height: 38, background: '#fff', cursor: 'pointer' }}>
                <option value="">None</option>{machines.map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
              </select>
            ) : roVal(machines.find(m => m.id === plan.preferred_machine_id)?.machine_name)}
          </div>
          <div><label style={labelStyle}>Preferred die</label>
            {editing ? (
              <select value={preferredDieId} onChange={e => setPreferredDieId(e.target.value)} style={{ ...cell, height: 38, background: '#fff', cursor: 'pointer' }}>
                <option value="">None</option>{dies.map(d => <option key={d.id} value={d.id}>{d.die_code} — {d.die_name}</option>)}
              </select>
            ) : roVal(dies.find(d => d.id === plan.preferred_die_id)?.die_name)}
          </div>
          <div><label style={labelStyle}>Notes</label>{editing ? <input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...cell, height: 38 }} /> : roVal(plan.notes)}</div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Steps</span>
          {editing && <button onClick={addStep} style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add step</button>}
        </div>
        {errors.steps && <div style={{ ...errStyle, marginBottom: 8 }}>{errors.steps}</div>}

        {steps.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>No steps.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {steps.map((s, idx) => (
              <div key={s.key} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, background: '#FCFCFD' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4F46E5' }}>Step {idx + 1}{s.routing_step_id ? ' · from routing' : ''}</span>
                  {editing && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↑</button>
                      <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↓</button>
                      <button onClick={() => removeStep(s.key)} style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label style={labelStyle}>Step name *</label>{editing ? <input value={s.step_name} onChange={e => setStep(s.key, { step_name: e.target.value })} style={cell} /> : roVal(s.step_name)}</div>
                  <div><label style={labelStyle}>Process</label>
                    {editing ? (
                      <select value={s.process_type_id} onChange={e => setStep(s.key, { process_type_id: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                        <option value="">—</option>{processTypes.map(p => <option key={p.id} value={p.id}>{p.type_name}</option>)}
                      </select>
                    ) : roVal(s.process_label)}
                  </div>
                  <div><label style={labelStyle}>Time basis</label>
                    {editing ? (
                      <select value={s.time_basis} onChange={e => setStep(s.key, { time_basis: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                        <option value="">—</option>{TIME_BASES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : roVal(s.time_basis)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginBottom: 10 }}>
                  {STEP_NUM.map(([f, label]) => (
                    <div key={f}><label style={labelStyle}>{label}</label>{editing ? <input value={s[f]} onChange={e => setStep(s.key, { [f]: e.target.value })} type="number" step="any" style={cell} /> : roVal(s[f])}</div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label style={labelStyle}>Preferred machine</label>
                    {editing ? (
                      <select value={s.preferred_machine_id} onChange={e => setStep(s.key, { preferred_machine_id: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                        <option value="">None</option>{machines.map(m => <option key={m.id} value={m.id}>{m.machine_code} — {m.machine_name}</option>)}
                      </select>
                    ) : roVal(machines.find(m => m.id === s.preferred_machine_id)?.machine_name)}
                  </div>
                  <div><label style={labelStyle}>Preferred die</label>
                    {editing ? (
                      <select value={s.preferred_die_id} onChange={e => setStep(s.key, { preferred_die_id: e.target.value })} style={{ ...cell, background: '#fff', cursor: 'pointer' }}>
                        <option value="">None</option>{dies.map(d => <option key={d.id} value={d.id}>{d.die_code} — {d.die_name}</option>)}
                      </select>
                    ) : roVal(dies.find(d => d.id === s.preferred_die_id)?.die_name)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
                  {STEP_FLAGS.map(([f, label]) => (
                    <label key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: editing ? 'pointer' : 'default' }}>
                      <input type="checkbox" disabled={!editing} checked={s[f]} onChange={e => setStep(s.key, { [f]: e.target.checked })} style={{ width: 15, height: 15, cursor: editing ? 'pointer' : 'default' }} />{label}
                    </label>
                  ))}
                </div>

                <div><label style={labelStyle}>Notes</label>{editing ? <input value={s.notes} onChange={e => setStep(s.key, { notes: e.target.value })} style={cell} /> : roVal(s.notes)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {isDraft && <button onClick={() => setEditing(true)} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, color: '#fff', cursor: 'pointer', fontWeight: 500 }}>Edit</button>}
          {isDraft && <button onClick={handleActivate} disabled={actionBusy} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: actionBusy ? '#6EE7B7' : '#059669', fontSize: 13, color: '#fff', cursor: actionBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>{actionBusy ? 'Working…' : 'Activate'}</button>}
          {plan.status === 'active' && <button onClick={handleNewVersion} disabled={actionBusy} style={{ height: 36, padding: '0 18px', border: '1px solid #C7D2FE', borderRadius: 6, background: '#EEF2FF', fontSize: 13, color: '#4F46E5', cursor: actionBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>New version</button>}
          {plan.status === 'active' && <button onClick={handleSupersede} disabled={actionBusy} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#6B7280', cursor: actionBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>{actionBusy ? 'Working…' : 'Supersede'}</button>}
          {plan.status === 'superseded' && <button onClick={handleNewVersion} disabled={actionBusy} style={{ height: 36, padding: '0 18px', border: '1px solid #C7D2FE', borderRadius: 6, background: '#EEF2FF', fontSize: 13, color: '#4F46E5', cursor: actionBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>New version</button>}
        </div>
      )}

    </div>
  );
}
