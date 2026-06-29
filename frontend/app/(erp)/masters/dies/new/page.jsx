'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';

const ctrl = { height: 36, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', width: '100%' };
const lbl = { fontSize: 12, fontWeight: 700, color: '#374151' };

export default function NewDiePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    die_code: '',
    die_name: '',
    num_impressions: '4',
    die_type: 'MOULDING',
    status: 'active',
    is_active: true,
    material: '',
    notes: '',
  });

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    const { data, error } = await api.post('/api/v1/dies/master', form);
    setSaving(false);
    if (error) { alert(error.message || 'Failed to save die'); return; }
    router.push(`/masters/dies/${data.id}`);
  }

  return (
    <div style={{ padding: 28, maxWidth: 760 }}>
      <button onClick={() => router.push('/masters/dies')} style={{ border: 0, background: 'none', color: '#6B7280' }}>← Die Master</button>
      <h1>New Die</h1>

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={lbl}>Die Code<input value={form.die_code} onChange={e => set('die_code', e.target.value.toUpperCase())} style={ctrl} /></label>
        <label style={lbl}>Die Name<input value={form.die_name} onChange={e => set('die_name', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Cavity / Impressions<input type="number" value={form.num_impressions} onChange={e => set('num_impressions', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Die Type<input value={form.die_type} onChange={e => set('die_type', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Material<input value={form.material} onChange={e => set('material', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Status<select value={form.status} onChange={e => set('status', e.target.value)} style={ctrl}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></select></label>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /> Active</label>
        <label style={lbl}>Notes<input value={form.notes} onChange={e => set('notes', e.target.value)} style={ctrl} /></label>
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/masters/dies')}>Cancel</button>
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Die'}</button>
      </div>
    </div>
  );
}
