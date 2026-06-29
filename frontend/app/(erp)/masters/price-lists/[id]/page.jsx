'use client';

/**
 * CERADRIVE ERP — Price List detail / edit. Header (non-code) + line add/update/remove diff.
 * Code+revision immutable (revision = new header row). PATCH /api/v1/price-lists/master/:id.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams }        from 'next/navigation';
import { api }                         from '../../../../../lib/api.js';
import { useToast }                    from '../../../../../components/ui/Toast.jsx';

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

export default function PriceListDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const addToast = useToast();
  const lineKey = useRef(1);

  const [pl, setPl]           = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [errors, setErrors]   = useState({});

  const [name, setName]     = useState('');
  const [currency, setCurr] = useState('INR');
  const [validFrom, setVF]  = useState('');
  const [validTo, setVT]    = useState('');
  const [notes, setNotes]   = useState('');
  const [lines, setLines]   = useState([]);
  const originalIds = useRef([]);

  function discountTypeOf(l) {
    if (l.discount_percent != null) return 'percent';
    if (l.discount_amount  != null) return 'amount';
    return 'none';
  }
  function discountValueOf(l) {
    if (l.discount_percent != null) return String(l.discount_percent);
    if (l.discount_amount  != null) return String(l.discount_amount);
    return '';
  }

  function hydrate(data) {
    setPl(data);
    setName(data.price_list_name ?? '');
    setCurr(data.currency ?? 'INR');
    setVF(data.valid_from ?? '');
    setVT(data.valid_to ?? '');
    setNotes(data.notes ?? '');
    const ls = (data.lines ?? []).map(l => ({
      key: lineKey.current++, id: l.id,
      item_id: l.item_id,
      item_label: l.item_master ? `${l.item_master.item_code} — ${l.item_master.item_name}` : '',
      uom_id: l.uom_id ?? null,
      unit_rate: l.unit_rate != null ? String(l.unit_rate) : '',
      discount_type: discountTypeOf(l), discount_value: discountValueOf(l),
    }));
    setLines(ls);
    originalIds.current = (data.lines ?? []).map(l => l.id);
  }

  useEffect(() => {
    api.get(`/api/v1/price-lists/master/${id}`).then(({ data, error }) => {
      if (error || !data) addToast('Price list not found.');
      else hydrate(data);
      setLoading(false);
    });
  }, [id, addToast]);

  const setLine = (key, patch) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const addLine = () => setLines(prev => [...prev, { key: lineKey.current++, id: null, item_id: '', item_label: '', uom_id: null, unit_rate: '', discount_type: 'none', discount_value: '' }]);
  const removeLine = (key) => setLines(prev => prev.filter(l => l.key !== key));
  function handleCancel() { if (pl) hydrate(pl); setErrors({}); setEditing(false); }

  async function handleSave() {
    const errs = validateForm('', name, lines, false);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    const payload = buildLinesPayload(lines);
    const add    = payload.filter(l => !l.id);
    const update = payload.filter(l => l.id);
    const currentIds = lines.filter(l => l.item_id && l.id).map(l => l.id);
    const remove = originalIds.current.filter(oid => !currentIds.includes(oid));
    const { data, error } = await api.patch(`/api/v1/price-lists/master/${id}`, {
      price_list_name: name.trim(), currency: currency || 'INR',
      valid_from: validFrom || null, valid_to: validTo || null, notes: notes.trim() || null,
      lines: { add, update, remove },
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR') setErrors({ lines: error.message });
      else addToast(error.message ?? 'Failed to save.');
      return;
    }
    hydrate(data); setEditing(false); addToast('Price list updated.');
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!pl)     return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Price list not found.</div>;

  const ro = (v) => <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0' }}>{v || '—'}</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920 }}>
      <button onClick={() => router.push('/masters/price-lists')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Price Lists</button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>{pl.price_list_code} <span style={{ color: '#9CA3AF', fontFamily: 'monospace', fontSize: 15 }}>rev {pl.revision}</span></h1>
        {!editing && <button onClick={() => setEditing(true)} style={{ height: 36, padding: '0 16px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Edit</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 20 }}>
        <div><label style={labelStyle}>Code</label>{ro(pl.price_list_code)}</div>
        <div><label style={labelStyle}>Revision</label>{ro('rev ' + pl.revision)}</div>
        <div><label style={labelStyle}>Name</label>{editing ? <input value={name} onChange={e => setName(e.target.value)} style={inputStyle(errors.name)} /> : ro(pl.price_list_name)}</div>
        <div><label style={labelStyle}>Currency</label>{editing ? <input value={currency} onChange={e => setCurr(e.target.value)} style={inputStyle(false)} /> : ro(pl.currency)}</div>
        <div><label style={labelStyle}>Valid From</label>{editing ? <input type="date" value={validFrom} onChange={e => setVF(e.target.value)} style={inputStyle(false)} /> : ro(pl.valid_from)}</div>
        <div><label style={labelStyle}>Valid To</label>{editing ? <input type="date" value={validTo} onChange={e => setVT(e.target.value)} style={inputStyle(false)} /> : ro(pl.valid_to)}</div>
        <div><label style={labelStyle}>Notes</label>{editing ? <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} /> : ro(pl.notes)}</div>
      </div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Lines</div>
        {editing && <button onClick={addLine} style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>+ Add line</button>}
      </div>
      {errors.lines && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{errors.lines}</div>}

      {editing ? (
        lines.map(l => <LineRow key={l.key} line={l} onChange={setLine} onRemove={removeLine} />)
      ) : (
        <div className="erp-table">
          <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 120px 140px', padding: '9px 14px' }}>
            {['Item', 'Unit Rate', 'Discount'].map((h, i) => <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>{h}</div>)}
          </div>
          {(pl.lines ?? []).map(l => (
            <div key={l.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 120px 140px', padding: '0 14px', alignItems: 'center', minHeight: 44 }}>
              <div style={{ fontSize: 13, color: '#111827' }}>{l.item_master ? `${l.item_master.item_code} — ${l.item_master.item_name}` : l.item_id}</div>
              <div style={{ fontSize: 13, color: '#111827' }}>{l.unit_rate}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{l.discount_percent != null ? `${l.discount_percent}%` : l.discount_amount != null ? `Rs ${l.discount_amount}` : '—'}</div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={handleCancel} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
