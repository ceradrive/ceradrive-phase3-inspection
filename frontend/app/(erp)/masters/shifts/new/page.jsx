'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3 };

function timeOnly(v, fallback = '') {
  return v ? String(v).slice(0, 5) : fallback;
}

export default function NewShiftPage() {
  const router = useRouter();
  const addToast = useToast();

  const [shiftCode, setShiftCode] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:30');
  const [crossesMidnight, setCrossesMidnight] = useState(false);
  const [workingDays, setWorkingDays] = useState('MON-SAT');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const e = {};
    if (!shiftCode.trim()) e.shiftCode = 'Shift code is required.';
    if (!shiftName.trim()) e.shiftName = 'Shift name is required.';
    if (!startTime) e.startTime = 'Start time is required.';
    if (!endTime) e.endTime = 'End time is required.';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    const { error } = await api.post('/api/v1/shifts', {
      shift_code: shiftCode.trim().toUpperCase(),
      shift_name: shiftName.trim(),
      start_time: startTime,
      end_time: endTime,
      crosses_midnight: crossesMidnight,
      working_days: workingDays.trim() || null,
      is_active: isActive,
      notes: notes.trim() || null,
    });
    setSaving(false);

    if (error) {
      if (error.code === 'CONFLICT') setErrors({ shiftCode: error.message });
      else addToast(error.message ?? 'Failed to save shift.');
      return;
    }

    addToast('Shift created.');
    router.push('/masters/shifts');
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 720 }}>
      <button onClick={() => router.push('/masters/shifts')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Shift Master</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>New Shift</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Shift code *</label>
          <input value={shiftCode} onChange={e => { setShiftCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, shiftCode: undefined })); }} style={inputStyle(errors.shiftCode)} placeholder="e.g. SHIFT1" />
          {errors.shiftCode && <div style={errStyle}>{errors.shiftCode}</div>}
        </div>
        <div>
          <label style={labelStyle}>Shift name *</label>
          <input value={shiftName} onChange={e => { setShiftName(e.target.value); setErrors(p => ({ ...p, shiftName: undefined })); }} style={inputStyle(errors.shiftName)} placeholder="e.g. General Shift" />
          {errors.shiftName && <div style={errStyle}>{errors.shiftName}</div>}
        </div>
        <div>
          <label style={labelStyle}>Start time *</label>
          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setErrors(p => ({ ...p, startTime: undefined })); }} style={inputStyle(errors.startTime)} />
          {errors.startTime && <div style={errStyle}>{errors.startTime}</div>}
        </div>
        <div>
          <label style={labelStyle}>End time *</label>
          <input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setErrors(p => ({ ...p, endTime: undefined })); }} style={inputStyle(errors.endTime)} />
          {errors.endTime && <div style={errStyle}>{errors.endTime}</div>}
        </div>
        <div>
          <label style={labelStyle}>Working days</label>
          <input value={workingDays} onChange={e => setWorkingDays(e.target.value)} style={inputStyle(false)} placeholder="MON-SAT" />
        </div>
        <div>
          <label style={labelStyle}>Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 16, marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={crossesMidnight} onChange={e => setCrossesMidnight(e.target.checked)} /> Crosses midnight
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => router.push('/masters/shifts')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
