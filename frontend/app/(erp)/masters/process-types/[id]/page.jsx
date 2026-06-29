'use client';

/**
 * CERADRIVE ERP — Process Type Master (edit)
 * Mirrors Item Type Master edit. Code read-only; status toggle; hydrate from fetch.
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }         from '../../../../../lib/api.js';
import { useToast }   from '../../../../../components/ui/Toast.jsx';

const lbl = { display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 };
const inp = { width: '100%', height: 36, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#111827', outline: 'none' };
const roBox = { width: '100%', minHeight: 36, padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, color: '#6B7280', background: '#F9FAFB', display: 'flex', alignItems: 'center' };
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

export default function EditProcessTypePage() {
  const router = useRouter();
  const params = useParams();
  const toast = useToast();
  const id = params?.id;

  const [item, setItem]       = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName]       = useState('');
  const [description, setDescription] = useState('');
  const [seqNo, setSeqNo]     = useState('');
  const [isWoDriven, setIsWoDriven]   = useState(false);
  const [isBottleneck, setIsBottleneck] = useState(false);
  const [generatesStageItem, setGeneratesStageItem] = useState(true);
  const [stageCodeAbbr, setStageCodeAbbr] = useState('');
  const [stageNameLabel, setStageNameLabel] = useState('');
  const [stageUomCode, setStageUomCode] = useState('');
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await api.get(`/api/v1/process-types/master/${id}`);
      setLoading(false);
      if (error || !data) { toast('Process type not found.'); router.push('/masters/process-types'); return; }
      setItem(data);
      setName(data.type_name ?? '');
      setDescription(data.description ?? '');
      setSeqNo(data.seq_no === null || data.seq_no === undefined ? '' : String(data.seq_no));
      setIsWoDriven(data.is_wo_driven === true);
      setIsBottleneck(data.is_bottleneck === true);
      setGeneratesStageItem(data.generates_stage_item === true);
      setStageCodeAbbr(data.stage_item_code_abbr ?? '');
      setStageNameLabel(data.stage_item_name_label ?? '');
      setStageUomCode(data.default_stage_uom_code ?? '');
    })();
  }, [id, router, toast]);

  function validate() {
    const e = {};
    if (!name.trim()) e.type_name = 'Name is required.';
    if (seqNo !== '' && (Number.isNaN(Number(seqNo)) || Number(seqNo) < 0)) e.seq_no = 'Sequence must be 0 or greater.';
    return e;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/process-types/master/${id}`, {
      type_name: name.trim(),
      description: description.trim() || null,
      seq_no: seqNo === '' ? 0 : Number(seqNo),
      is_wo_driven: isWoDriven,
      is_bottleneck: isBottleneck,
      generates_stage_item: generatesStageItem,
      stage_item_code_abbr: stageCodeAbbr.trim() || null,
      stage_item_name_label: stageNameLabel.trim() || null,
      default_stage_uom_code: stageUomCode.trim() || null,
    });
    setSaving(false);
    if (error) { toast(error.message ?? 'Failed to save changes.'); return; }
    setItem(data);
    toast('Process type updated.');
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/process-types/master/${id}/toggle-active`, {
      is_active: !item.is_active,
    });
    setToggling(false);
    if (error) { toast(error.message ?? 'Failed to update status.'); return; }
    setItem(data);
    toast(`Process type ${data.is_active ? 'activated' : 'deactivated'}.`);
  }

  if (loading || !item) {
    return <div style={{ maxWidth: 720, margin: '0 auto', padding: 24, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 600, color: '#111827' }}>{item.type_code}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 999, fontSize: 12, fontWeight: 500,
            background: item.is_active ? '#ECFDF5' : '#F3F4F6', color: item.is_active ? '#059669' : '#6B7280' }}>
            {item.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <button onClick={handleToggle} disabled={toggling}
          style={{ height: 34, padding: '0 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: toggling ? 'not-allowed' : 'pointer',
            border: `1px solid ${item.is_active ? '#FECACA' : '#BBF7D0'}`,
            background: item.is_active ? '#FEF2F2' : '#F0FDF4', color: item.is_active ? '#DC2626' : '#059669' }}>
          {toggling ? '…' : item.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={fieldWrap}>
            <label style={lbl}>Process Type Code</label>
            <div style={{ ...roBox, fontFamily: 'monospace' }}>{item.type_code}</div>
            <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Code cannot be changed after creation.</span>
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Process Type Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ ...inp, borderColor: errors.type_name ? '#DC2626' : '#D1D5DB' }} />
            {errors.type_name && <span style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{errors.type_name}</span>}
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Sequence No</label>
            <input value={seqNo} onChange={e => setSeqNo(e.target.value)} type="number" min="0"
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
        </div>

        <div style={{ borderTop: '1px solid #F3F4F6', margin: '18px 0 0', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Stage Item Configuration <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={fieldWrap}>
              <label style={lbl}>Stage Item Code Abbr.</label>
              <input value={stageCodeAbbr} onChange={e => setStageCodeAbbr(e.target.value)} style={inp} />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Stage Item Name Label</label>
              <input value={stageNameLabel} onChange={e => setStageNameLabel(e.target.value)} style={inp} />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Default Stage UOM Code</label>
              <input value={stageUomCode} onChange={e => setStageUomCode(e.target.value)} style={inp} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={() => router.push('/masters/process-types')}
          style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving}
          style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
