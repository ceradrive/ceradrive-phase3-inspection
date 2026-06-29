'use client';

/**
 * CERADRIVE ERP — Process Type Master (create)
 * Mirrors Item Type Master create. Code uppercased + read-after-create; 409 -> code field error.
 */

import { useState } from 'react';
import { useRouter }  from 'next/navigation';
import { api }         from '../../../../../lib/api.js';
import { useToast }   from '../../../../../components/ui/Toast.jsx';

const lbl = { display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 };
const inp = { width: '100%', height: 36, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#111827', outline: 'none' };
const fieldWrap = { display: 'flex', flexDirection: 'column' };

function Check({ label, hint, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '4px 0' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        <span style={{ fontSize: 13, color: '#111827' }}>{label}</span>
        {hint ? <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

export default function NewProcessTypePage() {
  const router = useRouter();
  const toast = useToast();

  const [code, setCode]       = useState('');
  const [name, setName]       = useState('');
  const [description, setDescription] = useState('');
  const [seqNo, setSeqNo]     = useState('');
  const [isWoDriven, setIsWoDriven]   = useState(false);
  const [isBottleneck, setIsBottleneck] = useState(false);
  const [generatesStageItem, setGeneratesStageItem] = useState(true);
  const [stageCodeAbbr, setStageCodeAbbr] = useState('');
  const [stageNameLabel, setStageNameLabel] = useState('');
  const [stageUomCode, setStageUomCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);

  function validate() {
    const e = {};
    if (!code.trim()) e.type_code = 'Code is required.';
    if (!name.trim()) e.type_name = 'Name is required.';
    if (seqNo !== '' && (Number.isNaN(Number(seqNo)) || Number(seqNo) < 0)) e.seq_no = 'Sequence must be 0 or greater.';
    return e;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/process-types/master', {
      type_code: code.trim().toUpperCase(),
      type_name: name.trim(),
      description: description.trim() || null,
      seq_no: seqNo === '' ? 0 : Number(seqNo),
      is_wo_driven: isWoDriven,
      is_bottleneck: isBottleneck,
      generates_stage_item: generatesStageItem,
      stage_item_code_abbr: stageCodeAbbr.trim() || null,
      stage_item_name_label: stageNameLabel.trim() || null,
      default_stage_uom_code: stageUomCode.trim() || null,
      is_active: isActive,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ type_code: error.message });
      else toast(error.message ?? 'Failed to create process type.');
    } else {
      toast(`Process type ${data.type_code} created.`);
      router.push('/masters/process-types');
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>New Process Type</h1>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Define a manufacturing process stage.</p>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={fieldWrap}>
            <label style={lbl}>Process Type Code *</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. MOULDING"
              style={{ ...inp, fontFamily: 'monospace', borderColor: errors.type_code ? '#DC2626' : '#D1D5DB' }} />
            {errors.type_code && <span style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{errors.type_code}</span>}
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Process Type Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Moulding"
              style={{ ...inp, borderColor: errors.type_name ? '#DC2626' : '#D1D5DB' }} />
            {errors.type_name && <span style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{errors.type_name}</span>}
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Sequence No</label>
            <input value={seqNo} onChange={e => setSeqNo(e.target.value)} type="number" min="0" placeholder="0"
              style={{ ...inp, borderColor: errors.seq_no ? '#DC2626' : '#D1D5DB' }} />
            {errors.seq_no && <span style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{errors.seq_no}</span>}
          </div>
          <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
            <label style={lbl}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              style={{ ...inp, height: 'auto', padding: 10, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ borderTop: '1px solid #F3F4F6', margin: '18px 0', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Behaviour</div>
          <Check label="WO-driven" hint="Stage starts on work-order release (e.g. Mixing, Shot Blasting)." checked={isWoDriven} onChange={setIsWoDriven} />
          <Check label="Bottleneck" hint="Designated capacity-constraining stage (e.g. Moulding)." checked={isBottleneck} onChange={setIsBottleneck} />
          <Check label="Generates stage item" hint="This stage produces a tracked stage/SFG item." checked={generatesStageItem} onChange={setGeneratesStageItem} />
          <Check label="Active" checked={isActive} onChange={setIsActive} />
        </div>

        <div style={{ borderTop: '1px solid #F3F4F6', margin: '18px 0 0', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Stage Item Configuration <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={fieldWrap}>
              <label style={lbl}>Stage Item Code Abbr.</label>
              <input value={stageCodeAbbr} onChange={e => setStageCodeAbbr(e.target.value)} placeholder="e.g. MLD" style={inp} />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Stage Item Name Label</label>
              <input value={stageNameLabel} onChange={e => setStageNameLabel(e.target.value)} placeholder="e.g. Moulded" style={inp} />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Default Stage UOM Code</label>
              <input value={stageUomCode} onChange={e => setStageUomCode(e.target.value)} placeholder="e.g. EA" style={inp} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={() => router.push('/masters/process-types')}
          style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving}
          style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
          {saving ? 'Saving…' : 'Create Process Type'}
        </button>
      </div>
    </div>
  );
}
