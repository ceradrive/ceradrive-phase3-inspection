'use client';

/**
 * CERADRIVE ERP — Customer Detail / Edit
 * Inline edit. customer_code immutable after creation.
 * Toggle active / inactive.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api }                  from '../../../../../lib/api.js';
import { useToast }             from '../../../../../components/ui/Toast.jsx';

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

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const id = params.id;

  const [cust,     setCust]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get(`/api/v1/customers/master/${id}`).then(({ data, error }) => {
      if (error || !data) { showToast('Customer not found.', 'error'); }
      else { setCust(data); setForm(toForm(data)); }
      setLoading(false);
    });
  }, [id, showToast]);

  function toForm(c) {
    return {
      customer_name:       c.customer_name       ?? '',
      customer_type:       c.customer_type       ?? '',
      assigned_price_list_id:    c.assigned_price_list_id ?? '',
      assigned_price_list_label: c.price_list_headers ? `${c.price_list_headers.price_list_code} — ${c.price_list_headers.price_list_name}` : '',
      gstin:               c.gstin               ?? '',
      pan:                 c.pan                 ?? '',
      contact_name:        c.contact_name        ?? '',
      contact_mobile:      c.contact_mobile      ?? '',
      contact_email:       c.contact_email       ?? '',
      address_line1:       c.address_line1       ?? '',
      address_line2:       c.address_line2       ?? '',
      city:                c.city                ?? '',
      state:               c.state               ?? '',
      pincode:             c.pincode             ?? '',
      country:             c.country             ?? '',
      credit_days:         c.credit_days  != null ? String(c.credit_days)  : '',
      credit_limit:        c.credit_limit != null ? String(c.credit_limit) : '',
      gst_certificate_url: c.gst_certificate_url ?? '',
      pan_card_url:        c.pan_card_url        ?? '',
      notes:               c.notes               ?? '',
    };
  }

  function set(field, val) {
    setForm(prev => ({ ...prev, [field]: val }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function handleCancel() {
    if (!cust) return;
    setForm(toForm(cust));
    setErrors({});
    setEditing(false);
  }

  async function handleSave() {
    if (!form.customer_name?.trim()) { setErrors({ customer_name: 'Name is required.' }); return; }
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/customers/master/${id}`, {
      customer_name:       form.customer_name.trim(),
      customer_type:       form.customer_type.trim()       || null,
      assigned_price_list_id: form.assigned_price_list_id || null,
      gstin:               form.gstin.trim()               || null,
      pan:                 form.pan.trim()                 || null,
      contact_name:        form.contact_name.trim()        || null,
      contact_mobile:      form.contact_mobile.trim()      || null,
      contact_email:       form.contact_email.trim()       || null,
      address_line1:       form.address_line1.trim()       || null,
      address_line2:       form.address_line2.trim()       || null,
      city:                form.city.trim()                || null,
      state:               form.state.trim()               || null,
      pincode:             form.pincode.trim()             || null,
      country:             form.country.trim()             || null,
      credit_days:         form.credit_days  ? Number(form.credit_days)  : null,
      credit_limit:        form.credit_limit ? Number(form.credit_limit) : null,
      gst_certificate_url: form.gst_certificate_url.trim() || null,
      pan_card_url:        form.pan_card_url.trim()        || null,
      notes:               form.notes.trim()               || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT' || error.code === 'VALIDATION_ERROR') {
        const field = error.message?.includes('GSTIN') ? 'gstin'
                    : error.message?.includes('PAN')   ? 'pan'
                    : 'customer_name';
        setErrors({ [field]: error.message });
      } else {
        showToast(error.message ?? 'Failed to update.', 'error');
      }
    } else {
      setCust(data);
      setForm(toForm(data));
      setEditing(false);
      showToast('Customer updated.', 'success');
    }
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/customers/master/${id}/toggle-active`, {});
    setToggling(false);
    if (error) showToast(error.message ?? 'Failed to update status.', 'error');
    else { setCust(prev => ({ ...prev, is_active: data.is_active })); showToast(`${data.customer_code} ${data.is_active ? 'activated' : 'deactivated'}.`, 'success'); }
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!cust)   return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Customer not found.</div>;

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
        <button onClick={() => router.push('/masters/customers')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Customers
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0, fontFamily: 'monospace' }}>{cust.customer_code}</h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500,
            border: `1px solid ${cust.is_active ? '#059669' : '#D1D5DB'}`,
            color: cust.is_active ? '#059669' : '#6B7280',
            background: cust.is_active ? '#ECFDF5' : '#F9FAFB',
          }}>
            {cust.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Form card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>

        {/* Code — always read-only */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Customer Code</label>
          <div style={{ height: 38, padding: '0 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 14, color: '#374151', background: '#F9FAFB', display: 'flex', alignItems: 'center', fontFamily: 'monospace' }}>
            {cust.customer_code}
          </div>
          <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, display: 'block' }}>Code cannot be changed after creation.</span>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Customer Name</label>
          {editing ? inp('customer_name', { max: 200 }) : roVal(cust.customer_name)}
          {errTxt('customer_name')}
        </div>

        {/* Type */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Customer type</label>
          {editing ? inp('customer_type', { max: 50 }) : roVal(cust.customer_type)}
        </div>

        {/* Tax IDs */}
        <div style={grid2}>
          <div>
            <label style={labelStyle}>GSTIN</label>
            {editing ? inp('gstin', { max: 15, mono: true }) : roVal(cust.gstin)}
            {errTxt('gstin')}
          </div>
          <div>
            <label style={labelStyle}>PAN</label>
            {editing ? inp('pan', { max: 10, mono: true }) : roVal(cust.pan)}
            {errTxt('pan')}
          </div>
        </div>

        {sectionLabel('Contact')}
        <div style={grid2}>
          <div><label style={labelStyle}>Contact person</label>{editing ? inp('contact_name', { max: 100 }) : roVal(cust.contact_name)}</div>
          <div><label style={labelStyle}>Mobile</label>{editing ? inp('contact_mobile', { max: 20 }) : roVal(cust.contact_mobile)}</div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Email</label>
          {editing ? inp('contact_email', { type: 'email', max: 100 }) : roVal(cust.contact_email)}
        </div>

        {sectionLabel('Address')}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Address line 1</label>
          {editing ? inp('address_line1', { max: 200 }) : roVal(cust.address_line1)}
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Address line 2</label>
          {editing ? inp('address_line2', { max: 200 }) : roVal(cust.address_line2)}
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>City</label>{editing ? inp('city', { max: 60 }) : roVal(cust.city)}</div>
          <div><label style={labelStyle}>State</label>{editing ? inp('state', { max: 60 }) : roVal(cust.state)}</div>
        </div>
        <div style={grid2}>
          <div><label style={labelStyle}>Pincode</label>{editing ? inp('pincode', { max: 10 }) : roVal(cust.pincode)}</div>
          <div><label style={labelStyle}>Country</label>{editing ? inp('country', { max: 60 }) : roVal(cust.country)}</div>
        </div>

        {sectionLabel('Payment')}
        <div style={grid2}>
          <div><label style={labelStyle}>Credit days</label>{editing ? inp('credit_days', { type: 'number', min: '0' }) : roVal(cust.credit_days != null ? String(cust.credit_days) : null)}</div>
          <div><label style={labelStyle}>Credit limit (₹)</label>{editing ? inp('credit_limit', { type: 'number', min: '0' }) : roVal(cust.credit_limit != null ? String(cust.credit_limit) : null)}</div>
        </div>

        {sectionLabel('Pricing')}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Assigned price list</label>
          {editing
            ? <PriceListPicker valueId={form.assigned_price_list_id} valueLabel={form.assigned_price_list_label} editing={true}
                onPick={p => setForm(prev => ({ ...prev, assigned_price_list_id: p?.id ?? '', assigned_price_list_label: p ? `${p.price_list_code} — ${p.price_list_name}` : '' }))} />
            : roVal(cust.price_list_headers ? `${cust.price_list_headers.price_list_code} — ${cust.price_list_headers.price_list_name}` : null)}
        </div>

        {sectionLabel('Documents (URL)')}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>GST certificate URL</label>
          {editing ? inp('gst_certificate_url', { max: 500 }) : roVal(cust.gst_certificate_url)}
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>PAN card URL</label>
          {editing ? inp('pan_card_url', { max: 500 }) : roVal(cust.pan_card_url)}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Notes</label>
          {editing
            ? <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#374151', resize: 'vertical', outline: 'none' }} />
            : roVal(cust.notes)}
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{cust.is_active ? 'Deactivate this customer' : 'Activate this customer'}</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
            {cust.is_active ? 'Customer will no longer be available for selection.' : 'Customer will become available for selection.'}
          </div>
        </div>
        <button onClick={handleToggle} disabled={toggling}
          style={{
            height: 34, padding: '0 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: toggling ? 'not-allowed' : 'pointer',
            border:     `1px solid ${cust.is_active ? '#FECACA' : '#BBF7D0'}`,
            background: cust.is_active ? '#FEF2F2' : '#F0FDF4',
            color:      cust.is_active ? '#DC2626' : '#059669',
          }}>
          {toggling ? '…' : cust.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

    </div>
  );
}
