'use client';

/**
 * CERADRIVE ERP — Price List create (header + lines). Manual code, revision default 1.
 * POST /api/v1/price-lists/master -> redirect to detail. Discount: percent OR amount.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter }        from 'next/navigation';
import { api }              from '../../../../../lib/api.js';
import { useToast }         from '../../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const cellInput  = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };

function ItemSearchSelect({ valueId, valueLabel, onPick, error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false; setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/items/search', { search: q, limit: 20 });
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
      <div onClick={() => setOpen(o => !o)} style={{ ...cellInput, display: 'flex', alignItems: 'center', cursor: 'pointer', justifyContent: 'space-between', border: `1px solid ${error ? '#DC2626' : '#D1D5DB'}` }}>
        <span style={{ color: valueLabel ? '#111827' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valueLabel || 'Select item…'}</span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: 38, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or name…"
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          {loading ? <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Searching…</div>
            : results.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No items found.</div>
            : results.map(it => (
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

function LineRow({ line, onChange, onRemove }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 110px 130px 130px 40px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <ItemSearchSelect valueId={line.item_id} valueLabel={line.item_label}
        onPick={it => onChange(line.key, { item_id: it.id, item_label: `${it.item_code} — ${it.item_name}`, uom_id: it.uom_id ?? line.uom_id ?? null })} />
      <input type="number" min="0" step="0.0001" value={line.unit_rate} placeholder="Unit rate"
        onChange={e => onChange(line.key, { unit_rate: e.target.value })} style={cellInput} />
      <select value={line.discount_type} onChange={e => onChange(line.key, { discount_type: e.target.value, discount_value: '' })} style={cellInput}>
        <option value="none">No discount</option>
        <option value="percent">Discount %</option>
        <option value="amount">Discount Rs</option>
      </select>
      <input type="number" min="0" step="0.0001" value={line.discount_value} placeholder={line.discount_type === 'none' ? '—' : 'Value'} disabled={line.discount_type === 'none'}
        onChange={e => onChange(line.key, { discount_value: e.target.value })} style={{ ...cellInput, background: line.discount_type === 'none' ? '#F9FAFB' : '#fff' }} />
      <button onClick={() => onRemove(line.key)} title="Remove"
        style={{ height: 34, border: '1px solid #FCA5A5', borderRadius: 5, background: '#fff', color: '#DC2626', cursor: 'pointer' }}>x</button>
    </div>
  );
}

function buildLinesPayload(lines) {
  return lines.filter(l => l.item_id).map(l => {
    const o = { item_id: l.item_id, uom_id: l.uom_id ?? null, unit_rate: Number(l.unit_rate) };
    if (l.id) o.id = l.id;
    if (l.discount_type === 'percent') o.discount_percent = l.discount_value === '' ? null : Number(l.discount_value);
    if (l.discount_type === 'amount')  o.discount_amount  = l.discount_value === '' ? null : Number(l.discount_value);
    return o;
  });
}

function validateForm(code, name, lines, requireCode) {
  const e = {};
  if (requireCode && !code.trim()) e.code = 'Code is required.';
  if (!name.trim()) e.name = 'Name is required.';
  const filled = lines.filter(l => l.item_id);
  if (filled.length === 0) e.lines = 'At least one line with an item is required.';
  for (const l of filled) {
    if (!(Number(l.unit_rate) >= 0)) e.lines = 'Every line needs a unit rate >= 0.';
    if (l.discount_type !== 'none' && l.discount_value !== '' && Number(l.discount_value) < 0) e.lines = 'Discount cannot be negative.';
  }
  return e;
}

export default function NewPriceListPage() {
  const router = useRouter();
  const addToast = useToast();
  const lineKey = useRef(1);

  const [code, setCode]       = useState('');
  const [name, setName]       = useState('');
  const [revision, setRev]    = useState('1');
  const [currency, setCurr]   = useState('INR');
  const [validFrom, setVF]    = useState('');
  const [validTo, setVT]      = useState('');
  const [notes, setNotes]     = useState('');
  const [lines, setLines]     = useState([{ key: 0, id: null, item_id: '', item_label: '', uom_id: null, unit_rate: '', discount_type: 'none', discount_value: '' }]);
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);

  const setLine = (key, patch) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const addLine = () => setLines(prev => [...prev, { key: lineKey.current++, id: null, item_id: '', item_label: '', uom_id: null, unit_rate: '', discount_type: 'none', discount_value: '' }]);
  const removeLine = (key) => setLines(prev => prev.filter(l => l.key !== key));

  async function handleSave() {
    const errs = validateForm(code, name, lines, true);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/price-lists/master', {
      price_list_code: code.trim(), price_list_name: name.trim(),
      revision: Number(revision) || 1, currency: currency || 'INR',
      valid_from: validFrom || null, valid_to: validTo || null, notes: notes.trim() || null,
      lines: buildLinesPayload(lines),
    });
    setSaving(false);
    if (error) {
      if (error.code === 'CONFLICT') setErrors({ code: error.message });
      else if (error.code === 'VALIDATION_ERROR') setErrors({ lines: error.message });
      else addToast(error.message ?? 'Failed to save.');
      return;
    }
    addToast('Price list created.');
    router.push(`/masters/price-lists/${data.id}`);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920 }}>
      <button onClick={() => router.push('/masters/price-lists')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Price Lists</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>New Price List</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 20 }}>
        <div><label style={labelStyle}>Code *</label><input value={code} onChange={e => setCode(e.target.value)} style={inputStyle(errors.code)} />{errors.code && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>{errors.code}</div>}</div>
        <div><label style={labelStyle}>Name *</label><input value={name} onChange={e => setName(e.target.value)} style={inputStyle(errors.name)} />{errors.name && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>{errors.name}</div>}</div>
        <div><label style={labelStyle}>Revision</label><input type="number" min="1" value={revision} onChange={e => setRev(e.target.value)} style={inputStyle(false)} /></div>
        <div><label style={labelStyle}>Currency</label><input value={currency} onChange={e => setCurr(e.target.value)} style={inputStyle(false)} /></div>
        <div><label style={labelStyle}>Valid From</label><input type="date" value={validFrom} onChange={e => setVF(e.target.value)} style={inputStyle(false)} /></div>
        <div><label style={labelStyle}>Valid To</label><input type="date" value={validTo} onChange={e => setVT(e.target.value)} style={inputStyle(false)} /></div>
      </div>
      <div style={{ marginBottom: 20 }}><label style={labelStyle}>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} /></div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Lines</div>
        <button onClick={addLine} style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>+ Add line</button>
      </div>
      {errors.lines && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{errors.lines}</div>}
      {lines.map(l => <LineRow key={l.key} line={l} onChange={setLine} onRemove={removeLine} />)}

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create Price List'}</button>
        <button onClick={() => router.push('/masters/price-lists')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
