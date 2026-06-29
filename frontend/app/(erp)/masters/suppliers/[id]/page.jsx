'use client';

/**
 * CERADRIVE ERP — Supplier Detail / Edit
 * Inline edit. supplier_code immutable after creation.
 * Toggle active / inactive with guard messaging.
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }                  from '../../../../../lib/api.js';
import { useToast }             from '../../../../../components/ui/Toast.jsx';

export default function SupplierDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const id = params.id;

  const [sup,      setSup]      = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/suppliers/master/${id}`).then(({ data, error }) => {
      if (error || !data) { showToast('Supplier not found.', 'error'); }
      else { setSup(data); setForm(toForm(data)); }
      setLoading(false);
    });
  }, [id, showToast]);

  function toForm(s) {
    return {
      supplier_name:  s.supplier_name  ?? '',
      gstin:          s.gstin          ?? '',
      supplier_type:  s.supplier_type  ?? '',
      contact_name:   s.contact_name   ?? '',
      contact_mobile: s.contact_mobile ?? '',
      contact_email:  s.contact_email  ?? '',
      city:           s.city           ?? '',
      state:          s.state          ?? '',
      credit_days:    s.credit_days != null ? String(s.credit_days) : '',
      payment_terms:  s.payment_terms  ?? '',
      notes:          s.notes          ?? '',
    };
  }

  function set(field, val) {
    setForm(prev => ({ ...prev, [field]: val }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function handleCancel() {
    if (!sup) return;
    setForm(toForm(sup));
    setErrors({});
    setEditing(false);
  }

  async function handleSave() {
    if (!form.supplier_name?.trim()) { setErrors({ supplier_name: 'Name is required.' }); return; }
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/suppliers/master/${id}`, {
      supplier_name:  form.supplier_name.trim(),
      gstin:          form.gstin.trim()         || null,
      supplier_type:  form.supplier_type.trim() || null,
      contact_name:   form.contact_name.trim()  || null,
      contact_mobile: form.contact_mobile.trim()|| null,
      contact_email:  form.contact_email.trim() || null,
      city:           form.city.trim()          || null,
      state:          form.state.trim()         || null,
      credit_days:    form.credit_days ? Number(form.credit_days) : null,
      payment_terms:  form.payment_terms.trim() || null,
      notes:          form.notes.trim()         || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT' || error.code === 'VALIDATION_ERROR') {
        const field = error.message?.includes('GSTIN') ? 'gstin' : 'supplier_name';
        setErrors({ [field]: error.message });
      } else {
        showToast(error.message ?? 'Failed to update.', 'error');
      }
    } else {
      setSup(data);
      setForm(toForm(data));
      setEditing(false);
      showToast('Supplier updated.', 'success');
    }
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/suppliers/master/${id}/toggle-active`, {});
    setToggling(false);
    if (error) showToast(error.message ?? 'Failed to update status.', 'error');
    else { setSup(prev => ({ ...prev, is_active: data.is_active })); showToast(`${data.supplier_code} ${data.is_active ? 'activated' : 'deactivated'}.`, 'success'); }
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!sup)    return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Supplier not found.</div>;

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const roVal = (v) => (
    <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0', minHeight: 22 }}>{v || '—'}</div>
  );
  const inp = (field, opts = {}) => (
    <input
      value={form[field] ?? ''}
      onChange={e => set(field, e.target.value)}
      readOnly={!editing}
      maxLength={opts.max}
      type={opts.type ?? 'text'}
      min={opts.min}
      placeholder={opts.placeholder}
      style={{
        width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
        border: `1px solid ${errors[field] ? '#DC2626' : editing ? '#D1D5DB' : '#E5E7EB'}`,
        borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none',
        background: editing ? '#fff' : '#F9FAFB',
        ...(opts.mono ? { fontFamily: 'monospace', textTransform: 'uppercase' } : {}),
      }}
    />
  );
  const errTxt = (field) => errors[field] && <span style={{ fontSize: 11, color: '#DC2626', marginTop: 3, display: 'block' }}>{errors[field]}</span>;
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 };
  const sectionLabel = (t) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, marginTop: 4 }}>{t}</div>
  );

  return (
    <div style={{ padding: '24px 28px', maxWidth: 620, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/suppliers')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Suppliers
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{sup.supplier_code}</h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
            border: `1px solid ${sup.is_active ? '#059669' : '#D1D5DB'}`,
            color: sup.is_active ? '#059669' : '#6B7280',
            background: sup.is_active ? '#ECFDF5' : '#F9FAFB',
          }}>
            {sup.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Form card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>

        {/* Code — always read-only */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Supplier Code</label>
          <div style={{ height: 38, padding: '0 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 14, color: '#374151', background: '#F9FAFB', display: 'flex', alignItems: 'center', fontFamily: 'monospace' }}>
            {sup.supplier_code}
          </div>
          <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Code cannot be changed after creation.</span>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Supplier Name</label>
          {editing ? inp('supplier_name', { max: 200 }) : roVal(sup.supplier_name)}
          {errTxt('supplier_name')}
        </div>

        {/* GSTIN */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>GSTIN</label>
          {editing ? inp('gstin', { max: 15, mono: true }) : roVal(sup.gstin)}
          {errTxt('gstin')}
        </div>

        {sectionLabel('Contact')}
        <div style={grid2}>
          <div><label style={labelStyle}>Contact person</label>{editing ? inp('contact_name', { max: 100 }) : roVal(sup.contact_name)}</div>
          <div><label style={labelStyle}>Mobile</label>{editing ? inp('contact_mobile', { max: 20 }) : roVal(sup.contact_mobile)}</div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Email</label>
          {editing ? inp('contact_email', { type: 'email', max: 100 }) : roVal(sup.contact_email)}
        </div>

        {sectionLabel('Address')}
        <div style={grid2}>
          <div><label style={labelStyle}>City</label>{editing ? inp('city', { max: 60 }) : roVal(sup.city)}</div>
          <div><label style={labelStyle}>State</label>{editing ? inp('state', { max: 60 }) : roVal(sup.state)}</div>
        </div>

        {sectionLabel('Payment')}
        <div style={grid2}>
          <div><label style={labelStyle}>Credit days</label>{editing ? inp('credit_days', { type: 'number', min: '0' }) : roVal(sup.credit_days != null ? String(sup.credit_days) : null)}</div>
          <div><label style={labelStyle}>Payment terms</label>{editing ? inp('payment_terms', { max: 100 }) : roVal(sup.payment_terms)}</div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Notes</label>
          {editing
            ? <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
            : roVal(sup.notes)}
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{sup.is_active ? 'Deactivate this supplier' : 'Activate this supplier'}</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
            {sup.is_active ? 'Blocked if supplier has linked purchase orders or GRNs.' : 'Supplier will become available for selection.'}
          </div>
        </div>
        <button onClick={handleToggle} disabled={toggling}
          style={{
            height: 34, padding: '0 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: toggling ? 'not-allowed' : 'pointer',
            border:     `1px solid ${sup.is_active ? '#FECACA' : '#BBF7D0'}`,
            background: sup.is_active ? '#FEF2F2' : '#F0FDF4',
            color:      sup.is_active ? '#DC2626' : '#059669',
          }}>
          {toggling ? '…' : sup.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

    </div>
  );
}
