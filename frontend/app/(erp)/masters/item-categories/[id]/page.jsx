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
function areaStyle(hasError) {
  return { width: '100%', minHeight: 72, padding: '8px 10px', boxSizing: 'border-box', resize: 'vertical',
    border: `1px solid ${hasError ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none', fontFamily: 'inherit' };
}

export default function ItemCategoryDetailPage() {
  const { id } = useParams();
  const toast  = useToast();

  const [cat, setCat]       = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName]     = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await api.get(`/api/v1/item-categories/master/${id}`);
    if (error || !data) { toast('Failed to load category.'); setLoading(false); return; }
    setCat(data);
    setName(data.category_name ?? '');
    setDescription(data.description ?? '');
    setLoading(false);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  function validate() {
    const e = {};
    if (!name.trim()) e.category_name = 'Category name is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const { error } = await api.patch(`/api/v1/item-categories/master/${id}`, {
      category_name: name.trim(),
      description: description.trim() || null,
    });
    setSaving(false);
    if (error) { toast(error.message || 'Failed to save.'); return; }
    toast('Category updated.');
    setEditing(false);
    load();
  }

  async function toggle() {
    const { error } = await api.post(`/api/v1/item-categories/master/${id}/toggle-active`, { is_active: !cat.is_active });
    if (error) { toast('Failed to update status.'); return; }
    toast(`Category ${!cat.is_active ? 'activated' : 'deactivated'}.`);
    load();
  }

  if (loading) return <div style={wrap}>Loading…</div>;
  if (!cat)    return <div style={wrap}>Category not found. <Link href="/masters/item-categories">Back</Link></div>;

  return (
    <div style={wrap}>
      <h1 style={h1}>{cat.category_name}</h1>
      <div style={{ marginBottom: 18 }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
          color: cat.is_active ? '#059669' : '#9CA3AF', background: cat.is_active ? '#ECFDF5' : '#F3F4F6' }}>
          {cat.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Category Code</label>
        <div style={codeStyle}>{cat.category_code}</div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Category Name</label>
        {editing
          ? <><input value={name} onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, category_name: undefined })); }}
              maxLength={120} style={editStyle(errors.category_name)} />
            {errors.category_name && <span style={errStyle}>{errors.category_name}</span>}</>
          : <div style={roStyle}>{cat.category_name}</div>}
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Description</label>
        {editing
          ? <textarea value={description} onChange={e => setDescription(e.target.value)} style={areaStyle(false)} />
          : <div style={roStyle}>{cat.description || '—'}</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {editing
          ? <>
              <button onClick={save} disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setName(cat.category_name); setDescription(cat.description ?? ''); setErrors({}); }} style={cancel}>Cancel</button>
            </>
          : <>
              <button onClick={() => setEditing(true)} style={btn}>Edit</button>
              <button onClick={toggle} style={{ ...cancel, color: cat.is_active ? '#DC2626' : '#059669' }}>
                {cat.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <Link href="/masters/item-categories" style={{ ...cancel, textDecoration: 'none', marginLeft: 'auto' }}>Back</Link>
            </>}
      </div>
    </div>
  );
}
