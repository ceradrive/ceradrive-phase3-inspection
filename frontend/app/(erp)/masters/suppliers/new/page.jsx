'use client';

/**
 * CERADRIVE ERP — Create Supplier
 * R45: Only supplier_code and supplier_name are mandatory at go-live.
 * R46: Onboarding under 30 seconds — two required fields at top, optional below fold.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api }       from '../../../../../lib/api.js';
import { useToast }  from '../../../../../components/ui/Toast.jsx';

export default function SupplierNewPage() {
  const router = useRouter();
  const { showToast } = useToast();

  // Mandatory
  const [code,          setCode]          = useState('');
  const [name,          setName]          = useState('');
  // Optional
  const [gstin,         setGstin]         = useState('');
  const [contactName,   setContactName]   = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [contactEmail,  setContactEmail]  = useState('');
  const [city,          setCity]          = useState('');
  const [state,         setState]         = useState('');
  const [creditDays,    setCreditDays]    = useState('');
  const [paymentTerms,  setPaymentTerms]  = useState('');
  const [notes,         setNotes]         = useState('');
  const [showOptional,  setShowOptional]  = useState(false);
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);

  function validate() {
    const errs = {};
    if (!code.trim()) errs.supplier_code = 'Supplier code is required.';
    if (!name.trim()) errs.supplier_name = 'Supplier name is required.';
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/suppliers/master', {
      supplier_code:  code.trim().toUpperCase(),
      supplier_name:  name.trim(),
      gstin:          gstin.trim()         || null,
      contact_name:   contactName.trim()   || null,
      contact_mobile: contactMobile.trim() || null,
      contact_email:  contactEmail.trim()  || null,
      city:           city.trim()          || null,
      state:          state.trim()         || null,
      credit_days:    creditDays ? Number(creditDays) : null,
      payment_terms:  paymentTerms.trim()  || null,
      notes:          notes.trim()         || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT' && error.message?.includes('code')) setErrors({ supplier_code: error.message });
      else if (error.code === 'CONFLICT' && error.message?.includes('GSTIN')) setErrors({ gstin: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.includes('GSTIN')) setErrors({ gstin: error.message });
      else showToast(error.message ?? 'Failed to create supplier.', 'error');
    } else {
      showToast(`Supplier ${data.supplier_code} created.`, 'success');
      router.push('/masters/suppliers');
    }
  }

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
  const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };
  const gridTwo    = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 600, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/suppliers')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Suppliers
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Supplier</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Code and name are required. All other details can be added later.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>

        {/* Mandatory fields */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Supplier Code *</label>
          <input value={code} onChange={e => { setCode(e.target.value); setErrors(p => ({ ...p, supplier_code: undefined })); }}
            placeholder="e.g. SUP001" maxLength={30}
            style={{ ...inputStyle(errors.supplier_code), textTransform: 'uppercase', fontFamily: 'monospace' }} />
          {errors.supplier_code
            ? <span style={errStyle}>{errors.supplier_code}</span>
            : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Stored uppercase.</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Supplier Name *</label>
          <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, supplier_name: undefined })); }}
            placeholder="e.g. ABC Industries Pvt Ltd" maxLength={200}
            style={inputStyle(errors.supplier_name)} />
          {errors.supplier_name && <span style={errStyle}>{errors.supplier_name}</span>}
        </div>

        {/* Optional toggle */}
        <button
          type="button"
          onClick={() => setShowOptional(v => !v)}
          style={{ background: 'none', border: 'none', color: '#4F46E5', fontSize: 13, cursor: 'pointer', padding: '0 0 16px 0', fontWeight: 500 }}
        >
          {showOptional ? '▲ Hide optional details' : '▼ Add optional details (GSTIN, contact, address…)'}
        </button>

        {showOptional && (
          <>
            {/* GSTIN */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>GSTIN</label>
              <input value={gstin} onChange={e => { setGstin(e.target.value); setErrors(p => ({ ...p, gstin: undefined })); }}
                placeholder="e.g. 22AAAAA0000A1Z5" maxLength={15}
                style={{ ...inputStyle(errors.gstin), textTransform: 'uppercase', fontFamily: 'monospace' }} />
              {errors.gstin
                ? <span style={errStyle}>{errors.gstin}</span>
                : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>15 characters. Optional.</span>}
            </div>

            {/* Contact */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact</span>
            </div>
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>Contact person</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Mobile</label>
                <input value={contactMobile} onChange={e => setContactMobile(e.target.value)} placeholder="+91 98765 43210" style={inputStyle()} />
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Email</label>
              <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="supplier@example.com" type="email" style={inputStyle()} />
            </div>

            {/* Address */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Address</span>
            </div>
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>City</label>
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="Mumbai" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>State</label>
                <input value={state} onChange={e => setState(e.target.value)} placeholder="Maharashtra" style={inputStyle()} />
              </div>
            </div>

            {/* Payment */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Payment</span>
            </div>
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>Credit days</label>
                <input value={creditDays} onChange={e => setCreditDays(e.target.value)} type="number" min="0" placeholder="30" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Payment terms</label>
                <input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="Net 30" style={inputStyle()} />
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Optional notes…"
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
            </div>
          </>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: showOptional ? 0 : 8 }}>
          <button onClick={() => router.push('/masters/suppliers')}
            style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Create Supplier'}
          </button>
        </div>

      </div>
    </div>
  );
}
