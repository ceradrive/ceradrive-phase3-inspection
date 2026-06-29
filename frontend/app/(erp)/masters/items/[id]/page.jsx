'use client';

// Item Detail / Edit — thin page over the shared Item Master form.
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';
import { useItemForm } from '../_form/useItemForm.js';
import { ItemFormShell } from '../_form/ItemForm.jsx';
import { AddLookupModal, ADD_LOOKUP_CONFIGS } from '../_form/components.jsx';

export default function ItemDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const toast = useToast();
  const { form, set, errors, setErrors, hydrate, validate, toPayload } = useItemForm();

  const [item, setItem] = useState(null);
  const [loadedVehicles, setLoadedVehicles] = useState([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [types, setTypes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [qcTypes, setQcTypes] = useState([]);
  const [addLookup, setAddLookup] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.get('/api/v1/items/lookups').then(({ data }) => {
      setTypes(data?.item_types ?? []);
      setCategories(data?.item_categories ?? []);
      setUoms(data?.uoms ?? data?.uom_master ?? data?.units ?? []);
      setQcTypes(data?.qc_types ?? []);
    });
  }, []);

  useEffect(() => {
    api.get(`/api/v1/items/master/${id}`).then(({ data, error }) => {
      if (error || !data) { setLoadError(true); setLoading(false); return; }
      setItem(data);
      api.get(`/api/v1/items/master/${id}/vehicles`).then(({ data: vd }) => {
        const v = vd ?? [];
        setLoadedVehicles(v);
        hydrate(data, v);
        setLoading(false);
      });
    });
  }, [id]);

  function openAddLookup(kind, text) { setAddLookup({ kind, prefillName: (text || '').trim() }); }
  function applyCreatedLookup(kind, record) {
    if (kind === 'item_type') { setTypes((p) => [...p, record]); set('item_type_id', record.id); }
    else if (kind === 'category') { setCategories((p) => [...p, record]); set('category_id', record.id); }
    else if (kind === 'uom') { setUoms((p) => [...p, record]); set('uom', { ...form.uom, baseUomId: record.id }); }
    setAddLookup(null);
  }

  function handleCancel() { hydrate(item, loadedVehicles); setErrors({}); setEditing(false); }

  async function handleSave() {
    const errs = validate(uoms);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.patch(`/api/v1/items/master/${id}`, toPayload(uoms));
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ item_code: error.message });
      else toast(error.message ?? 'Failed to update.');
    } else {
      setItem(data);
      setLoadedVehicles(form.vehicles);
      hydrate(data, form.vehicles);
      setEditing(false);
      toast('Item updated.');
    }
  }

  async function handleToggle() {
    setToggling(true);
    const { data, error } = await api.post(`/api/v1/items/master/${id}/toggle-active`, { is_active: !item.is_active });
    setToggling(false);
    if (error) toast(error.message ?? 'Failed to update status.');
    else { setItem((prev) => ({ ...prev, is_active: data.is_active })); toast(`${data.item_code} ${data.is_active ? 'activated' : 'deactivated'}.`); }
  }

  useEffect(() => {
    const onKey = (e) => { if ((e.altKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (editing) handleSave(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loading) return <div style={{ padding: 40, color: '#6B7280', fontFamily: '-apple-system, sans-serif' }}>Loading…</div>;
  if (loadError || !item) return (
    <div style={{ padding: 40, fontFamily: '-apple-system, sans-serif' }}>
      <button onClick={() => router.push('/masters/items')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Items</button>
      <div style={{ color: '#DC2626' }}>Item not found.</div>
    </div>
  );

  const ctx = { form, set, errors, setErrors, editing, mode: 'edit', lookups: { types, categories, uoms, qcTypes }, openAddLookup, item };
  const actions = editing ? (
    <>
      <button onClick={handleCancel} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
      <button onClick={handleSave} disabled={saving} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>{saving ? 'Saving…' : 'Save'}</button>
    </>
  ) : (
    <button onClick={() => setEditing(true)} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Edit</button>
  );

  return (
    <>
      <ItemFormShell title={item.item_name || 'Item'} back={() => router.push('/masters/items')} actions={actions} ctx={ctx} />
      {!editing && (
        <div style={{ maxWidth: 1100, margin: '12px auto 32px', padding: '0 28px' }}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{item.is_active ? 'Deactivate this item' : 'Activate this item'}</div>
            <button onClick={handleToggle} disabled={toggling} style={{ height: 34, padding: '0 16px', border: `1px solid ${item.is_active ? '#FCA5A5' : '#86EFAC'}`, borderRadius: 6, background: '#fff', color: item.is_active ? '#DC2626' : '#16A34A', fontSize: 13, fontWeight: 600, cursor: toggling ? 'not-allowed' : 'pointer' }}>{toggling ? '…' : (item.is_active ? 'Deactivate' : 'Activate')}</button>
          </div>
        </div>
      )}
      {addLookup && (() => {
        const base = ADD_LOOKUP_CONFIGS[addLookup.kind];
        const nameKey = addLookup.kind === 'item_type' ? 'type_name' : addLookup.kind === 'category' ? 'category_name' : 'uom_name';
        const cfg = { ...base, fields: base.fields.map((f) => (f.key === nameKey ? { ...f, default: addLookup.prefillName } : f)) };
        return <AddLookupModal config={cfg} onClose={() => setAddLookup(null)} onCreated={(record) => applyCreatedLookup(addLookup.kind, record)} />;
      })()}
    </>
  );
}
