'use client';

/**
 * CERADRIVE ERP — Machine Detail / Edit
 * Inline edit. machine_code immutable after creation.
 * Status select limited to active / under_maintenance / retired.
 * is_active toggle is independent of status.
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }                  from '../../../../../lib/api.js';
import { useToast }             from '../../../../../components/ui/Toast.jsx';

const STATUS_OPTIONS = [
  { value: 'active',            label: 'Active' },
  { value: 'under_maintenance', label: 'Under maintenance' },
  { value: 'retired',           label: 'Retired' },
];

const CAPACITY_BASIS_OPTIONS = [
  { value: '',             label: 'Not set yet' },
  { value: 'WEIGHT_BATCH', label: 'Weight batch' },
  { value: 'PCS_TRAY',     label: 'PCS per tray' },
  { value: 'DIE_CAVITY',   label: 'Die cavity' },
  { value: 'PCS_CYCLE',    label: 'PCS per cycle' },
  { value: 'PCS_PER_HOUR', label: 'PCS per hour' },
  { value: 'PCS_PER_MIN',  label: 'PCS per minute' },
  { value: 'PCS_CRATE',    label: 'PCS per crate' },
  { value: 'TRAY_BATCH',   label: 'Tray batch' },
  { value: 'MANUAL',       label: 'Manual' },
];

const STATUS_LABELS = { active: 'Active', under_maintenance: 'Under maintenance', retired: 'Retired' };
const CAPACITY_BASIS_LABELS = CAPACITY_BASIS_OPTIONS.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), {});

function n(v) {
  return v === '' || v == null ? null : Number(v);
}

export default function MachineDetailPage() {
  const router = useRouter();
  const params = useParams();
  const addToast = useToast();
  const id = params.id;

  const [mc,       setMc]       = useState(null);
  const [types,    setTypes]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/machines/master/${id}`).then(({ data, error }) => {
      if (error || !data) { addToast('Machine not found.', 'error'); }
      else { setMc(data); setForm(toForm(data)); }
      setLoading(false);
    });
    api.get('/api/v1/machines/types').then(({ data }) => { setTypes(data ?? []); });
  }, [id, addToast]);

  function toForm(m) {
    return {
      machine_name:               m.machine_name               ?? '',
      machine_type_id:            m.machine_type_id             ?? '',
      status:                     m.status                      ?? 'active',
      is_bottleneck:              Boolean(m.is_bottleneck),
      serial_number:              m.serial_number               ?? '',
      manufacturer:               m.manufacturer                ?? '',
      model_number:               m.model_number                ?? '',
      purchase_date:              m.purchase_date               ?? '',
      maintenance_frequency_days: m.maintenance_frequency_days != null ? String(m.maintenance_frequency_days) : '',
      last_maintenance_date:      m.last_maintenance_date       ?? '',
      next_maintenance_date:      m.next_maintenance_date       ?? '',
      machine_image_url:          m.machine_image_url           ?? '',
      machine_manual_url:         m.machine_manual_url          ?? '',
      capacity_basis:             m.capacity_basis              ?? '',
      rated_capacity:             m.rated_capacity != null ? String(m.rated_capacity) : '',
      planning_capacity:          m.planning_capacity != null ? String(m.planning_capacity) : '',
      capacity_uom:               m.capacity_uom                ?? '',
      cycle_time_sec:             m.cycle_time_sec != null ? String(m.cycle_time_sec) : '',
      setup_time_min:             m.setup_time_min != null ? String(m.setup_time_min) : '',
      changeover_time_min:        m.changeover_time_min != null ? String(m.changeover_time_min) : '',
      pcs_per_cycle:              m.pcs_per_cycle != null ? String(m.pcs_per_cycle) : '',
      pcs_per_hour:               m.pcs_per_hour != null ? String(m.pcs_per_hour) : '',
      tray_capacity:              m.tray_capacity != null ? String(m.tray_capacity) : '',
      batch_capacity_kg:          m.batch_capacity_kg != null ? String(m.batch_capacity_kg) : '',
      capacity_tolerance_percent: m.capacity_tolerance_percent != null ? String(m.capacity_tolerance_percent) : '',
      slots_count:                m.slots_count != null ? String(m.slots_count) : '',
      notes:                      m.notes                       ?? '',
    };
  }

  function set(field, val) {
    setForm(prev => ({ ...prev, [field]: val }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function handleCancel() {
    if (!mc) return;
    setForm(toForm(mc));
    setErrors({});
    setEditing(false);
  }

  async function handleSave() {
    if (!form.machine_name?.trim())  { setErrors({ machine_name: 'Name is required.' }); return; }
    if (!form.machine_type_id)       { setErrors({ machine_type_id: 'Machine type is required.' }); return; }
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/machines/master/${id}`, {
      machine_name:               form.machine_name.trim(),
      machine_type_id:            form.machine_type_id,
      status:                     form.status,
      is_bottleneck:              Boolean(form.is_bottleneck),
      serial_number:              form.serial_number.trim()  || null,
      manufacturer:               form.manufacturer.trim()   || null,
      model_number:               form.model_number.trim()   || null,
      purchase_date:              form.purchase_date         || null,
      maintenance_frequency_days: form.maintenance_frequency_days ? Number(form.maintenance_frequency_days) : null,
      last_maintenance_date:      form.last_maintenance_date || null,
      next_maintenance_date:      form.next_maintenance_date || null,
      machine_image_url:          form.machine_image_url.trim()  || null,
      machine_manual_url:         form.machine_manual_url.trim() || null,
      capacity_basis:             form.capacity_basis            || null,
      rated_capacity:             n(form.rated_capacity),
      planning_capacity:          n(form.planning_capacity),
      capacity_uom:               form.capacity_uom.trim()       || null,
      cycle_time_sec:             n(form.cycle_time_sec),
      setup_time_min:             n(form.setup_time_min),
      changeover_time_min:        n(form.changeover_time_min),
      pcs_per_cycle:              n(form.pcs_per_cycle),
      pcs_per_hour:               n(form.pcs_per_hour),
      tray_capacity:              n(form.tray_capacity),
      batch_capacity_kg:          n(form.batch_capacity_kg),
      capacity_tolerance_percent: n(form.capacity_tolerance_percent),
      slots_count:                n(form.slots_count),
      notes:                      form.notes.trim()          || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT' || error.code === 'VALIDATION_ERROR') {
        const msg = error.message?.toLowerCase() ?? '';
        const field = msg.includes('machine type') ? 'machine_type_id'
                    : msg.includes('status')        ? 'status'
                    : msg.includes('frequency')     ? 'maintenance_frequency_days'
                    : msg.includes('capacity')      ? 'capacity_basis'
                    : 'machine_name';
        setErrors({ [field]: error.message });
      } else {
        addToast(error.message ?? 'Failed to update.', 'error');
      }
    } else {
      setMc(data);
      setForm(toForm(data));
      setEditing(false);
      addToast('Machine updated.', 'success');
    }
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/machines/master/${id}/toggle-active`, {});
    setToggling(false);
    if (error) addToast(error.message ?? 'Failed to update status.', 'error');
    else { setMc(prev => ({ ...prev, is_active: data.is_active })); addToast(`${data.machine_code} ${data.is_active ? 'activated' : 'deactivated'}.`, 'success'); }
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!mc)     return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Machine not found.</div>;

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const roVal = (v) => (
    <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0', minHeight: 22 }}>{v || '—'}</div>
  );
  const inp = (field, opts = {}) => (
    <input
      value={form[field] ?? ''}
      onChange={e => set(field, e.target.value)}
      readOnly={!editing}
      maxLength={opts.max}
      type={opts.type ?? 'text'}
      min={opts.min}
      placeholder={opts.placeholder}
      style={{
        width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
        border: `1px solid ${errors[field] ? '#DC2626' : editing ? '#D1D5DB' : '#E5E7EB'}`,
        borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none',
        background: editing ? '#fff' : '#F9FAFB',
        ...(opts.mono ? { fontFamily: 'monospace', textTransform: 'uppercase' } : {}),
      }}
    />
  );
  const errTxt = (field) => errors[field] && <span style={{ fontSize: 11, color: '#DC2626', marginTop: 3, display: 'block' }}>{errors[field]}</span>;
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 };
  const sectionLabel = (t) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, marginTop: 4 }}>{t}</div>
  );

  return (
    <div style={{ padding: '24px 28px', maxWidth: 620, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/machines')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Machines
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{mc.machine_code}</h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
            border: `1px solid ${mc.is_active ? '#059669' : '#D1D5DB'}`,
            color: mc.is_active ? '#059669' : '#6B7280',
            background: mc.is_active ? '#ECFDF5' : '#F9FAFB',
          }}>
            {mc.is_active ? 'Active' : 'Inactive'}
          </span>
          {mc.is_bottleneck && (
            <span style={{ fontSize: 10, fontWeight: 600, color: '#B45309', background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 3, padding: '2px 6px' }}>BOTTLENECK</span>
          )}
        </div>
      </div>

      {/* Form card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>

        {/* Code — always read-only */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Machine Code</label>
          <div style={{ height: 38, padding: '0 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 14, color: '#374151', background: '#F9FAFB', display: 'flex', alignItems: 'center', fontFamily: 'monospace' }}>
            {mc.machine_code}
          </div>
          <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Code cannot be changed after creation.</span>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Machine Name</label>
          {editing ? inp('machine_name', { max: 200 }) : roVal(mc.machine_name)}
          {errTxt('machine_name')}
        </div>

        {/* Type + Status */}
        <div style={grid2}>
          <div>
            <label style={labelStyle}>Machine Type</label>
            {editing ? (
              <select value={form.machine_type_id} onChange={e => set('machine_type_id', e.target.value)}
                style={{ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${errors.machine_type_id ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', background: '#fff', cursor: 'pointer' }}>
                <option value="">Select machine type…</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
              </select>
            ) : roVal(mc.machine_type?.type_name)}
            {errTxt('machine_type_id')}
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            {editing ? (
              <select value={form.status} onChange={e => set('status', e.target.value)}
                style={{ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${errors.status ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', background: '#fff', cursor: 'pointer' }}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : roVal(STATUS_LABELS[mc.status] ?? mc.status)}
            {errTxt('status')}
          </div>
        </div>

        {/* Bottleneck */}
        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          {editing ? (
            <>
              <input id="bn" type="checkbox" checked={Boolean(form.is_bottleneck)} onChange={e => set('is_bottleneck', e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="bn" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>Bottleneck machine</label>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#374151' }}>Bottleneck: <strong>{mc.is_bottleneck ? 'Yes' : 'No'}</strong></div>
          )}
        </div>

        {sectionLabel('Capacity Planning')}
        <div style={grid2}>
          <div>
            <label style={labelStyle}>Calculation Basis</label>
            {editing ? (
              <select value={form.capacity_basis ?? ''} onChange={e => set('capacity_basis', e.target.value)}
                style={{ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${errors.capacity_basis ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', background: '#fff', cursor: 'pointer' }}>
                {CAPACITY_BASIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : roVal(CAPACITY_BASIS_LABELS[mc.capacity_basis] ?? mc.capacity_basis)}
            {errTxt('capacity_basis')}
          </div>
          <div><label style={labelStyle}>Capacity UOM</label>{editing ? inp('capacity_uom', { max: 50, placeholder: 'kg/batch, pcs/hr' }) : roVal(mc.capacity_uom)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Rated Capacity</label>{editing ? inp('rated_capacity', { type: 'number' }) : roVal(mc.rated_capacity != null ? String(mc.rated_capacity) : null)}</div>
          <div><label style={labelStyle}>Planning Capacity</label>{editing ? inp('planning_capacity', { type: 'number' }) : roVal(mc.planning_capacity != null ? String(mc.planning_capacity) : null)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Cycle Time (sec)</label>{editing ? inp('cycle_time_sec', { type: 'number' }) : roVal(mc.cycle_time_sec != null ? String(mc.cycle_time_sec) : null)}</div>
          <div><label style={labelStyle}>Setup Time (min)</label>{editing ? inp('setup_time_min', { type: 'number' }) : roVal(mc.setup_time_min != null ? String(mc.setup_time_min) : null)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Changeover Time (min)</label>{editing ? inp('changeover_time_min', { type: 'number' }) : roVal(mc.changeover_time_min != null ? String(mc.changeover_time_min) : null)}</div>
          <div><label style={labelStyle}>Batch Capacity (kg)</label>{editing ? inp('batch_capacity_kg', { type: 'number' }) : roVal(mc.batch_capacity_kg != null ? String(mc.batch_capacity_kg) : null)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Capacity Tolerance (%)</label>{editing ? inp('capacity_tolerance_percent', { type: 'number' }) : roVal(mc.capacity_tolerance_percent != null ? String(mc.capacity_tolerance_percent) : null)}</div>
          <div><label style={labelStyle}>PCS / Cycle</label>{editing ? inp('pcs_per_cycle', { type: 'number' }) : roVal(mc.pcs_per_cycle != null ? String(mc.pcs_per_cycle) : null)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>PCS / Hour</label>{editing ? inp('pcs_per_hour', { type: 'number' }) : roVal(mc.pcs_per_hour != null ? String(mc.pcs_per_hour) : null)}</div>
          <div></div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Tray Capacity</label>{editing ? inp('tray_capacity', { type: 'number' }) : roVal(mc.tray_capacity != null ? String(mc.tray_capacity) : null)}</div>
          <div><label style={labelStyle}>Slots Count</label>{editing ? inp('slots_count', { type: 'number' }) : roVal(mc.slots_count != null ? String(mc.slots_count) : null)}</div>
        </div>

        {sectionLabel('Identifiers')}
        <div style={grid2}>
          <div><label style={labelStyle}>Serial number</label>{editing ? inp('serial_number', { max: 100 }) : roVal(mc.serial_number)}</div>
          <div><label style={labelStyle}>Model number</label>{editing ? inp('model_number', { max: 100 }) : roVal(mc.model_number)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Manufacturer</label>{editing ? inp('manufacturer', { max: 100 }) : roVal(mc.manufacturer)}</div>
          <div><label style={labelStyle}>Purchase date</label>{editing ? inp('purchase_date', { type: 'date' }) : roVal(mc.purchase_date)}</div>
        </div>

        {sectionLabel('Maintenance')}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Frequency (days)</label>
          {editing ? inp('maintenance_frequency_days', { type: 'number', min: '1' }) : roVal(mc.maintenance_frequency_days != null ? String(mc.maintenance_frequency_days) : null)}
          {errTxt('maintenance_frequency_days')}
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Last maintenance</label>{editing ? inp('last_maintenance_date', { type: 'date' }) : roVal(mc.last_maintenance_date)}</div>
          <div><label style={labelStyle}>Next maintenance</label>{editing ? inp('next_maintenance_date', { type: 'date' }) : roVal(mc.next_maintenance_date)}</div>
        </div>

        {sectionLabel('Links (URL)')}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Image URL</label>
          {editing ? inp('machine_image_url', { max: 500 }) : roVal(mc.machine_image_url)}
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Manual URL</label>
          {editing ? inp('machine_manual_url', { max: 500 }) : roVal(mc.machine_manual_url)}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Notes</label>
          {editing
            ? <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
            : roVal(mc.notes)}
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
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setEditing(true)} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Edit</button>
          </div>
        )}
      </div>

      {/* Status toggle */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{mc.is_active ? 'Deactivate this machine' : 'Activate this machine'}</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
            {mc.is_active ? 'Machine will no longer be available for selection.' : 'Machine will become available for selection.'}
          </div>
        </div>
        <button onClick={handleToggle} disabled={toggling}
          style={{
            height: 34, padding: '0 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: toggling ? 'not-allowed' : 'pointer',
            border:     `1px solid ${mc.is_active ? '#FECACA' : '#BBF7D0'}`,
            background: mc.is_active ? '#FEF2F2' : '#F0FDF4',
            color:      mc.is_active ? '#DC2626' : '#059669',
          }}>
          {toggling ? '…' : mc.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

    </div>
  );
}
