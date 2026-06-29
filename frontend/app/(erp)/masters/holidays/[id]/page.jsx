'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3 };

export default function EditHolidayPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id;
  const addToast = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [holidayType, setHolidayType] = useState('GENERAL');
  const [isPaid, setIsPaid] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/holidays/${id}`).then(({ data, error }) => {
      if (error || !data) { setNotFound(true); setLoading(false); return; }
      setHolidayDate(String(data.holiday_date ?? '').slice(0, 10));
      setHolidayName(data.holiday_name ?? '');
      setHolidayType(data.holiday_type ?? 'GENERAL');
      setIsPaid(data.is_paid !== false);
      setIsActive(!!data.is_active);
      setNotes(data.notes ?? '');
      setLoading(false);
    });
  }, [id]);

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
    const { error } = await api.patch(`/api/v1/holidays/${id}`, {
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

    addToast('Holiday updated.');
    router.push('/masters/holidays');
  }

  async function handleDelete() {
    const { error } = await api.delete(`/api/v1/holidays/${id}`);
    if (error) { addToast(error.message ?? 'Failed to deactivate holiday.'); return; }
    addToast('Holiday deactivated.');
    router.push('/masters/holidays');
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (notFound) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Holiday not found.</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 720 }}>
      <button onClick={() => router.push('/masters/holidays')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Holiday Master</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>Edit Holiday</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Holiday date *</label>
          <input type="date" value={holidayDate} onChange={e => { setHolidayDate(e.target.value); setErrors(p => ({ ...p, holidayDate: undefined })); }} style={inputStyle(errors.holidayDate)} />
          {errors.holidayDate && <div style={errStyle}>{errors.holidayDate}</div>}
        </div>
        <div>
          <label style={labelStyle}>Holiday name *</label>
          <input value={holidayName} onChange={e => { setHolidayName(e.target.value); setErrors(p => ({ ...p, holidayName: undefined })); }} style={inputStyle(errors.holidayName)} />
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

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => router.push('/masters/holidays')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <div style={{ flex: 1 }} />
        {confirmDel ? (
          <>
            <span style={{ fontSize: 12, color: '#DC2626' }}>Deactivate?</span>
            <button onClick={handleDelete} style={{ height: 38, padding: '0 14px', border: 'none', borderRadius: 6, background: '#DC2626', color: '#fff', fontSize: 13, cursor: 'pointer' }}>Yes</button>
            <button onClick={() => setConfirmDel(false)} style={{ height: 38, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>No</button>
          </>
        ) : (
          <button onClick={() => setConfirmDel(true)} style={{ height: 38, padding: '0 14px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', color: '#DC2626', fontSize: 13, cursor: 'pointer' }}>Deactivate</button>
        )}
      </div>
    </div>
  );
}
