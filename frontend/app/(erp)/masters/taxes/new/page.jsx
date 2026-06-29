'use client';

/**
 * CERADRIVE ERP — Tax Master create. POST /api/v1/taxes.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api }       from '../../../../../lib/api.js';
import { useToast }  from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

export default function NewTaxPage() {
  const router = useRouter();
  const addToast = useToast();
  const [taxCode, setTaxCode] = useState('');
  const [taxName, setTaxName]   = useState('');
  const [taxPercent, setTaxPct] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes]   = useState('');
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);

  function validate() {
    const e = {};
    if (!taxCode.trim()) e.taxCode = 'Tax code is required.';
    if (!taxName.trim()) e.taxName = 'Tax name is required.';
    if (taxPercent === '' || taxPercent == null) e.taxPercent = 'Tax % is required.';
    else { const n = Number(taxPercent); if (isNaN(n) || n < 0 || n > 100) e.taxPercent = 'Tax % must be between 0 and 100.'; }
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/taxes', {
      tax_code: taxCode.trim().toUpperCase(), tax_name: taxName.trim(), tax_percent: Number(taxPercent),
      is_active: isActive, notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ taxName: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ taxPercent: error.message });
      else addToast(error.message ?? 'Failed to save.');
      return;
    }
    addToast('Tax created.');
    router.push('/masters/taxes');
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 520 }}>
      <button onClick={() => router.push('/masters/taxes')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Tax Master</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>New Tax</h1>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tax code *</label>
        <input value={taxCode} onChange={e => { setTaxCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, taxCode: undefined })); }} style={inputStyle(errors.taxCode)} placeholder="e.g. TAX18" />
        {errors.taxCode && <div style={errStyle}>{errors.taxCode}</div>}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tax name *</label>
        <input value={taxName} onChange={e => { setTaxName(e.target.value); setErrors(p => ({ ...p, taxName: undefined })); }} placeholder="e.g. Tax 18%" style={inputStyle(errors.taxName)} />
        {errors.taxName && <div style={errStyle}>{errors.taxName}</div>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tax % *</label>
        <input type="number" min="0" max="100" step="0.001" value={taxPercent} onChange={e => { setTaxPct(e.target.value); setErrors(p => ({ ...p, taxPercent: undefined })); }} placeholder="0 – 100" style={inputStyle(errors.taxPercent)} />
        {errors.taxPercent && <div style={errStyle}>{errors.taxPercent}</div>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
      </label>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create Tax'}</button>
        <button onClick={() => router.push('/masters/taxes')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
