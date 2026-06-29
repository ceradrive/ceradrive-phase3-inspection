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
function areaStyle(hasError) {
  return { width: '100%', minHeight: 72, padding: '8px 10px', boxSizing: 'border-box', resize: 'vertical',
    border: `1px solid ${hasError ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none', fontFamily: 'inherit' };
}

export default function ItemCategoryNewPage() {
  const router = useRouter();
  const toast  = useToast();

  const [code, setCode]       = useState('');
  const [name, setName]       = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);

  function validate() {
    const e = {};
    if (!code.trim()) e.category_code = 'Category code is required.';
    if (!name.trim()) e.category_name = 'Category name is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const { data, error } = await api.post('/api/v1/item-categories/master', {
      category_code: code.trim().toUpperCase(),
      category_name: name.trim(),
      description: description.trim() || null,
      is_active: isActive,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') { setErrors(p => ({ ...p, category_code: error.message })); return; }
      toast(error.message || 'Failed to create category.');
      return;
    }
    toast('Category created.');
    router.push(`/masters/item-categories/${data.id}`);
  }

  return (
    <div style={wrap}>
      <h1 style={h1}>New Item Category</h1>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Category Code *</label>
        <input value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setErrors(p => ({ ...p, category_code: undefined })); }}
          placeholder="e.g. RM_FRICTION" maxLength={40}
          style={{ ...inputStyle(errors.category_code), fontFamily: 'monospace', textTransform: 'uppercase' }} />
        {errors.category_code && <span style={errStyle}>{errors.category_code}</span>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Category Name *</label>
        <input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, category_name: undefined })); }}
          placeholder="e.g. Friction Raw Materials" maxLength={120} style={inputStyle(errors.category_name)} />
        {errors.category_name && <span style={errStyle}>{errors.category_name}</span>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Optional" style={areaStyle(false)} />
      </div>

      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id="active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        <label htmlFor="active" style={{ fontSize: 14, color: '#374151' }}>Active</label>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create Category'}</button>
        <Link href="/masters/item-categories" style={cancel}>Cancel</Link>
      </div>
    </div>
  );
}
