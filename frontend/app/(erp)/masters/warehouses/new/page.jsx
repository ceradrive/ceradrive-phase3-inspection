'use client';

/**
 * CERADRIVE ERP — Create Warehouse
 * R46: Three mandatory fields. Plain labels. One primary action.
 */

import { useEffect, useState } from 'react';
import { useRouter }           from 'next/navigation';
import { api }                 from '../../../../../lib/api.js';
import { useToast }            from '../../../../../components/ui/Toast.jsx';

export default function WarehouseNewPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [types,      setTypes]      = useState([]);
  const [code,       setCode]       = useState('');
  const [name,       setName]       = useState('');
  const [typeId,     setTypeId]     = useState('');
  const [notes,      setNotes]      = useState('');
  const [errors,     setErrors]     = useState({});
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    api.get('/api/v1/warehouses/types').then(({ data }) => {
      setTypes(data ?? []);
      if (data?.length === 1) setTypeId(data[0].id);
    });
  }, []);

  function validate() {
    const errs = {};
    if (!code.trim())  errs.warehouse_code = 'Code is required.';
    if (!name.trim())  errs.warehouse_name = 'Name is required.';
    if (!typeId)       errs.warehouse_type_id = 'Warehouse type is required.';
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/warehouses', {
      warehouse_code:    code.trim().toUpperCase(),
      warehouse_name:    name.trim(),
      warehouse_type_id: typeId,
      notes:             notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ warehouse_code: error.message });
      else showToast(error.message ?? 'Failed to create warehouse.', 'error');
    } else {
      showToast(`Warehouse ${data.warehouse_code} created.`, 'success');
      router.push('/masters/warehouses');
    }
  }

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const inputStyle = (err) => ({
    width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
    border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6,
    fontSize: 14, color: '#111827', outline: 'none',
  });
  const errStyle = { fontSize: 11, color: '#DC2626', marginTop: 3 };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 520, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/warehouses')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Warehouses
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Warehouse</h1>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>

        {/* Code */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Code *</label>
          <input value={code} onChange={e => { setCode(e.target.value); setErrors(p => ({ ...p, warehouse_code: undefined })); }}
            placeholder="e.g. RM-STORE" maxLength={30}
            style={{ ...inputStyle(errors.warehouse_code), textTransform: 'uppercase', fontFamily: 'monospace' }} />
          {errors.warehouse_code
            ? <span style={errStyle}>{errors.warehouse_code}</span>
            : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Stored uppercase.</span>}
        </div>

        {/* Name */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Name *</label>
          <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, warehouse_name: undefined })); }}
            placeholder="e.g. Raw Material Store" maxLength={100}
            style={inputStyle(errors.warehouse_name)} />
          {errors.warehouse_name && <span style={errStyle}>{errors.warehouse_name}</span>}
        </div>

        {/* Type */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Type *</label>
          <select value={typeId} onChange={e => { setTypeId(e.target.value); setErrors(p => ({ ...p, warehouse_type_id: undefined })); }}
            style={{ ...inputStyle(errors.warehouse_type_id), cursor: 'pointer' }}>
            <option value="">Select type…</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.type_name} ({t.type_code})</option>)}
          </select>
          {errors.warehouse_type_id && <span style={errStyle}>{errors.warehouse_type_id}</span>}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Optional notes…"
            style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => router.push('/masters/warehouses')}
            style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Create Warehouse'}
          </button>
        </div>

      </div>
    </div>
  );
}
