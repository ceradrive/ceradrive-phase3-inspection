'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';

const ctrl = { height: 36, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', width: '100%' };
const lbl = { fontSize: 12, fontWeight: 700, color: '#374151' };

export default function DieDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [linkedItems, setLinkedItems] = useState([]);
  const [itemQuery, setItemQuery] = useState('');
  const [itemResults, setItemResults] = useState([]);
  const [savingItems, setSavingItems] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`/api/v1/dies/master/${id}/items`).then(({ data }) => {
      setLinkedItems(Array.isArray(data) ? data : []);
    });
  }, [id]);

  useEffect(() => {
    const q = itemQuery.trim();
    if (q.length < 2) { setItemResults([]); return; }
    let active = true;
    api.get('/api/v1/items/search', { search: q, limit: 10 }).then(({ data }) => {
      if (active) setItemResults(Array.isArray(data) ? data : []);
    });
    return () => { active = false; };
  }, [itemQuery]);

  function addLinkedItem(it) {
    if (!it?.id) return;
    setLinkedItems((prev) => prev.some((x) => x.item_id === it.id) ? prev : [
      ...prev,
      { item_id: it.id, item_code: it.item_code, item_name: it.item_name, stage_type: it.stage_type ?? null, is_preferred: prev.length === 0 },
    ]);
    setItemQuery('');
    setItemResults([]);
  }

  function removeLinkedItem(itemId) {
    setLinkedItems((prev) => prev.filter((x) => x.item_id !== itemId));
  }

  async function saveLinkedItems() {
    setSavingItems(true);
    const payload = { items: linkedItems.map((x) => ({ item_id: x.item_id, is_preferred: !!x.is_preferred })) };
    const { data, error } = await api.patch(`/api/v1/dies/master/${id}/items`, payload);
    setSavingItems(false);
    if (error) { alert(error.message || 'Failed to save compatible items'); return; }
    setLinkedItems(Array.isArray(data) ? data : []);
    alert('Compatible items saved');
  }

  useEffect(() => {
    api.get(`/api/v1/dies/master/${id}`).then(({ data, error }) => {
      if (error || !data) alert('Die not found');
      setForm(data);
      setLoading(false);
    });
  }, [id]);

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/dies/master/${id}`, form);
    setSaving(false);
    if (error) { alert(error.message || 'Failed to save die'); return; }
    setForm(data);
    alert('Die updated');
  }

  if (loading) return <div style={{ padding: 28 }}>Loading…</div>;
  if (!form) return <div style={{ padding: 28 }}>Die not found.</div>;

  return (
    <div style={{ padding: 28, maxWidth: 760 }}>
      <button onClick={() => router.push('/masters/dies')} style={{ border: 0, background: 'none', color: '#6B7280' }}>← Die Master</button>
      <h1>{form.die_code}</h1>

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={lbl}>Die Code<input value={form.die_code || ''} disabled style={{ ...ctrl, background: '#F9FAFB' }} /></label>
        <label style={lbl}>Die Name<input value={form.die_name || ''} onChange={e => set('die_name', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Cavity / Impressions<input type="number" value={form.num_impressions || ''} onChange={e => set('num_impressions', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Die Type<input value={form.die_type || ''} onChange={e => set('die_type', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Material<input value={form.material || ''} onChange={e => set('material', e.target.value)} style={ctrl} /></label>
        <label style={lbl}>Status<select value={form.status || 'active'} onChange={e => set('status', e.target.value)} style={ctrl}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></select></label>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked)} /> Active</label>
        <label style={lbl}>Notes<input value={form.notes || ''} onChange={e => set('notes', e.target.value)} style={ctrl} /></label>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ ...lbl, fontSize: 14, marginBottom: 8 }}>Compatible SKUs / Output Items</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
          Link moulding/preforming output items to this die. Press Planner reads cavity from this die&apos;s impressions. STK items cannot be linked.
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            value={itemQuery}
            onChange={(e) => setItemQuery(e.target.value)}
            placeholder="Search item code or name to add…"
            style={ctrl}
          />
          {itemResults.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, marginTop: 2, maxHeight: 220, overflowY: 'auto' }}>
              {itemResults.map((it) => (
                <div
                  key={it.id}
                  onClick={() => addLinkedItem(it)}
                  style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #F3F4F6' }}
                >
                  <b>{it.item_code}</b> <span style={{ color: '#6B7280' }}>{it.item_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {linkedItems.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9CA3AF', padding: '6px 0' }}>No compatible items linked yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {linkedItems.map((it) => (
              <div key={it.item_id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #E5E7EB', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <b>{it.item_code || it.item_id}</b> <span style={{ color: '#6B7280' }}>{it.item_name || ''}</span>
                  {it.stage_type ? <span style={{ marginLeft: 8, fontSize: 11, color: '#2563EB' }}>{it.stage_type}</span> : null}
                </div>
                <button onClick={() => removeLinkedItem(it.item_id)} style={{ border: '1px solid #FCA5A5', color: '#DC2626', background: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={saveLinkedItems} disabled={savingItems} style={{ border: '1px solid #2563EB', color: '#fff', background: '#2563EB', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>
            {savingItems ? 'Saving…' : 'Save Compatible Items'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/masters/dies')}>Back</button>
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </div>
    </div>
  );
}
