'use client';

/**
 * CERADRIVE ERP — Warehouse Detail / Edit
 * Inline edit. Code immutable after creation.
 * Toggle active / inactive with deactivate guard messaging.
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }                  from '../../../../../lib/api.js';
import { useToast }             from '../../../../../components/ui/Toast.jsx';

export default function WarehouseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const id = params.id;

  const [wh,       setWh]       = useState(null);
  const [types,    setTypes]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [name,     setName]     = useState('');
  const [typeId,   setTypeId]   = useState('');
  const [notes,    setNotes]    = useState('');
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get('/api/v1/warehouses/types').then(({ data }) => setTypes(data ?? []));
    api.get(`/api/v1/warehouses/${id}`).then(({ data, error }) => {
      if (error || !data) { showToast('Warehouse not found.', 'error'); }
      else { setWh(data); setName(data.warehouse_name); setTypeId(data.warehouse_type_id); setNotes(data.notes ?? ''); }
      setLoading(false);
    });
  }, [id, showToast]);

  function handleCancel() {
    if (!wh) return;
    setName(wh.warehouse_name);
    setTypeId(wh.warehouse_type_id);
    setNotes(wh.notes ?? '');
    setErrors({});
    setEditing(false);
  }

  async function handleSave() {
    const errs = {};
    if (!name.trim()) errs.warehouse_name = 'Name is required.';
    if (!typeId)      errs.warehouse_type_id = 'Warehouse type is required.';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/warehouses/${id}`, {
      warehouse_name:    name.trim(),
      warehouse_type_id: typeId,
      notes:             notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      showToast(error.message ?? 'Failed to update.', 'error');
    } else {
      setWh(data);
      setName(data.warehouse_name);
      setTypeId(data.warehouse_type_id);
      setNotes(data.notes ?? '');
      setEditing(false);
      showToast('Warehouse updated.', 'success');
    }
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/warehouses/${id}/toggle-active`, {});
    setToggling(false);
    if (error) showToast(error.message ?? 'Failed to update status.', 'error');
    else { setWh(prev => ({ ...prev, is_active: data.is_active })); showToast(`${data.warehouse_code} ${data.is_active ? 'activated' : 'deactivated'}.`, 'success'); }
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!wh)     return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Warehouse not found.</div>;

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const roStyle    = { width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 14, color: '#374151', background: '#F9FAFB', display: 'flex', alignItems: 'center' };
  const editStyle  = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
  const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 520, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/warehouses')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Warehouses
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{wh.warehouse_code}</h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
            border:     `1px solid ${wh.is_active ? '#059669' : '#D1D5DB'}`,
            color:      wh.is_active ? '#059669' : '#6B7280',
            background: wh.is_active ? '#ECFDF5' : '#F9FAFB',
          }}>
            {wh.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Form */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>

        {/* Code — always read-only */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Code</label>
          <div style={roStyle}>{wh.warehouse_code}</div>
          <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Code cannot be changed after creation.</span>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Name</label>
          {editing
            ? <><input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, warehouse_name: undefined })); }} style={editStyle(errors.warehouse_name)} />
                {errors.warehouse_name && <span style={errStyle}>{errors.warehouse_name}</span>}</>
            : <div style={roStyle}>{wh.warehouse_name}</div>}
        </div>

        {/* Type */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Type</label>
          {editing
            ? <><select value={typeId} onChange={e => { setTypeId(e.target.value); setErrors(p => ({ ...p, warehouse_type_id: undefined })); }}
                style={{ ...editStyle(errors.warehouse_type_id), cursor: 'pointer' }}>
                <option value="">Select type…</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.type_name} ({t.type_code})</option>)}
              </select>
              {errors.warehouse_type_id && <span style={errStyle}>{errors.warehouse_type_id}</span>}</>
            : <div style={roStyle}>{wh.warehouse_types?.type_name ?? '—'} {wh.warehouse_types?.type_code ? `(${wh.warehouse_types.type_code})` : ''}</div>}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Notes</label>
          {editing
            ? <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
            : <div style={{ fontSize: 13, color: wh.notes ? '#374151' : '#9CA3AF', padding: '8px 0' }}>{wh.notes || 'No notes.'}</div>}
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{wh.is_active ? 'Deactivate this warehouse' : 'Activate this warehouse'}</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
            {wh.is_active ? 'Blocked if in use by GRNs, inventory, or suppliers.' : 'Warehouse will become available for selection.'}
          </div>
        </div>
        <button onClick={handleToggle} disabled={toggling}
          style={{
            height: 34, padding: '0 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: toggling ? 'not-allowed' : 'pointer',
            border:     `1px solid ${wh.is_active ? '#FECACA' : '#BBF7D0'}`,
            background: wh.is_active ? '#FEF2F2' : '#F0FDF4',
            color:      wh.is_active ? '#DC2626' : '#059669',
          }}>
          {toggling ? '…' : wh.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

    </div>
  );
}
