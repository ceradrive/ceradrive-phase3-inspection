'use client';

/**
 * CERADRIVE ERP — Create BOM (draft)
 * Mandatory: parent item, BOM type (active only), and per line: component item, quantity (>0), UOM.
 * scrap_factor >= 0. New BOM starts as draft. Direct self-component is blocked client + server side.
 * Routing-step link omitted from UI (backend pass-through only). No lifecycle/version/copy here.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter }                   from 'next/navigation';
import { api }                         from '../../../../../lib/api.js';
import { useToast }                    from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const errStyle   = { fontSize: 11, color: '#DC2626', marginTop: 3 };

/* Searchable item picker — queries /api/v1/boms/items as you type */
function ItemSearchSelect({ valueId, valueLabel, onPick, placeholder, error }) {
  const [open,    setOpen]    = useState(false);
  const [q,       setQ]       = useState('');
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

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ ...inputStyle(error), display: 'flex', alignItems: 'center', cursor: 'pointer', justifyContent: 'space-between' }}>
        <span style={{ color: valueLabel ? '#111827' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {valueLabel || placeholder || 'Select item…'}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: 42, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          {loading ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Searching…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No items found.</div>
          ) : results.map(it => (
            <div key={it.id}
              onClick={() => { onPick(it); setOpen(false); setQ(''); }}
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

export default function BomNewPage() {
  const router = useRouter();
  const addToast = useToast();
  const lineId = useRef(1);

  function emptyLine() {
    return { key: lineId.current++, component_item_id: '', component_label: '', quantity: '', uom_id: '', scrap_factor: '0', is_optional: false };
  }

  const [parentId,    setParentId]    = useState('');
  const [parentLabel, setParentLabel] = useState('');
  const [bomTypeId,   setBomTypeId]   = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes,       setNotes]       = useState('');
  const [lines,       setLines]       = useState([emptyLine()]);

  const [types,  setTypes]  = useState([]);
  const [uoms,   setUoms]   = useState([]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/v1/boms/types').then(({ data }) => setTypes(data ?? []));
    api.get('/api/v1/boms/uoms').then(({ data }) => setUoms(data ?? []));
  }, []);

  function setLine(key, patch) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }
  function addLine()      { setLines(prev => [...prev, emptyLine()]); }
  function removeLine(key) { setLines(prev => prev.filter(l => l.key !== key)); }

  function validate() {
    const errs = {};
    if (!parentId)  errs.parent = 'Parent item is required.';
    if (!bomTypeId) errs.bom_type = 'BOM type is required.';
    const filled = lines.filter(l => l.component_item_id);
    if (filled.length === 0) errs.lines = 'Add at least one component line.';
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
    const payloadLines = lines.filter(l => l.component_item_id).map((l, i) => ({
      component_item_id: l.component_item_id,
      quantity:          Number(l.quantity),
      uom_id:            l.uom_id,
      scrap_factor:      l.scrap_factor === '' ? 0 : Number(l.scrap_factor),
      is_optional:       Boolean(l.is_optional),
      line_seq:          i + 1,
    }));
    const { data, error } = await api.post('/api/v1/boms/master', {
      item_id:        parentId,
      bom_type_id:    bomTypeId,
      effective_date: effectiveDate || null,
      notes:          notes.trim()  || null,
      lines:          payloadLines,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR' && error.message?.toLowerCase().includes('bom type')) setErrors({ bom_type: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ lines: error.message });
      else addToast(error.message ?? 'Failed to create BOM.');
    } else {
      addToast('BOM created (draft).');
      router.push(`/masters/boms/${data.id}`);
    }
  }

  const cellInput = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>

      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.push('/masters/boms')}
          style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ← Bills of Material
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>New BOM</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Saved as a draft. Parent item, BOM type and at least one component are required.</p>
      </div>

      {/* Header card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Parent Item *</label>
            <ItemSearchSelect
              valueId={parentId} valueLabel={parentLabel}
              placeholder="Select parent item…" error={errors.parent}
              onPick={it => { setParentId(it.id); setParentLabel(`${it.item_code} — ${it.item_name}`); setErrors(p => ({ ...p, parent: undefined })); }} />
            {errors.parent && <span style={errStyle}>{errors.parent}</span>}
          </div>
          <div>
            <label style={labelStyle}>BOM Type *</label>
            <select value={bomTypeId} onChange={e => { setBomTypeId(e.target.value); setErrors(p => ({ ...p, bom_type: undefined })); }}
              style={{ ...inputStyle(errors.bom_type), background: '#fff', cursor: 'pointer' }}>
              <option value="">Select BOM type…</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
            </select>
            {errors.bom_type && <span style={errStyle}>{errors.bom_type}</span>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Effective date</label>
            <input value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} type="date" style={inputStyle()} />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" style={inputStyle()} />
          </div>
        </div>
      </div>

      {/* Lines card */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Components</span>
          <button onClick={addLine}
            style={{ height: 30, padding: '0 12px', borderRadius: 5, background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4F46E5', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            + Add component
          </button>
        </div>
        {errors.lines && <div style={{ ...errStyle, marginBottom: 8 }}>{errors.lines}</div>}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              {['Component item', 'Qty', 'UOM', 'Scrap', 'Optional', ''].map((h, i) => (
                <th key={i} style={{ padding: '6px 8px', textAlign: i >= 1 && i <= 3 ? 'left' : 'left', fontWeight: 600, color: '#6B7280', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.key} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '6px 8px', minWidth: 280 }}>
                  <ItemSearchSelect
                    valueId={l.component_item_id} valueLabel={l.component_label}
                    placeholder="Select component…"
                    onPick={it => setLine(l.key, { component_item_id: it.id, component_label: `${it.item_code} — ${it.item_name}` })} />
                </td>
                <td style={{ padding: '6px 8px', width: 90 }}>
                  <input value={l.quantity} onChange={e => setLine(l.key, { quantity: e.target.value })} type="number" min="0" step="any" style={cellInput} />
                </td>
                <td style={{ padding: '6px 8px', width: 120 }}>
                  <select value={l.uom_id} onChange={e => setLine(l.key, { uom_id: e.target.value })} style={{ ...cellInput, background: '#fff', cursor: 'pointer' }}>
                    <option value="">UOM…</option>
                    {uoms.map(u => <option key={u.id} value={u.id}>{u.uom_code}</option>)}
                  </select>
                </td>
                <td style={{ padding: '6px 8px', width: 90 }}>
                  <input value={l.scrap_factor} onChange={e => setLine(l.key, { scrap_factor: e.target.value })} type="number" min="0" step="any" style={cellInput} />
                </td>
                <td style={{ padding: '6px 8px', width: 70, textAlign: 'center' }}>
                  <input type="checkbox" checked={l.is_optional} onChange={e => setLine(l.key, { is_optional: e.target.checked })} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                </td>
                <td style={{ padding: '6px 8px', width: 40, textAlign: 'right' }}>
                  <button onClick={() => removeLine(l.key)} title="Remove"
                    style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/masters/boms')}
          style={{ height: 36, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 6, background: saving ? '#818CF8' : '#4F46E5', fontSize: 13, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
          {saving ? 'Saving…' : 'Create BOM'}
        </button>
      </div>

    </div>
  );
}
