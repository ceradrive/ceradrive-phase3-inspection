'use client';

/**
 * CERADRIVE ERP — Vehicle Detail
 */

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
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

function ActiveBadge({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      border: `1px solid ${active ? '#059669' : '#D1D5DB'}`,
      color: active ? '#059669' : '#6B7280',
      background: active ? '#ECFDF5' : '#F9FAFB',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function toForm(v) {
  return {
    vehicle_name: v?.vehicle_name ?? '',
    make: v?.make ?? '',
    is_active: v?.is_active ?? true,
  };
}

export default function VehicleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const toast = useToast();
  const id = params.id;

  const [vehicle, setVehicle] = useState(null);
  const [form, setForm] = useState({ vehicle_name: '', make: '', is_active: true });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/vehicles/master/${id}`).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        notify(toast, 'Vehicle not found.', 'error');
      } else {
        setVehicle(data);
        setForm(toForm(data));
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, toast]);

  function set(field, val) {
    setForm(prev => ({ ...prev, [field]: val }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function cancelEdit() {
    setForm(toForm(vehicle));
    setErrors({});
    setEditing(false);
  }

  async function handleSave() {
    if (!form.vehicle_name.trim()) { setErrors({ vehicle_name: 'Vehicle name is required.' }); return; }
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/vehicles/master/${id}`, {
      vehicle_name: form.vehicle_name.trim(),
      make: form.make.trim() || null,
      is_active: form.is_active,
    });
    setSaving(false);

    if (error) {
      if (error.code === 'CONFLICT') setErrors({ vehicle_name: error.message });
      else notify(toast, error.message ?? 'Failed to update vehicle.', 'error');
    } else {
      setVehicle(data);
      setForm(toForm(data));
      setEditing(false);
      notify(toast, 'Vehicle updated.', 'success');
    }
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!vehicle) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Vehicle not found.</div>;

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const inputStyle = (err, readOnly = false) => ({
    width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
    border: `1px solid ${err ? '#DC2626' : readOnly ? '#E5E7EB' : '#D1D5DB'}`,
    borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none', background: readOnly ? '#F9FAFB' : '#fff',
  });
  const roVal = (v) => <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0', minHeight: 22 }}>{v || '—'}</div>;
  const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3, display: 'block' };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 620, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/vehicles')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Vehicles
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>{vehicle.vehicle_name}</h1>
          <ActiveBadge active={vehicle.is_active} />
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Vehicle Name *</label>
          {editing ? (
            <input value={form.vehicle_name} onChange={e => set('vehicle_name', e.target.value)} maxLength={120} style={inputStyle(errors.vehicle_name)} />
          ) : roVal(vehicle.vehicle_name)}
          {errors.vehicle_name && <span style={errStyle}>{errors.vehicle_name}</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Make</label>
          {editing ? (
            <input value={form.make} onChange={e => set('make', e.target.value)} maxLength={80} style={inputStyle()} />
          ) : roVal(vehicle.make)}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Status</label>
          {editing ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, color: '#374151', fontSize: 13 }}>
              <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} style={{ width: 16, height: 16 }} />
              Active
            </label>
          ) : <ActiveBadge active={vehicle.is_active} />}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {editing ? (
          <>
            <button onClick={cancelEdit} disabled={saving}
              style={{ height: 36, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: saving ? '#9CA3AF' : '#4F46E5', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}
            style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}
