'use client';

/**
 * CERADRIVE ERP — Tax Master edit. GET/PUT/DELETE /api/v1/taxes/:id.
 */
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }      from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

export default function EditTaxPage() {
  const router = useRouter();
  const { id } = useParams();
  const addToast = useToast();
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [taxCode, setTaxCode] = useState('');
  const [taxName, setTaxName]   = useState('');
  const [taxPercent, setTaxPct] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes]   = useState('');
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/taxes/${id}`).then(({ data, error }) => {
      if (error || !data) { setNotFound(true); setLoading(false); return; }
      setTaxCode(data.tax_code ?? '');
      setTaxName(data.tax_name ?? ''); setTaxPct(data.tax_percent != null ? String(data.tax_percent) : '');
      setIsActive(!!data.is_active); setNotes(data.notes ?? ''); setLoading(false);
    });
  }, [id]);

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
    const { error } = await api.patch(`/api/v1/taxes/${id}`, {
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
    addToast('Tax updated.');
    router.push('/masters/taxes');
  }

  async function handleDelete() {
    const { error } = await api.patch(`/api/v1/taxes/${id}`, { is_active: false });
    if (error) { addToast(error.message ?? 'Failed to deactivate.'); return; }
    addToast('Tax deactivated.');
    router.push('/masters/taxes');
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (notFound) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Tax not found.</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 520 }}>
      <button onClick={() => router.push('/masters/taxes')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Tax Master</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>Edit Tax</h1>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tax code *</label>
        <input value={taxCode} onChange={e => { setTaxCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, taxCode: undefined })); }} style={inputStyle(errors.taxCode)} />
        {errors.taxCode && <div style={errStyle}>{errors.taxCode}</div>}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tax name *</label>
        <input value={taxName} onChange={e => { setTaxName(e.target.value); setErrors(p => ({ ...p, taxName: undefined })); }} style={inputStyle(errors.taxName)} />
        {errors.taxName && <div style={errStyle}>{errors.taxName}</div>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tax % *</label>
        <input type="number" min="0" max="100" step="0.001" value={taxPercent} onChange={e => { setTaxPct(e.target.value); setErrors(p => ({ ...p, taxPercent: undefined })); }} style={inputStyle(errors.taxPercent)} />
        {errors.taxPercent && <div style={errStyle}>{errors.taxPercent}</div>}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => router.push('/masters/taxes')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <div style={{ flex: 1 }} />
        {confirmDel ? (
          <>
            <span style={{ fontSize: 12, color: '#DC2626' }}>Delete?</span>
            <button onClick={handleDelete} style={{ height: 38, padding: '0 14px', border: 'none', borderRadius: 6, background: '#DC2626', color: '#fff', fontSize: 13, cursor: 'pointer' }}>Yes</button>
            <button onClick={() => setConfirmDel(false)} style={{ height: 38, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>No</button>
          </>
        ) : (
          <button onClick={() => setConfirmDel(true)} style={{ height: 38, padding: '0 14px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', color: '#DC2626', fontSize: 13, cursor: 'pointer' }}>Delete</button>
        )}
      </div>
    </div>
  );
}
