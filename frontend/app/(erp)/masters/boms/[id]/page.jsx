'use client';

/**
 * CERADRIVE ERP — BOM Detail / Edit (draft CRUD)
 * Edit header (parent, type, effective date, notes) and component lines (add/update/remove).
 * status + version are display-only here (lifecycle deferred). Direct self-component blocked.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams }        from 'next/navigation';
import { api }                         from '../../../../../lib/api.js';
import { useToast }                    from '../../../../../components/ui/Toast.jsx';

const STATUS_LABELS = { draft: 'Draft', active: 'Active', superseded: 'Superseded' };
const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

function ItemSearchSelect({ valueId, valueLabel, onPick, placeholder, error, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/boms/items', { search: q, limit: 20 });
      if (!cancelled) { setResults(data ?? []); setLoading(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (disabled) {
    return <div style={{ ...inputStyle(false), background: '#F9FAFB', display: 'flex', alignItems: 'center', color: '#374151' }}>{valueLabel || '—'}</div>;
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ ...inputStyle(error), display: 'flex', alignItems: 'center', cursor: 'pointer', justifyContent: 'space-between' }}>
        <span style={{ color: valueLabel ? '#111827' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {valueLabel || placeholder || 'Select item…'}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: 42, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          {loading ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No items found.</div>
          ) : results.map(it => (
            <div key={it.id} onClick={() => { onPick(it); setOpen(false); setQ(''); }}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6', background: it.id === valueId ? '#EEF2FF' : '#fff' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#111827', fontWeight: 600 }}>{it.item_code}</span>
              <span style={{ color: '#6B7280', marginLeft: 8 }}>{it.item_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BomDetailPage() {
  const router = useRouter();
  const params = useParams();
  const addToast = useToast();
  const id = params.id;
  const lineKey = useRef(1);

  const [bom,     setBom]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [types,   setTypes]   = useState([]);
  const [uoms,    setUoms]    = useState([]);
  const [errors,  setErrors]  = useState({});

  const [parentId,      setParentId]      = useState('');
  const [parentLabel,   setParentLabel]   = useState('');
  const [bomTypeId,     setBomTypeId]     = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes,         setNotes]         = useState('');
  const [lines,         setLines]         = useState([]);
  const originalIds = useRef([]);

  function hydrate(data) {
    setBom(data);
    setParentId(data.item_id ?? '');
    setParentLabel(data.parent_item ? `${data.parent_item.item_code} — ${data.parent_item.item_name}` : '');
    setBomTypeId(data.bom_type_id ?? '');
    setEffectiveDate(data.effective_date ?? '');
    setNotes(data.notes ?? '');
    const ls = (data.lines ?? []).map(l => ({
      key: lineKey.current++, id: l.id,
      component_item_id: l.component_item_id,
      component_label:   l.component ? `${l.component.item_code} — ${l.component.item_name}` : '',
      quantity:          l.quantity != null ? String(l.quantity) : '',
      uom_id:            l.uom_id ?? '',
      scrap_factor:      l.scrap_factor != null ? String(l.scrap_factor) : '0',
      is_optional:       Boolean(l.is_optional),
    }));
    setLines(ls);
    originalIds.current = (data.lines ?? []).map(l => l.id);
  }

  useEffect(() => {
    api.get(`/api/v1/boms/master/${id}`).then(({ data, error }) => {
      if (error || !data) addToast('BOM not found.');
      else hydrate(data);
      setLoading(false);
    });
    api.get('/api/v1/boms/types').then(({ data }) => setTypes(data ?? []));
    api.get('/api/v1/boms/uoms').then(({ data }) => setUoms(data ?? []));
  }, [id, addToast]);

  function emptyLine() {
    return { key: lineKey.current++, id: null, component_item_id: '', component_label: '', quantity: '', uom_id: '', scrap_factor: '0', is_optional: false };
  }
  function setLine(key, patch) { setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l)); }
  function addLine()       { setLines(prev => [...prev, emptyLine()]); }
  function removeLine(key) { setLines(prev => prev.filter(l => l.key !== key)); }

  function handleCancel() { if (bom) hydrate(bom); setErrors({}); setEditing(false); }

  function validate() {
    const errs = {};
    if (!parentId)  errs.parent = 'Parent item is required.';
    if (!bomTypeId) errs.bom_type = 'BOM type is required.';
    const filled = lines.filter(l => l.component_item_id);
    if (filled.length === 0) errs.lines = 'A BOM needs at least one component.';
    for (const l of filled) {
      if (l.component_item_id === parentId) errs.lines = 'A component cannot be the same as the parent item.';
      if (!(Number(l.quantity) > 0))        errs.lines = 'Every component needs a quantity greater than 0.';
      if (!l.uom_id)                        errs.lines = 'Every component needs a UOM.';
      if (l.scrap_factor !== '' && Number(l.scrap_factor) < 0) errs.lines = 'Scrap factor cannot be negative.';
    }
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);

    const filled = lines.filter(l => l.component_item_id);
    const add = filled.filter(l => !l.id).map((l, i) => ({
      component_item_id: l.component_item_id, quantity: Number(l.quantity), uom_id: l.uom_id,
      scrap_factor: l.scrap_factor === '' ? 0 : Number(l.scrap_factor), is_optional: Boolean(l.is_optional),
    }));
    const update = filled.filter(l => l.id).map(l => ({
      id: l.id, component_item_id: l.component_item_id, quantity: Number(l.quantity), uom_id: l.uom_id,
      scrap_factor: l.scrap_factor === '' ? 0 : Number(l.scrap_factor), is_optional: Boolean(l.is_optional),
    }));
    const currentIds = filled.filter(l => l.id).map(l => l.id);
    const remove = originalIds.current.filter(oid => !currentIds.includes(oid));

    const { data, error } = await api.patch(`/api/v1/boms/master/${id}`, {
      item_id: parentId, bom_type_id: bomTypeId, effective_date: effectiveDate || null, notes: notes.trim() || null,
      lines: { add, update, remove },
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('bom type')) setErrors({ bom_type: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ lines: error.message });
      else addToast(error.message ?? 'Failed to save.');
    } else {
      hydrate(data);
      setEditing(false);
      addToast('BOM updated.');
    }
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!bom)    return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>BOM not found.</div>;

  const cellInput = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };
  const roVal = (v) => <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0', minHeight: 22 }}>{v || '—'}</div>;
  const isGenerated = Boolean(bom.is_system_generated);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/boms')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Bills of Material
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
            {bom.parent_item ? bom.parent_item.item_code : 'BOM'} <span style={{ color: '#9CA3AF', fontFamily: 'monospace', fontSize: 15 }}>v{bom.version_number}</span>
          </h1>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500, border: '1px solid #F59E0B', color: '#B45309', background: '#FFFBEB' }}>
            {STATUS_LABELS[bom.status] ?? bom.status}
          </span>
          {isGenerated && (
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: '1px solid #93C5FD', color: '#1D4ED8', background: '#EFF6FF' }}>
              Generated from Recipe
            </span>
          )}
        </div>
      </div>

      {isGenerated && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          This BOM is auto-generated from Manufacturing Recipe Builder and is read-only. Edit the recipe to change inputs.
        </div>
      )}

      {/* Header card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Parent Item</label>
            {editing
              ? <ItemSearchSelect valueId={parentId} valueLabel={parentLabel} error={errors.parent}
                  onPick={it => { setParentId(it.id); setParentLabel(`${it.item_code} — ${it.item_name}`); setErrors(p => ({ ...p, parent: undefined })); }} />
              : roVal(parentLabel)}
            {errors.parent && <span style={errStyle}>{errors.parent}</span>}
          </div>
          <div>
            <label style={labelStyle}>BOM Type</label>
            {editing
              ? <select value={bomTypeId} onChange={e => { setBomTypeId(e.target.value); setErrors(p => ({ ...p, bom_type: undefined })); }}
                  style={{ ...inputStyle(errors.bom_type), background: '#fff', cursor: 'pointer' }}>
                  <option value="">Select BOM type…</option>
                  {types.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
                </select>
              : roVal(bom.bom_type?.type_name)}
            {errors.bom_type && <span style={errStyle}>{errors.bom_type}</span>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Effective date</label>
            {editing ? <input value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} type="date" style={inputStyle()} /> : roVal(bom.effective_date)}
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            {editing ? <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle()} /> : roVal(bom.notes)}
          </div>
        </div>
      </div>

      {/* Lines card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Components</span>
          {editing && (
            <button onClick={addLine}
              style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              + Add component
            </button>
          )}
        </div>
        {errors.lines && <div style={{ ...errStyle, marginBottom: 8 }}>{errors.lines}</div>}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              {['Component item', 'Qty', 'UOM', 'Scrap', 'Optional', ''].map((h, i) => (
                <th key={i} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>No components.</td></tr>
            ) : lines.map(l => (
              <tr key={l.key} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '6px 8px', minWidth: 280 }}>
                  <ItemSearchSelect disabled={!editing} valueId={l.component_item_id} valueLabel={l.component_label}
                    placeholder="Select component…"
                    onPick={it => setLine(l.key, { component_item_id: it.id, component_label: `${it.item_code} — ${it.item_name}` })} />
                </td>
                <td style={{ padding: '6px 8px', width: 90 }}>
                  {editing ? <input value={l.quantity} onChange={e => setLine(l.key, { quantity: e.target.value })} type="number" min="0" step="any" style={cellInput} /> : roVal(l.quantity)}
                </td>
                <td style={{ padding: '6px 8px', width: 120 }}>
                  {editing
                    ? <select value={l.uom_id} onChange={e => setLine(l.key, { uom_id: e.target.value })} style={{ ...cellInput, background: '#fff', cursor: 'pointer' }}>
                        <option value="">UOM…</option>
                        {uoms.map(u => <option key={u.id} value={u.id}>{u.uom_code}</option>)}
                      </select>
                    : roVal(uoms.find(u => u.id === l.uom_id)?.uom_code)}
                </td>
                <td style={{ padding: '6px 8px', width: 90 }}>
                  {editing ? <input value={l.scrap_factor} onChange={e => setLine(l.key, { scrap_factor: e.target.value })} type="number" min="0" step="any" style={cellInput} /> : roVal(l.scrap_factor)}
                </td>
                <td style={{ padding: '6px 8px', width: 70, textAlign: 'center' }}>
                  <input type="checkbox" disabled={!editing} checked={l.is_optional} onChange={e => setLine(l.key, { is_optional: e.target.checked })} style={{ width: 16, height: 16, cursor: editing ? 'pointer' : 'default' }} />
                </td>
                <td style={{ padding: '6px 8px', width: 40, textAlign: 'right' }}>
                  {editing && (
                    <button onClick={() => removeLine(l.key)} title="Remove"
                      style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          {isGenerated ? (
            <button disabled style={{ height: 36, padding: '0 18px', border: '1px solid #BFDBFE', borderRadius: 6, background: '#EFF6FF', fontSize: 13, color: '#1D4ED8', cursor: 'not-allowed' }}>Read only — generated</button>
          ) : (
            <button onClick={() => setEditing(true)} style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Edit</button>
          )}
        </div>
      )}

    </div>
  );
}
