'use client';

// Create Item — thin page over the shared Item Master form.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';
import { useItemForm } from '../_form/useItemForm.js';
import { ItemFormShell } from '../_form/ItemForm.jsx';
import { AddLookupModal, ADD_LOOKUP_CONFIGS } from '../_form/components.jsx';

export default function ItemNewPage() {
  const router = useRouter();
  const toast = useToast();
  const { form, set, errors, setErrors, validate, toPayload } = useItemForm();
  const [types, setTypes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [qcTypes, setQcTypes] = useState([]);
  const [addLookup, setAddLookup] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/v1/items/lookups').then(({ data }) => {
      const t = data?.item_types ?? [];
      const c = data?.item_categories ?? [];
      const u = data?.uoms ?? data?.uom_master ?? data?.units ?? [];
      const qt = data?.qc_types ?? [];
      setTypes(t); setCategories(c); setUoms(u); setQcTypes(qt);
      if (t.length === 1) set('item_type_id', t[0].id);
      if (c.length === 1) set('category_id', c[0].id);
      if (u.length === 1) set('uom', { baseUomId: u[0].id, altUomId: '', convFactor: '' });
    });
  }, []);

  function openAddLookup(kind, text) { setAddLookup({ kind, prefillName: (text || '').trim() }); }
  function applyCreatedLookup(kind, record) {
    if (kind === 'item_type') { setTypes((p) => [...p, record]); set('item_type_id', record.id); }
    else if (kind === 'category') { setCategories((p) => [...p, record]); set('category_id', record.id); }
    else if (kind === 'uom') { setUoms((p) => [...p, record]); set('uom', { ...form.uom, baseUomId: record.id }); }
    setAddLookup(null);
  }

  async function handleSave() {
    const errs = validate(uoms);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/items/master', toPayload(uoms));
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ item_code: error.message });
      else toast(error.message ?? 'Failed to create item.');
    } else {
      toast(`Item ${data.item_code} created.`);
      router.push('/masters/items');
    }
  }

  useEffect(() => {
    const onKey = (e) => { if ((e.altKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); handleSave(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ctx = { form, set, errors, setErrors, editing: true, mode: 'create', lookups: { types, categories, uoms, qcTypes }, openAddLookup, item: null };
  const actions = (
    <>
      <button onClick={() => router.push('/masters/items')} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
      <button onClick={handleSave} disabled={saving} style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>{saving ? 'Saving…' : 'Create Item'}</button>
    </>
  );

  return (
    <>
      <ItemFormShell title="New Item" back={() => router.push('/masters/items')} actions={actions} ctx={ctx} />
      {addLookup && (() => {
        const base = ADD_LOOKUP_CONFIGS[addLookup.kind];
        const nameKey = addLookup.kind === 'item_type' ? 'type_name' : addLookup.kind === 'category' ? 'category_name' : 'uom_name';
        const cfg = { ...base, fields: base.fields.map((f) => (f.key === nameKey ? { ...f, default: addLookup.prefillName } : f)) };
        return <AddLookupModal config={cfg} onClose={() => setAddLookup(null)} onCreated={(record) => applyCreatedLookup(addLookup.kind, record)} />;
      })()}
    </>
  );
}
