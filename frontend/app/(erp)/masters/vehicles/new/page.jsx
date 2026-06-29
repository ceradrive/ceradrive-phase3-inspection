'use client';

/**
 * CERADRIVE ERP — Create Vehicle
 * Mandatory: vehicle_name. Make is optional.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

function notify(toast, message, type = 'info') {
  if (typeof toast === 'function') return toast(message, type);
  if (typeof toast?.showToast === 'function') return toast.showToast(message, type);
  if (typeof toast?.toast === 'function') return toast.toast(message, type);
  if (type === 'success' && typeof toast?.success === 'function') return toast.success(message);
  if (type === 'error' && typeof toast?.error === 'function') return toast.error(message);
  if (typeof toast?.addToast === 'function') return toast.addToast({ message, type });
  if (type === 'error') console.error(message);
  else console.log(message);
}

export default function NewVehiclePage() {
  const router = useRouter();
  const toast = useToast();

  const [vehicleName, setVehicleName] = useState('');
  const [make, setMake] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const e = {};
    if (!vehicleName.trim()) e.vehicle_name = 'Vehicle name is required.';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/vehicles/master', {
      vehicle_name: vehicleName.trim(),
      make: make.trim() || null,
      is_active: isActive,
    });
    setSaving(false);

    if (error) {
      if (error.code === 'CONFLICT') setErrors({ vehicle_name: error.message });
      else notify(toast, error.message ?? 'Failed to create vehicle.', 'error');
    } else {
      notify(toast, `Vehicle ${data.vehicle_name} created.`, 'success');
      router.push('/masters/vehicles');
    }
  }

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
  const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3, display: 'block' };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 600, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/vehicles')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Vehicles
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Vehicle</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Vehicle name is required. Make can be added now or later.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Vehicle Name *</label>
          <input value={vehicleName} onChange={e => { setVehicleName(e.target.value); setErrors(p => ({ ...p, vehicle_name: undefined })); }}
            placeholder="e.g. Bolero" maxLength={120} style={inputStyle(errors.vehicle_name)} />
          {errors.vehicle_name && <span style={errStyle}>{errors.vehicle_name}</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Make</label>
          <input value={make} onChange={e => setMake(e.target.value)} placeholder="e.g. Mahindra" maxLength={80} style={inputStyle()} />
        </div>

        <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input id="active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <label htmlFor="active" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>Active</label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={() => router.push('/masters/vehicles')} disabled={saving}
            style={{ height: 36, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: saving ? '#9CA3AF' : '#4F46E5', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Create Vehicle'}
          </button>
        </div>
      </div>
    </div>
  );
}
