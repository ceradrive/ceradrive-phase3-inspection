'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3 };

function toTime(v, fallback) {
  if (!v) return fallback;
  return String(v).slice(0, 5);
}

function hourlyRate(monthlySalary, standardHours) {
  const salary = Number(monthlySalary || 0);
  const hrs = Number(standardHours || 8) || 8;
  return salary / 30 / hrs;
}

export default function EditEmployeePage() {
  const router = useRouter();
  const { id } = useParams();
  const addToast = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [workerCode, setWorkerCode] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:30');
  const [standardHours, setStandardHours] = useState('8');
  const [otEligible, setOtEligible] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/employees/${id}`).then(({ data, error }) => {
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setWorkerCode(data.worker_code ?? '');
      setWorkerName(data.worker_name ?? '');
      setDepartment(data.department ?? '');
      setDesignation(data.designation ?? '');
      setPhone(data.phone ?? '');
      setMonthlySalary(data.monthly_salary != null ? String(data.monthly_salary) : '');
      setShiftStart(toTime(data.shift_start_time, '09:00'));
      setShiftEnd(toTime(data.shift_end_time, '17:30'));
      setStandardHours(data.standard_hours_per_day != null ? String(data.standard_hours_per_day) : '8');
      setOtEligible(data.ot_eligible !== false);
      setIsActive(data.is_active !== false);
      setNotes(data.notes ?? '');
      setLoading(false);
    });
  }, [id]);

  function validate() {
    const e = {};
    if (!workerCode.trim()) e.workerCode = 'Employee code is required.';
    if (!workerName.trim()) e.workerName = 'Employee name is required.';
    if (monthlySalary !== '' && Number(monthlySalary) < 0) e.monthlySalary = 'Salary cannot be negative.';
    if (!shiftStart) e.shiftStart = 'Shift start is required.';
    if (!shiftEnd) e.shiftEnd = 'Shift end is required.';
    if (!standardHours || Number(standardHours) <= 0) e.standardHours = 'Standard hours must be greater than 0.';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    const { error } = await api.patch(`/api/v1/employees/${id}`, {
      worker_code: workerCode.trim().toUpperCase(),
      worker_name: workerName.trim(),
      department: department.trim() || null,
      designation: designation.trim() || null,
      phone: phone.trim() || null,
      monthly_salary: monthlySalary === '' ? 0 : Number(monthlySalary),
      shift_start_time: shiftStart,
      shift_end_time: shiftEnd,
      standard_hours_per_day: Number(standardHours),
      ot_eligible: otEligible,
      is_active: isActive,
      notes: notes.trim() || null,
    });
    setSaving(false);

    if (error) {
      if (error.code === 'CONFLICT') setErrors({ workerCode: error.message });
      else addToast(error.message ?? 'Failed to save employee.');
      return;
    }

    addToast('Employee updated.');
    router.push('/masters/employees');
  }

  async function handleDeactivate() {
    const { error } = await api.patch(`/api/v1/employees/${id}`, { is_active: false });
    if (error) { addToast(error.message ?? 'Failed to deactivate employee.'); return; }
    addToast('Employee deactivated.');
    router.push('/masters/employees');
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (notFound) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Employee not found.</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 760 }}>
      <button onClick={() => router.push('/masters/employees')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Employee Master</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>Edit Employee</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Employee code *</label>
          <input value={workerCode} onChange={e => { setWorkerCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, workerCode: undefined })); }} style={inputStyle(errors.workerCode)} />
          {errors.workerCode && <div style={errStyle}>{errors.workerCode}</div>}
        </div>
        <div>
          <label style={labelStyle}>Employee name *</label>
          <input value={workerName} onChange={e => { setWorkerName(e.target.value); setErrors(p => ({ ...p, workerName: undefined })); }} style={inputStyle(errors.workerName)} />
          {errors.workerName && <div style={errStyle}>{errors.workerName}</div>}
        </div>
        <div>
          <label style={labelStyle}>Department</label>
          <input value={department} onChange={e => setDepartment(e.target.value)} style={inputStyle(false)} />
        </div>
        <div>
          <label style={labelStyle}>Designation</label>
          <input value={designation} onChange={e => setDesignation(e.target.value)} style={inputStyle(false)} />
        </div>
        <div>
          <label style={labelStyle}>Phone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle(false)} />
        </div>
        <div>
          <label style={labelStyle}>Monthly salary</label>
          <input type="number" min="0" step="0.01" value={monthlySalary} onChange={e => { setMonthlySalary(e.target.value); setErrors(p => ({ ...p, monthlySalary: undefined })); }} style={inputStyle(errors.monthlySalary)} />
          {errors.monthlySalary && <div style={errStyle}>{errors.monthlySalary}</div>}
        </div>
        <div>
          <label style={labelStyle}>Shift start</label>
          <input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} style={inputStyle(errors.shiftStart)} />
          {errors.shiftStart && <div style={errStyle}>{errors.shiftStart}</div>}
        </div>
        <div>
          <label style={labelStyle}>Shift end</label>
          <input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} style={inputStyle(errors.shiftEnd)} />
          {errors.shiftEnd && <div style={errStyle}>{errors.shiftEnd}</div>}
        </div>
        <div>
          <label style={labelStyle}>Standard hours/day</label>
          <input type="number" min="0.01" max="24" step="0.25" value={standardHours} onChange={e => { setStandardHours(e.target.value); setErrors(p => ({ ...p, standardHours: undefined })); }} style={inputStyle(errors.standardHours)} />
          {errors.standardHours && <div style={errStyle}>{errors.standardHours}</div>}
        </div>
        <div>
          <label style={labelStyle}>OT hourly rate preview</label>
          <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 14, color: '#111827' }}>₹{hourlyRate(monthlySalary, standardHours).toFixed(2)} / hour</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} />
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 16, marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={otEligible} onChange={e => setOtEligible(e.target.checked)} /> OT eligible
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => router.push('/masters/employees')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <div style={{ flex: 1 }} />
        {confirmDel ? (
          <>
            <span style={{ fontSize: 12, color: '#DC2626' }}>Deactivate?</span>
            <button onClick={handleDeactivate} style={{ height: 38, padding: '0 14px', border: 'none', borderRadius: 6, background: '#DC2626', color: '#fff', fontSize: 13, cursor: 'pointer' }}>Yes</button>
            <button onClick={() => setConfirmDel(false)} style={{ height: 38, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>No</button>
          </>
        ) : (
          <button onClick={() => setConfirmDel(true)} style={{ height: 38, padding: '0 14px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', color: '#DC2626', fontSize: 13, cursor: 'pointer' }}>Deactivate</button>
        )}
      </div>
    </div>
  );
}
