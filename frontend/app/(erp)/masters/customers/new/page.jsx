'use client';

/**
 * CERADRIVE ERP — Create Customer
 * R45: Only customer_code and customer_name are mandatory at go-live.
 * R46: Onboarding under 30 seconds — two required fields at top, optional below fold.
 *
 * GSTIN / PAN validated only if entered. Document URLs are plain text fields (no upload).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api }       from '../../../../../lib/api.js';
import { useToast }  from '../../../../../components/ui/Toast.jsx';

function PriceListPicker({ valueId, valueLabel, editing, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/price-lists/search', { search: q, limit: 20 });
      if (!cancelled) setResults(data ?? []);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);
  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const box = { width: '100%', minHeight: 38, padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, color: valueLabel ? '#111827' : '#9CA3AF', background: editing ? '#fff' : '#F9FAFB' };
  if (!editing) return <div style={box}>{valueLabel || '—'}</div>;
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)} style={{ ...box, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valueLabel || 'Select price list…'}</span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: 42, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          <div onClick={() => { onPick(null); setOpen(false); }} style={{ padding: '8px 10px', fontSize: 13, color: '#6B7280', cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>— None —</div>
          {results.map(p => (
            <div key={p.id} onClick={() => { onPick(p); setOpen(false); setQ(''); }}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6', background: p.id === valueId ? '#EEF2FF' : '#fff' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#111827' }}>{p.price_list_code}</span>
              <span style={{ color: '#6B7280', marginLeft: 8 }}>{p.price_list_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomerNewPage() {
  const router = useRouter();
  const toast = useToast();
  const showToast = (message, type = 'info') => {
    if (typeof toast === 'function') return toast(message, type);
    if (typeof toast?.showToast === 'function') return toast.showToast(message, type);
    if (typeof toast?.toast === 'function') return toast.toast(message, type);
    if (type === 'success' && typeof toast?.success === 'function') return toast.success(message);
    if (type === 'error' && typeof toast?.error === 'function') return toast.error(message);
    if (typeof toast?.addToast === 'function') return toast.addToast({ message, type });
    if (type === 'error') console.error(message);
    else console.log(message);
  };

  // Mandatory
  const [code,          setCode]          = useState('');
  const [name,          setName]          = useState('');
  // Optional
  const [customerType,  setCustomerType]  = useState('');
  const [gstin,         setGstin]         = useState('');
  const [pan,           setPan]           = useState('');
  const [contactName,   setContactName]   = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [contactEmail,  setContactEmail]  = useState('');
  const [addressLine1,  setAddressLine1]  = useState('');
  const [addressLine2,  setAddressLine2]  = useState('');
  const [city,          setCity]          = useState('');
  const [state,         setState]         = useState('');
  const [pincode,       setPincode]       = useState('');
  const [country,       setCountry]       = useState('');
  const [creditDays,    setCreditDays]    = useState('');
  const [creditLimit,   setCreditLimit]   = useState('');
  const [gstCertUrl,    setGstCertUrl]    = useState('');
  const [panCardUrl,    setPanCardUrl]    = useState('');
  const [notes,         setNotes]         = useState('');
  const [showOptional,  setShowOptional]  = useState(false);
  const [plId,          setPlId]          = useState('');
  const [plLabel,       setPlLabel]       = useState('');
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);

  function validate() {
    const errs = {};
    if (!code.trim()) errs.customer_code = 'Customer code is required.';
    if (!name.trim()) errs.customer_name = 'Customer name is required.';
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/customers/master', {
      customer_code:       code.trim().toUpperCase(),
      customer_name:       name.trim(),
      customer_type:       customerType.trim() || null,
      gstin:               gstin.trim()        || null,
      pan:                 pan.trim()          || null,
      contact_name:        contactName.trim()  || null,
      contact_mobile:      contactMobile.trim()|| null,
      contact_email:       contactEmail.trim() || null,
      address_line1:       addressLine1.trim() || null,
      address_line2:       addressLine2.trim() || null,
      city:                city.trim()         || null,
      state:               state.trim()        || null,
      pincode:             pincode.trim()      || null,
      country:             country.trim()      || null,
      credit_days:         creditDays  ? Number(creditDays)  : null,
      credit_limit:        creditLimit ? Number(creditLimit) : null,
      gst_certificate_url: gstCertUrl.trim()   || null,
      pan_card_url:        panCardUrl.trim()   || null,
      notes:               notes.trim()        || null,
      assigned_price_list_id: plId || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT' && error.message?.includes('code')) setErrors({ customer_code: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.includes('GSTIN')) setErrors({ gstin: error.message });
      else if (error.code === 'VALIDATION_ERROR' && error.message?.includes('PAN')) setErrors({ pan: error.message });
      else showToast(error.message ?? 'Failed to create customer.', 'error');
    } else {
      showToast(`Customer ${data.customer_code} created.`, 'success');
      router.push('/masters/customers');
    }
  }

  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
  const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
  const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };
  const gridTwo    = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 600, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/customers')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Customers
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New Customer</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Code and name are required. All other details can be added later.</p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24 }}>

        {/* Mandatory fields */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Customer Code *</label>
          <input value={code} onChange={e => { setCode(e.target.value); setErrors(p => ({ ...p, customer_code: undefined })); }}
            placeholder="e.g. CUST001" maxLength={30}
            style={{ ...inputStyle(errors.customer_code), textTransform: 'uppercase', fontFamily: 'monospace' }} />
          {errors.customer_code
            ? <span style={errStyle}>{errors.customer_code}</span>
            : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Stored uppercase.</span>}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Customer Name *</label>
          <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, customer_name: undefined })); }}
            placeholder="e.g. ABC Motors Pvt Ltd" maxLength={200}
            style={inputStyle(errors.customer_name)} />
          {errors.customer_name && <span style={errStyle}>{errors.customer_name}</span>}
        </div>

        {/* Optional toggle */}
        <button
          type="button"
          onClick={() => setShowOptional(v => !v)}
          style={{ background: 'none', border: 'none', color: '#4F46E5', fontSize: 13, cursor: 'pointer', padding: '0 0 16px 0', fontWeight: 500 }}
        >
          {showOptional ? '▲ Hide optional details' : '▼ Add optional details (GSTIN, PAN, contact, address…)'}
        </button>

        {showOptional && (
          <>
            {/* Price list */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Assigned price list</label>
              <PriceListPicker valueId={plId} valueLabel={plLabel} editing={true}
                onPick={p => { setPlId(p?.id ?? ''); setPlLabel(p ? `${p.price_list_code} — ${p.price_list_name}` : ''); }} />
            </div>
            {/* Tax IDs */}
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>GSTIN</label>
                <input value={gstin} onChange={e => { setGstin(e.target.value); setErrors(p => ({ ...p, gstin: undefined })); }}
                  placeholder="e.g. 22AAAAA0000A1Z5" maxLength={15}
                  style={{ ...inputStyle(errors.gstin), textTransform: 'uppercase', fontFamily: 'monospace' }} />
                {errors.gstin
                  ? <span style={errStyle}>{errors.gstin}</span>
                  : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>15 characters. Optional.</span>}
              </div>
              <div>
                <label style={labelStyle}>PAN</label>
                <input value={pan} onChange={e => { setPan(e.target.value); setErrors(p => ({ ...p, pan: undefined })); }}
                  placeholder="e.g. ABCDE1234F" maxLength={10}
                  style={{ ...inputStyle(errors.pan), textTransform: 'uppercase', fontFamily: 'monospace' }} />
                {errors.pan
                  ? <span style={errStyle}>{errors.pan}</span>
                  : <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>10 characters. Optional.</span>}
              </div>
            </div>

            {/* Customer type */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Customer type</label>
              <input value={customerType} onChange={e => setCustomerType(e.target.value)} placeholder="e.g. Distributor, OEM" maxLength={50} style={inputStyle()} />
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
              <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="customer@example.com" type="email" style={inputStyle()} />
            </div>

            {/* Address */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Address</span>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Address line 1</label>
              <input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="Street, building" style={inputStyle()} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Address line 2</label>
              <input value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Area, landmark" style={inputStyle()} />
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
            <div style={gridTwo}>
              <div>
                <label style={labelStyle}>Pincode</label>
                <input value={pincode} onChange={e => setPincode(e.target.value)} placeholder="400001" maxLength={10} style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Country</label>
                <input value={country} onChange={e => setCountry(e.target.value)} placeholder="India" style={inputStyle()} />
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
                <label style={labelStyle}>Credit limit (₹)</label>
                <input value={creditLimit} onChange={e => setCreditLimit(e.target.value)} type="number" min="0" placeholder="100000" style={inputStyle()} />
              </div>
            </div>

            {/* Documents */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Documents (URL)</span>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>GST certificate URL</label>
              <input value={gstCertUrl} onChange={e => setGstCertUrl(e.target.value)} placeholder="https://…" style={inputStyle()} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>PAN card URL</label>
              <input value={panCardUrl} onChange={e => setPanCardUrl(e.target.value)} placeholder="https://…" style={inputStyle()} />
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
          <button onClick={() => router.push('/masters/customers')}
            style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
            {saving ? 'Saving…' : 'Create Customer'}
          </button>
        </div>

      </div>
    </div>
  );
}
