'use client';

/**
 * CERADRIVE ERP — Routing Template Master (create)
 * Header (code/name/description) + step grid (process, seq, authored step_name,
 * mandatory, default-enabled, notes, reorder). New template is active by default.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter }                   from 'next/navigation';
import { api }                         from '../../../../../lib/api.js';
import { useToast }                    from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const cellInput  = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

export default function NewRoutingTemplatePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const stepKey = useRef(1);

  function emptyStep() {
    return { key: stepKey.current++, step_name: '', process_type_id: '', is_mandatory: true, default_enabled: true, notes: '' };
  }

  const [code,        setCode]        = useState('');
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [steps,       setSteps]       = useState([emptyStep()]);
  const [processTypes, setProcessTypes] = useState([]);
  const [errors,      setErrors]      = useState({});
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    api.get('/api/v1/routing-templates/process-types').then(({ data }) => setProcessTypes(data ?? []));
  }, []);

  function setStep(key, patch) { setSteps(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); }
  function addStep()        { setSteps(prev => [...prev, emptyStep()]); }
  function removeStep(key)  { setSteps(prev => prev.filter(s => s.key !== key)); }
  function moveStep(idx, dir) {
    setSteps(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function isFilled(s) { return s.step_name.trim() !== '' || s.process_type_id !== ''; }

  function validate() {
    const errs = {};
    if (!code.trim()) errs.code = 'Template code is required.';
    if (!name.trim()) errs.name = 'Template name is required.';
    const filled = steps.filter(isFilled);
    if (filled.length === 0) errs.steps = 'A template needs at least one step.';
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
    const payloadSteps = filled.map((s, i) => ({
      seq_no:          i + 1,
      step_name:       s.step_name.trim(),
      process_type_id: s.process_type_id,
      is_mandatory:    Boolean(s.is_mandatory),
      default_enabled: Boolean(s.default_enabled),
      notes:           s.notes.trim() || null,
    }));
    const { data, error } = await api.post('/api/v1/routing-templates/master', {
      template_code: code.trim().toUpperCase(),
      template_name: name.trim(),
      description:   description.trim() || null,
      steps:         payloadSteps,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ code: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ steps: error.message });
      else showToast(error.message ?? 'Failed to create template.', 'error');
    } else {
      showToast('Routing template created.', 'success');
      router.push(`/masters/routing-templates/${data.id}`);
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/routing-templates')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Routing Templates</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Routing Template</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>A reusable process flow. Steps can be marked optional and default-enabled for routing creation.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Template Code *</label>
            <input value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, code: undefined })); }}
              placeholder="e.g. MOULDING-LINE" style={{ ...inputStyle(errors.code), fontFamily: 'monospace' }} />
            {errors.code && <span style={errStyle}>{errors.code}</span>}
          </div>
          <div>
            <label style={labelStyle}>Template Name *</label>
            <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: undefined })); }}
              placeholder="e.g. Moulding Line" style={inputStyle(errors.name)} />
            {errors.name && <span style={errStyle}>{errors.name}</span>}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" style={inputStyle()} />
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Steps</span>
          <button onClick={addStep}
            style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add step</button>
        </div>
        {errors.steps && <div style={{ ...errStyle, marginBottom: 8 }}>{errors.steps}</div>}

        {steps.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>No steps.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {steps.map((s, idx) => (
              <div key={s.key} style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, background: '#FCFCFD' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4F46E5' }}>Step {idx + 1}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} title="Move up"
                      style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↑</button>
                    <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} title="Move down"
                      style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↓</button>
                    <button onClick={() => removeStep(s.key)} title="Remove step"
                      style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Step name *</label>
                    <input value={s.step_name} onChange={e => setStep(s.key, { step_name: e.target.value })} placeholder="e.g. Moulding" style={cellInput} />
                  </div>
                  <div>
                    <label style={labelStyle}>Process type *</label>
                    <select value={s.process_type_id} onChange={e => setStep(s.key, { process_type_id: e.target.value })} style={{ ...cellInput, background: '#fff', cursor: 'pointer' }}>
                      <option value="">Select process…</option>
                      {processTypes.map(p => <option key={p.id} value={p.id}>{p.type_name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.is_mandatory} onChange={e => setStep(s.key, { is_mandatory: e.target.checked })} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    Mandatory
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.default_enabled} onChange={e => setStep(s.key, { default_enabled: e.target.checked })} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    Default enabled
                  </label>
                </div>

                <div>
                  <label style={labelStyle}>Notes</label>
                  <input value={s.notes} onChange={e => setStep(s.key, { notes: e.target.value })} style={cellInput} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/masters/routing-templates')}
          style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving}
          style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
          {saving ? 'Saving…' : 'Create Template'}
        </button>
      </div>

    </div>
  );
}
