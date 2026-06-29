'use client';

/**
 * CERADRIVE ERP — Routing Template Master (edit)
 * Edit header + steps (add/update/remove/reorder), Copy to new template, Activate/Inactivate.
 * template_code is read-only after creation.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams }        from 'next/navigation';
import { api }                         from '../../../../../lib/api.js';
import { useToast }                    from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const cellInput  = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

export default function RoutingTemplateDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const id = params?.id;
  const stepKey   = useRef(1);
  const originalIds = useRef([]);

  const [template, setTemplate] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copying,  setCopying]  = useState(false);

  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [steps,       setSteps]       = useState([]);
  const [processTypes, setProcessTypes] = useState([]);
  const [errors,      setErrors]      = useState({});

  function hydrate(data) {
    setTemplate(data);
    setName(data.template_name ?? '');
    setDescription(data.description ?? '');
    const ss = (data.steps ?? []).map(s => ({
      key: stepKey.current++, id: s.id, seq_no: s.seq_no,
      step_name:       s.step_name ?? '',
      process_type_id: s.process_type_id ?? '',
      process_label:   s.process_type ? s.process_type.type_name : '',
      is_mandatory:    Boolean(s.is_mandatory),
      default_enabled: Boolean(s.default_enabled),
      is_active:       s.is_active !== undefined ? Boolean(s.is_active) : true,
      notes:           s.notes ?? '',
    }));
    setSteps(ss);
    originalIds.current = (data.steps ?? []).map(s => s.id);
  }

  useEffect(() => {
    if (!id) return;
    api.get(`/api/v1/routing-templates/master/${id}`).then(({ data, error }) => {
      if (error || !data) showToast('Routing template not found.', 'error');
      else hydrate(data);
      setLoading(false);
    });
    api.get('/api/v1/routing-templates/process-types').then(({ data }) => setProcessTypes(data ?? []));
  }, [id, showToast]);

  function emptyStep() {
    return { key: stepKey.current++, id: null, seq_no: null, step_name: '', process_type_id: '', process_label: '', is_mandatory: true, default_enabled: true, is_active: true, notes: '' };
  }
  function setStep(key, patch) { setSteps(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); }
  function addStep()       { setSteps(prev => [...prev, emptyStep()]); }
  function removeStep(key) { setSteps(prev => prev.filter(s => s.key !== key)); }
  function moveStep(idx, dir) {
    setSteps(prev => {
      const next = [...prev]; const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function handleCancel() { if (template) hydrate(template); setErrors({}); setEditing(false); }

  function isFilled(s) { return s.step_name.trim() !== '' || s.process_type_id !== ''; }

  function validate() {
    const errs = {};
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
    const stepFields = (s, seq) => ({
      seq_no:          seq,
      step_name:       s.step_name.trim(),
      process_type_id: s.process_type_id,
      is_mandatory:    Boolean(s.is_mandatory),
      default_enabled: Boolean(s.default_enabled),
      is_active:       Boolean(s.is_active),
      notes:           s.notes.trim() || null,
    });
    const add    = filled.map((s, i) => ({ s, seq: i + 1 })).filter(x => !x.s.id).map(x => stepFields(x.s, x.seq));
    const update = filled.map((s, i) => ({ s, seq: i + 1 })).filter(x => x.s.id).map(x => ({ id: x.s.id, ...stepFields(x.s, x.seq) }));
    const currentIds = filled.filter(s => s.id).map(s => s.id);
    const remove = originalIds.current.filter(oid => !currentIds.includes(oid));

    const { data, error } = await api.patch(`/api/v1/routing-templates/master/${id}`, {
      template_name: name.trim(),
      description:   description.trim() || null,
      steps:         { add, update, remove },
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR') setErrors({ steps: error.message });
      else showToast(error.message ?? 'Failed to save.', 'error');
    } else {
      hydrate(data);
      setEditing(false);
      showToast('Routing template updated.', 'success');
    }
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/routing-templates/master/${id}/toggle-active`, { is_active: !template.is_active });
    setToggling(false);
    if (error) { showToast(error.message ?? 'Failed to update status.', 'error'); return; }
    hydrate(data);
    showToast(`Template ${data.is_active ? 'activated' : 'inactivated'}.`, 'success');
  }

  async function handleCopy() {
    if (typeof window === 'undefined') return;
    const newCode = window.prompt('New template code for the copy:');
    if (!newCode || !newCode.trim()) return;
    const newName = window.prompt('New template name for the copy:', `${template.template_name} (copy)`);
    if (!newName || !newName.trim()) return;
    setCopying(true);
    const { data, error } = await api.post(`/api/v1/routing-templates/master/${id}/copy`, {
      template_code: newCode.trim().toUpperCase(),
      template_name: newName.trim(),
    });
    setCopying(false);
    if (error) { showToast(error.message ?? 'Failed to copy template.', 'error'); return; }
    showToast('Template copied.', 'success');
    router.push(`/masters/routing-templates/${data.id}`);
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!template) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Routing template not found.</div>;

  const roVal = (v) => <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0', minHeight: 22 }}>{v || '—'}</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/routing-templates')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Routing Templates</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{template.template_code}</h1>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
            border: `1px solid ${template.is_active ? '#059669' : '#D1D5DB'}`, color: template.is_active ? '#059669' : '#6B7280', background: template.is_active ? '#ECFDF5' : '#F9FAFB' }}>
            {template.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Template Code</label>
            <div style={{ ...roVal(template.template_code), fontFamily: 'monospace' }}>{template.template_code}</div>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>Code cannot be changed after creation.</span>
          </div>
          <div>
            <label style={labelStyle}>Template Name *</label>
            {editing
              ? <><input value={name} onChange={e => setName(e.target.value)} style={inputStyle(errors.name)} />{errors.name && <span style={errStyle}>{errors.name}</span>}</>
              : roVal(template.template_name)}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          {editing ? <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle()} /> : roVal(template.description)}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Steps</span>
          {editing && (
            <button onClick={addStep}
              style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Add step</button>
          )}
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
                  {editing && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} title="Move up"
                        style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↑</button>
                      <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} title="Move down"
                        style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #D1D5DB', background: '#fff', cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', color: '#6B7280' }}>↓</button>
                      <button onClick={() => removeStep(s.key)} title="Remove step"
                        style={{ width: 28, height: 28, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Step name *</label>
                    {editing ? <input value={s.step_name} onChange={e => setStep(s.key, { step_name: e.target.value })} style={cellInput} /> : roVal(s.step_name)}
                  </div>
                  <div>
                    <label style={labelStyle}>Process type *</label>
                    {editing
                      ? <select value={s.process_type_id} onChange={e => setStep(s.key, { process_type_id: e.target.value })} style={{ ...cellInput, background: '#fff', cursor: 'pointer' }}>
                          <option value="">Select process…</option>
                          {processTypes.map(p => <option key={p.id} value={p.id}>{p.type_name}</option>)}
                        </select>
                      : roVal(s.process_label)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: editing ? 'pointer' : 'default' }}>
                    <input type="checkbox" disabled={!editing} checked={s.is_mandatory} onChange={e => setStep(s.key, { is_mandatory: e.target.checked })} style={{ width: 16, height: 16, cursor: editing ? 'pointer' : 'default' }} />
                    Mandatory
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: editing ? 'pointer' : 'default' }}>
                    <input type="checkbox" disabled={!editing} checked={s.default_enabled} onChange={e => setStep(s.key, { default_enabled: e.target.checked })} style={{ width: 16, height: 16, cursor: editing ? 'pointer' : 'default' }} />
                    Default enabled
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: s.is_active ? '#374151' : '#DC2626', cursor: editing ? 'pointer' : 'default' }}>
                    <input type="checkbox" disabled={!editing} checked={s.is_active} onChange={e => setStep(s.key, { is_active: e.target.checked })} style={{ width: 16, height: 16, cursor: editing ? 'pointer' : 'default' }} />
                    Active{!s.is_active ? ' (retired)' : ''}
                  </label>
                </div>

                <div>
                  <label style={labelStyle}>Notes</label>
                  {editing ? <input value={s.notes} onChange={e => setStep(s.key, { notes: e.target.value })} style={cellInput} /> : roVal(s.notes)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel}
            style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={handleCopy} disabled={copying}
            style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: copying ? 'not-allowed' : 'pointer' }}>
            {copying ? 'Copying…' : 'Copy'}
          </button>
          <button onClick={handleToggle} disabled={toggling}
            style={{ height: 36, padding: '0 18px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: toggling ? 'not-allowed' : 'pointer',
              border: `1px solid ${template.is_active ? '#FECACA' : '#BBF7D0'}`, background: template.is_active ? '#FEF2F2' : '#F0FDF4', color: template.is_active ? '#DC2626' : '#059669' }}>
            {toggling ? '…' : template.is_active ? 'Inactivate' : 'Activate'}
          </button>
          <button onClick={() => setEditing(true)}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', fontSize: 13, color: '#fff', cursor: 'pointer', fontWeight: 500 }}>Edit</button>
        </div>
      )}

    </div>
  );
}
