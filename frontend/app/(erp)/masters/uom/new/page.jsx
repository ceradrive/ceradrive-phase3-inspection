'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const wrap      = { padding: 24, maxWidth: 560, margin: '0 auto' };
const h1        = { fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 18px' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 };
const errStyle  = { display: 'block', fontSize: 12, color: '#DC2626', marginTop: 4 };
const btn       = { background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: 14, cursor: 'pointer' };
const cancel    = { background: 'none', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, padding: '9px 16px', fontSize: 14, cursor: 'pointer', textDecoration: 'none' };

function inputStyle(hasError) {
  return { width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
    border: `1px solid ${hasError ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' };
}

export default function UomNewPage() {
  const router = useRouter();
  const toast  = useToast();

  const [code, setCode]       = useState('');
  const [name, setName]       = useState('');
  const [decimals, setDecimals] = useState('2');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);

  function validate() {
    const e = {};
    if (!code.trim()) e.uom_code = 'UOM code is required.';
    if (!name.trim()) e.uom_name = 'UOM name is required.';
    const n = Number(decimals);
    if (decimals === '' || !Number.isInteger(n) || n < 0) e.decimal_places = 'Decimal places must be an integer of 0 or greater.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const { data, error } = await api.post('/api/v1/uoms/master', {
      uom_code: code.trim().toUpperCase(),
      uom_name: name.trim(),
      decimal_places: Number(decimals),
      is_active: isActive,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') { setErrors(p => ({ ...p, uom_code: error.message })); return; }
      toast(error.message || 'Failed to create UOM.');
      return;
    }
    toast('UOM created.');
    router.push(`/masters/uom/${data.id}`);
  }

  return (
    <div style={wrap}>
      <h1 style={h1}>New UOM</h1>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>UOM Code *</label>
        <input value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, uom_code: undefined })); }}
          placeholder="e.g. KG" maxLength={20}
          style={{ ...inputStyle(errors.uom_code), fontFamily: 'monospace', textTransform: 'uppercase' }} />
        {errors.uom_code && <span style={errStyle}>{errors.uom_code}</span>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>UOM Name *</label>
        <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, uom_name: undefined })); }}
          placeholder="e.g. Kilogram" maxLength={100} style={inputStyle(errors.uom_name)} />
        {errors.uom_name && <span style={errStyle}>{errors.uom_name}</span>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Decimal Places *</label>
        <input type="number" min={0} step={1} value={decimals}
          onChange={e => { setDecimals(e.target.value); setErrors(p => ({ ...p, decimal_places: undefined })); }}
          style={inputStyle(errors.decimal_places)} />
        {errors.decimal_places && <span style={errStyle}>{errors.decimal_places}</span>}
      </div>

      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id="active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        <label htmlFor="active" style={{ fontSize: 14, color: '#374151' }}>Active</label>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create UOM'}</button>
        <Link href="/masters/uom" style={cancel}>Cancel</Link>
      </div>
    </div>
  );
}
