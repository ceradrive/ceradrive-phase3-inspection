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

const FLAGS = [
  ['is_purchasable', 'Purchasable'],
  ['is_sellable', 'Sellable'],
  ['is_manufactured', 'Manufactured'],
  ['is_stocked', 'Stocked'],
  ['is_batch_tracked', 'Batch tracked'],
  ['is_service', 'Service'],
];

function editStyle(hasError) {
  return { width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
    border: `1px solid ${hasError ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' };
}
function areaStyle() {
  return { width: '100%', minHeight: 72, padding: '8px 10px', boxSizing: 'border-box', resize: 'vertical',
    border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none', fontFamily: 'inherit' };
}
function pickFlags(src) {
  const out = {};
  for (const [k] of FLAGS) out[k] = Boolean(src?.[k]);
  return out;
}

export default function ItemTypeDetailPage() {
  const { id } = useParams();
  const toast  = useToast();

  const [type, setType]     = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName]     = useState('');
  const [description, setDescription] = useState('');
  const [flags, setFlags]   = useState(pickFlags(null));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get(`/api/v1/item-types/master/${id}`);
    if (error || !data) { toast('Failed to load item type.'); setLoading(false); return; }
    setType(data);
    setName(data.type_name ?? '');
    setDescription(data.description ?? '');
    setFlags(pickFlags(data));
    setLoading(false);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  function setFlag(key, val) { setFlags(p => ({ ...p, [key]: val })); }

  function validate() {
    const e = {};
    if (!name.trim()) e.type_name = 'Item type name is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const { error } = await api.patch(`/api/v1/item-types/master/${id}`, {
      type_name: name.trim(),
      description: description.trim() || null,
      ...flags,
    });
    setSaving(false);
    if (error) { toast(error.message || 'Failed to save.'); return; }
    toast('Item type updated.');
    setEditing(false);
    load();
  }

  async function toggle() {
    const { error } = await api.post(`/api/v1/item-types/master/${id}/toggle-active`, { is_active: !type.is_active });
    if (error) { toast('Failed to update status.'); return; }
    toast(`Item type ${!type.is_active ? 'activated' : 'deactivated'}.`);
    load();
  }

  function cancelEdit() {
    setEditing(false);
    setName(type.type_name);
    setDescription(type.description ?? '');
    setFlags(pickFlags(type));
    setErrors({});
  }

  if (loading) return <div style={wrap}>Loading…</div>;
  if (!type)   return <div style={wrap}>Item type not found. <Link href="/masters/item-types">Back</Link></div>;

  return (
    <div style={wrap}>
      <h1 style={h1}>{type.type_name}</h1>
      <div style={{ marginBottom: 18 }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
          color: type.is_active ? '#059669' : '#9CA3AF', background: type.is_active ? '#ECFDF5' : '#F3F4F6' }}>
          {type.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Type Code</label>
        <div style={codeStyle}>{type.type_code}</div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Type Name</label>
        {editing
          ? <><input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, type_name: undefined })); }}
              maxLength={120} style={editStyle(errors.type_name)} />
            {errors.type_name && <span style={errStyle}>{errors.type_name}</span>}</>
          : <div style={roStyle}>{type.type_name}</div>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Description</label>
        {editing
          ? <textarea value={description} onChange={e => setDescription(e.target.value)} style={areaStyle()} />
          : <div style={roStyle}>{type.description || '—'}</div>}
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Business Flags</label>
        {editing
          ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: 6 }}>
              {FLAGS.map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151' }}>
                  <input type="checkbox" checked={flags[key]} onChange={e => setFlag(key, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          : <div style={roStyle}>{FLAGS.filter(([k]) => type[k]).map(([, l]) => l).join(', ') || '—'}</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {editing
          ? <>
              <button onClick={save} disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={cancelEdit} style={cancel}>Cancel</button>
            </>
          : <>
              <button onClick={() => setEditing(true)} style={btn}>Edit</button>
              <button onClick={toggle} style={{ ...cancel, color: type.is_active ? '#DC2626' : '#059669' }}>
                {type.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <Link href="/masters/item-types" style={{ ...cancel, textDecoration: 'none', marginLeft: 'auto' }}>Back</Link>
            </>}
      </div>
    </div>
  );
}
