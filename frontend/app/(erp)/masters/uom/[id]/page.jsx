'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const wrap       = { padding: 24, maxWidth: 560, margin: '0 auto' };
const h1         = { fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 4px' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 };
const errStyle   = { display: 'block', fontSize: 12, color: '#DC2626', marginTop: 4 };
const roStyle    = { fontSize: 15, color: '#111827', padding: '8px 0' };
const codeStyle  = { fontSize: 15, color: '#111827', padding: '8px 0', fontFamily: 'monospace', fontWeight: 600 };
const btn        = { background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: 14, cursor: 'pointer' };
const cancel     = { background: 'none', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, padding: '9px 16px', fontSize: 14, cursor: 'pointer' };

function editStyle(hasError) {
  return { width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
    border: `1px solid ${hasError ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' };
}

export default function UomDetailPage() {
  const { id } = useParams();
  const toast  = useToast();

  const [uom, setUom]       = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName]     = useState('');
  const [decimals, setDecimals] = useState('2');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get(`/api/v1/uoms/master/${id}`);
    if (error || !data) { toast('Failed to load UOM.'); setLoading(false); return; }
    setUom(data);
    setName(data.uom_name ?? '');
    setDecimals(String(data.decimal_places ?? '2'));
    setLoading(false);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  function validate() {
    const e = {};
    if (!name.trim()) e.uom_name = 'UOM name is required.';
    const n = Number(decimals);
    if (decimals === '' || !Number.isInteger(n) || n < 0) e.decimal_places = 'Decimal places must be an integer of 0 or greater.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const { error } = await api.patch(`/api/v1/uoms/master/${id}`, {
      uom_name: name.trim(),
      decimal_places: Number(decimals),
    });
    setSaving(false);
    if (error) { toast(error.message || 'Failed to save.'); return; }
    toast('UOM updated.');
    setEditing(false);
    load();
  }

  async function toggle() {
    const { error } = await api.post(`/api/v1/uoms/master/${id}/toggle-active`, { is_active: !uom.is_active });
    if (error) { toast('Failed to update status.'); return; }
    toast(`UOM ${!uom.is_active ? 'activated' : 'deactivated'}.`);
    load();
  }

  if (loading) return <div style={wrap}>Loading…</div>;
  if (!uom)    return <div style={wrap}>UOM not found. <Link href="/masters/uom">Back</Link></div>;

  return (
    <div style={wrap}>
      <h1 style={h1}>{uom.uom_name}</h1>
      <div style={{ marginBottom: 18 }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
          color: uom.is_active ? '#059669' : '#9CA3AF', background: uom.is_active ? '#ECFDF5' : '#F3F4F6' }}>
          {uom.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>UOM Code</label>
        <div style={codeStyle}>{uom.uom_code}</div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>UOM Name</label>
        {editing
          ? <><input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, uom_name: undefined })); }}
              maxLength={100} style={editStyle(errors.uom_name)} />
            {errors.uom_name && <span style={errStyle}>{errors.uom_name}</span>}</>
          : <div style={roStyle}>{uom.uom_name}</div>}
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Decimal Places</label>
        {editing
          ? <><input type="number" min={0} step={1} value={decimals}
              onChange={e => { setDecimals(e.target.value); setErrors(p => ({ ...p, decimal_places: undefined })); }}
              style={editStyle(errors.decimal_places)} />
            {errors.decimal_places && <span style={errStyle}>{errors.decimal_places}</span>}</>
          : <div style={roStyle}>{uom.decimal_places}</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {editing
          ? <>
              <button onClick={save} disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setName(uom.uom_name); setDecimals(String(uom.decimal_places)); setErrors({}); }} style={cancel}>Cancel</button>
            </>
          : <>
              <button onClick={() => setEditing(true)} style={btn}>Edit</button>
              <button onClick={toggle} style={{ ...cancel, color: uom.is_active ? '#DC2626' : '#059669' }}>
                {uom.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <Link href="/masters/uom" style={{ ...cancel, textDecoration: 'none', marginLeft: 'auto' }}>Back</Link>
            </>}
      </div>
    </div>
  );
}
