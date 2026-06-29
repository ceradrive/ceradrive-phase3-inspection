'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3 };

export default function NewHolidayPage() {
  const router = useRouter();
  const addToast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [holidayDate, setHolidayDate] = useState(today);
  const [holidayName, setHolidayName] = useState('');
  const [holidayType, setHolidayType] = useState('GENERAL');
  const [isPaid, setIsPaid] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const e = {};
    if (!holidayDate) e.holidayDate = 'Holiday date is required.';
    if (!holidayName.trim()) e.holidayName = 'Holiday name is required.';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    const { error } = await api.post('/api/v1/holidays', {
      holiday_date: holidayDate,
      holiday_name: holidayName.trim(),
      holiday_type: holidayType,
      is_paid: isPaid,
      is_active: isActive,
      notes: notes.trim() || null,
    });
    setSaving(false);

    if (error) {
      if (error.code === 'CONFLICT') setErrors({ holidayDate: error.message });
      else addToast(error.message ?? 'Failed to save holiday.');
      return;
    }

    addToast('Holiday created.');
    router.push('/masters/holidays');
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 720 }}>
      <button onClick={() => router.push('/masters/holidays')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Holiday Master</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>New Holiday</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Holiday date *</label>
          <input type="date" value={holidayDate} onChange={e => { setHolidayDate(e.target.value); setErrors(p => ({ ...p, holidayDate: undefined })); }} style={inputStyle(errors.holidayDate)} />
          {errors.holidayDate && <div style={errStyle}>{errors.holidayDate}</div>}
        </div>
        <div>
          <label style={labelStyle}>Holiday name *</label>
          <input value={holidayName} onChange={e => { setHolidayName(e.target.value); setErrors(p => ({ ...p, holidayName: undefined })); }} style={inputStyle(errors.holidayName)} placeholder="e.g. Diwali" />
          {errors.holidayName && <div style={errStyle}>{errors.holidayName}</div>}
        </div>
        <div>
          <label style={labelStyle}>Holiday type</label>
          <select value={holidayType} onChange={e => setHolidayType(e.target.value)} style={inputStyle(false)}>
            <option value="GENERAL">General</option>
            <option value="FESTIVAL">Festival</option>
            <option value="NATIONAL">National</option>
            <option value="WEEKLY_OFF">Weekly Off</option>
            <option value="COMPANY">Company</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 16, marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={isPaid} onChange={e => setIsPaid(e.target.checked)} /> Paid holiday
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => router.push('/masters/holidays')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
