'use client';

/**
 * CERADRIVE ERP — Process Flow Detail / Edit (Routing draft CRUD)
 * Edit header (item, routing type, effective date, notes) and steps (add/update/remove).
 * status + version are display-only here (lifecycle deferred). Backend enforces draft-only edits.
 * Step card layout mirrors the create screen; all other patterns mirror the BOM detail screen.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams }        from 'next/navigation';
import { api }                         from '../../../../../lib/api.js';
import { useToast }                    from '../../../../../components/ui/Toast.jsx';

const STATUS_LABELS = { draft: 'Draft', active: 'Active', superseded: 'Superseded' };
const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

const STEP_FLAGS = [
  { key: 'wip_produced',     label: 'Produces WIP' },
  { key: 'is_wo_driven',     label: 'Work-order driven' },
  { key: 'qc_required',      label: 'QC required' },
  { key: 'machine_required', label: 'Machine required' },
  { key: 'die_required',     label: 'Die required' },
  { key: 'labour_required',  label: 'Labour required' },
];

function ItemSearchSelect({ valueId, valueLabel, onPick, placeholder, error, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/routings/items', { search: q, limit: 20 });
      if (!cancelled) { setResults(data ?? []); setLoading(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (disabled) {
    return <div style={{ ...inputStyle(false), background: '#F9FAFB', display: 'flex', alignItems: 'center', color: '#374151' }}>{valueLabel || '—'}</div>;
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ ...inputStyle(error), display: 'flex', alignItems: 'center', cursor: 'pointer', justifyContent: 'space-between' }}>
        <span style={{ color: valueLabel ? '#111827' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {valueLabel || placeholder || 'Select item…'}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: 42, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          {loading ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No items found.</div>
          ) : results.map(it => (
            <div key={it.id} onClick={() => { onPick(it); setOpen(false); setQ(''); }}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6', background: it.id === valueId ? '#EEF2FF' : '#fff' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#111827', fontWeight: 600 }}>{it.item_code}</span>
              <span style={{ color: '#6B7280', marginLeft: 8 }}>{it.item_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RoutingDetailPage() {
  const router = useRouter();
  const params = useParams();
  const addToast = useToast();
  const id = params.id;
  const stepKey = useRef(1);

  const [routing, setRouting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [types,        setTypes]        = useState([]);
  const [processTypes, setProcessTypes] = useState([]);
  const [errors,  setErrors]  = useState({});

  const [itemId,        setItemId]        = useState('');
  const [itemLabel,     setItemLabel]     = useState('');
  const [routingTypeId, setRoutingTypeId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes,         setNotes]         = useState('');
  const [steps,         setSteps]         = useState([]);
  const originalIds = useRef([]);

  function hydrate(data) {
    setRouting(data);
    setItemId(data.item_id ?? '');
    setItemLabel(data.item ? `${data.item.item_code} — ${data.item.item_name}` : '');
    setRoutingTypeId(data.routing_type_id ?? '');
    setEffectiveDate(data.effective_date ?? '');
    setNotes(data.notes ?? '');
    const ss = (data.steps ?? []).map(s => ({
      key: stepKey.current++, id: s.id, seq_no: s.seq_no,
      step_name:        s.step_name ?? '',
      process_type_id:  s.process_type_id ?? '',
      process_label:    s.process_type ? s.process_type.type_name : '',
      input_item_id:    s.input_item_id ?? '',
      input_label:      s.input_item  ? `${s.input_item.item_code} — ${s.input_item.item_name}`   : '',
      output_item_id:   s.output_item_id ?? '',
      output_label:     s.output_item ? `${s.output_item.item_code} — ${s.output_item.item_name}` : '',
      wip_produced:     Boolean(s.wip_produced),
      is_wo_driven:     Boolean(s.is_wo_driven),
      qc_required:      Boolean(s.qc_required),
      machine_required: Boolean(s.machine_required),
      die_required:     Boolean(s.die_required),
      labour_required:  Boolean(s.labour_required),
      notes:            s.notes ?? '',
    }));
    setSteps(ss);
    originalIds.current = (data.steps ?? []).map(s => s.id);
  }

  useEffect(() => {
    api.get(`/api/v1/routings/master/${id}`).then(({ data, error }) => {
      if (error || !data) addToast('Process flow not found.');
      else hydrate(data);
      setLoading(false);
    });
    api.get('/api/v1/routings/types').then(({ data }) => setTypes(data ?? []));
    api.get('/api/v1/routings/process-types').then(({ data }) => setProcessTypes(data ?? []));
  }, [id, addToast]);

  function emptyStep() {
    return {
      key: stepKey.current++, id: null, seq_no: null, step_name: '',
      process_type_id: '', process_label: '',
      input_item_id: '', input_label: '', output_item_id: '', output_label: '',
      wip_produced: true, is_wo_driven: false, qc_required: false,
      machine_required: false, die_required: false, labour_required: false,
      notes: '',
    };
  }
  function setStep(key, patch) { setSteps(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); }
  function addStep()       { setSteps(prev => [...prev, emptyStep()]); }
  function removeStep(key) { setSteps(prev => prev.filter(s => s.key !== key)); }

  function handleCancel() { if (routing) hydrate(routing); setErrors({}); setEditing(false); }

  function isFilled(s) { return s.step_name.trim() !== '' || s.process_type_id !== ''; }

  function validate() {
    const errs = {};
    if (!itemId)        errs.item = 'Item is required.';
    if (!routingTypeId) errs.routing_type = 'Routing type is required.';
    const filled = steps.filter(isFilled);
    if (filled.length === 0) errs.steps = 'A process flow needs at least one step.';
    for (const s of filled) {
      if (!s.step_name.trim()) errs.steps = 'Every step needs a name.';
      if (!s.process_type_id)  errs.steps = 'Every step needs a process type.';
    }
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);

    const filled = steps.filter(isFilled);
    const stepFields = (s) => ({
      step_name:        s.step_name.trim(),
      process_type_id:  s.process_type_id,
      input_item_id:    s.input_item_id  || null,
      output_item_id:   s.output_item_id || null,
      wip_produced:     Boolean(s.wip_produced),
      is_wo_driven:     Boolean(s.is_wo_driven),
      qc_required:      Boolean(s.qc_required),
      machine_required: Boolean(s.machine_required),
      die_required:     Boolean(s.die_required),
      labour_required:  Boolean(s.labour_required),
      notes:            s.notes.trim() || null,
    });
    const add    = filled.filter(s => !s.id).map(s => stepFields(s));
    const update = filled.filter(s => s.id).map(s => ({ id: s.id, seq_no: s.seq_no, ...stepFields(s) }));
    const currentIds = filled.filter(s => s.id).map(s => s.id);
    const remove = originalIds.current.filter(oid => !currentIds.includes(oid));

    const { data, error } = await api.patch(`/api/v1/routings/master/${id}`, {
      item_id: itemId, routing_type_id: routingTypeId, effective_date: effectiveDate || null, notes: notes.trim() || null,
      steps: { add, update, remove },
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('routing type')) setErrors({ routing_type: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ steps: error.message });
      else addToast(error.message ?? 'Failed to save.');
    } else {
      hydrate(data);
      setEditing(false);
      addToast('Process flow updated.');
    }
  }

  async function handleActivate() {
    setLifecycleBusy(true);
    const { data, error } = await api.post(`/api/v1/routings/master/${id}/activate`, {});
    setLifecycleBusy(false);
    if (error) { addToast(error.message ?? 'Failed to activate.'); return; }
    hydrate(data);
    addToast('Routing activated.');
  }

  async function handleSupersede() {
    if (typeof window !== 'undefined' && !window.confirm('Supersede (retire) this active routing? This cannot be undone.')) return;
    setLifecycleBusy(true);
    const { data, error } = await api.post(`/api/v1/routings/master/${id}/supersede`, {});
    setLifecycleBusy(false);
    if (error) { addToast(error.message ?? 'Failed to supersede.'); return; }
    hydrate(data);
    addToast('Routing superseded.');
  }

  async function handleNewVersion() {
    setLifecycleBusy(true);
    const { data, error } = await api.post(`/api/v1/routings/master/${id}/new-version`, {});
    setLifecycleBusy(false);
    if (error) { addToast(error.message ?? 'Failed to create new version.'); return; }
    addToast('New draft version created.');
    router.push(`/masters/routings/${data.id}`);
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!routing) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Process flow not found.</div>;

  const roVal = (v) => <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0', minHeight: 22 }}>{v || '—'}</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/routings')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Process Flow
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
            {routing.item ? routing.item.item_code : 'Process Flow'} <span style={{ color: '#9CA3AF', fontFamily: 'monospace', fontSize: 15 }}>v{routing.version_number}</span>
          </h1>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: '1px solid #F59E0B', color: '#B45309', background: '#FFFBEB' }}>
            {STATUS_LABELS[routing.status] ?? routing.status}
          </span>
        </div>
        {routing.status === 'superseded' && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 12, color: '#6B7280' }}>
            This routing is superseded and read-only.{routing.superseded_by ? ' It was replaced by a newer version.' : ''} Use “New Version” to create an editable copy.
          </div>
        )}
      </div>

      {/* Header card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Item</label>
            {editing
              ? <ItemSearchSelect valueId={itemId} valueLabel={itemLabel} error={errors.item}
                  onPick={it => { setItemId(it.id); setItemLabel(`${it.item_code} — ${it.item_name}`); setErrors(p => ({ ...p, item: undefined })); }} />
              : roVal(itemLabel)}
            {errors.item && <span style={errStyle}>{errors.item}</span>}
          </div>
          <div>
            <label style={labelStyle}>Routing Type</label>
            {editing
              ? <select value={routingTypeId} onChange={e => { setRoutingTypeId(e.target.value); setErrors(p => ({ ...p, routing_type: undefined })); }}
                  style={{ ...inputStyle(errors.routing_type), background: '#fff', cursor: 'pointer' }}>
                  <option value="">Select routing type…</option>
                  {types.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
                </select>
              : roVal(routing.routing_type?.type_name)}
            {errors.routing_type && <span style={errStyle}>{errors.routing_type}</span>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Effective date</label>
            {editing ? <input value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} type="date" style={inputStyle()} /> : roVal(routing.effective_date)}
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            {editing ? <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle()} /> : roVal(routing.notes)}
          </div>
        </div>
      </div>

      {/* Steps card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Steps</span>
          {editing && (
            <button onClick={addStep}
              style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              + Add step
            </button>
          )}
        </div>
        {errors.steps && <div style={{ ...errStyle, marginBottom: 8 }}>{errors.steps}</div>}

        {steps.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>No steps.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {steps.map((s, idx) => (
              <div key={s.key} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, background: '#FCFCFD' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4F46E5' }}>Step {idx + 1}</span>
                  {editing && (
                    <button onClick={() => removeStep(s.key)} title="Remove step"
                      style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Step name</label>
                    {editing ? <input value={s.step_name} onChange={e => setStep(s.key, { step_name: e.target.value })} placeholder="e.g. Moulding" style={inputStyle()} /> : roVal(s.step_name)}
                  </div>
                  <div>
                    <label style={labelStyle}>Process</label>
                    {editing
                      ? <select value={s.process_type_id} onChange={e => setStep(s.key, { process_type_id: e.target.value })} style={{ ...inputStyle(), background: '#fff', cursor: 'pointer' }}>
                          <option value="">Select process…</option>
                          {processTypes.map(p => <option key={p.id} value={p.id}>{p.type_name}</option>)}
                        </select>
                      : roVal(s.process_label)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Input item</label>
                    <ItemSearchSelect disabled={!editing} valueId={s.input_item_id} valueLabel={s.input_label} placeholder="Optional…"
                      onPick={it => setStep(s.key, { input_item_id: it.id, input_label: `${it.item_code} — ${it.item_name}` })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Output item</label>
                    <ItemSearchSelect disabled={!editing} valueId={s.output_item_id} valueLabel={s.output_label} placeholder="Optional…"
                      onPick={it => setStep(s.key, { output_item_id: it.id, output_label: `${it.item_code} — ${it.item_name}` })} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  {STEP_FLAGS.map(f => (
                    <label key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, color: '#374151', cursor: editing ? 'pointer' : 'default', background: s[f.key] ? '#EEF2FF' : '#fff' }}>
                      <input type="checkbox" disabled={!editing} checked={s[f.key]} onChange={e => setStep(s.key, { [f.key]: e.target.checked })} style={{ width: 18, height: 18, cursor: editing ? 'pointer' : 'default' }} />
                      {f.label}
                    </label>
                  ))}
                </div>

                <div>
                  <label style={labelStyle}>Notes</label>
                  {editing ? <input value={s.notes} onChange={e => setStep(s.key, { notes: e.target.value })} style={inputStyle()} /> : roVal(s.notes)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {editing ? (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {routing.status === 'draft' && (
            <>
              <button onClick={() => setEditing(true)}
                style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Edit</button>
              <button onClick={handleActivate} disabled={lifecycleBusy}
                style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: lifecycleBusy ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: lifecycleBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {lifecycleBusy ? 'Working…' : 'Activate'}
              </button>
            </>
          )}
          {routing.status === 'active' && (
            <>
              <button onClick={handleSupersede} disabled={lifecycleBusy}
                style={{ height: 36, padding: '0 18px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', fontSize: 13, color: '#DC2626', cursor: lifecycleBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {lifecycleBusy ? 'Working…' : 'Supersede'}
              </button>
              <button onClick={handleNewVersion} disabled={lifecycleBusy}
                style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: lifecycleBusy ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: lifecycleBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {lifecycleBusy ? 'Working…' : 'New Version'}
              </button>
            </>
          )}
          {routing.status === 'superseded' && (
            <button onClick={handleNewVersion} disabled={lifecycleBusy}
              style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: lifecycleBusy ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
              {lifecycleBusy ? 'Working…' : 'New Version'}
            </button>
          )}
        </div>
      )}

    </div>
  );
}
