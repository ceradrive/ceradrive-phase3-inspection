'use client';

// Shared Item Master form helpers (extracted verbatim): options, LookupPicker,
// AddLookupModal, ADD_LOOKUP_CONFIGS, VehicleSearchPicker, VehicleCompatEditor.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api.js';

export const STAGE_TYPE_OPTIONS = [
  ['','Select stage type'], ['RM','RM / Raw Material'], ['MIX','MIX / MBM'], ['PF','PF / Preform'], ['BP','BP / Back Plate'],
  ['SBBP','SBBP / Shot Blasted BP'], ['ACBP','ACBP / Adhesive Coated BP'], ['MLD','MLD / Moulded'], ['GRD','GRD / Ground'],
  ['PWC','PWC / Powder Coated'], ['CUR','CUR / Cured'], ['STK','STK / Stacked'], ['FG','FG / Finished Good'], ['SET','SET / Final Set (sold)'], ['PACK','PACK / Packed']
];
export const MAKE_POLICY_OPTIONS = [['','Select policy'], ['MAKE_TO_STOCK','Make to Stock'], ['MAKE_TO_ORDER','Make to Order']];
export const PLANNING_UNIT_OPTIONS = [['','Select unit'], ['PCS','Pieces'], ['SET','Sets'], ['KG','Kilograms'], ['TRAY','Trays'], ['CRATE','Crates']];
export const CALC_BASIS_OPTIONS = [
  ['','Select calculation basis'], ['WEIGHT_BATCH','Weight Batch'], ['PCS_TRAY','PCS per Tray'], ['DIE_CAVITY','Die Cavity'],
  ['PCS_CYCLE','PCS per Cycle'], ['PCS_PER_HOUR','PCS per Hour'], ['PCS_PER_MIN','PCS per Minute'], ['PCS_CRATE','PCS per Crate'],
  ['TRAY_BATCH','Tray Batch'], ['MANUAL','Manual']
];
export function optionLabel(options, value) {
  return options.find(o => o[0] === value)?.[1] || (value || '—');
}


// Page-local searchable picker (live filter over already-loaded lookup data).
// Stores the selected id exactly like the prior <select>; not a shared component.
export function LookupPicker({ options, value, onChange, getLabel, placeholder, error, addLabel, onAdd }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(o => o.id === value) || null;
  useEffect(() => { if (!open) setQuery(selected ? getLabel(selected) : ''); }, [value, open]); // show selected label when closed
  const q = query.trim().toLowerCase();
  const filtered = open ? options.filter(o => getLabel(o).toLowerCase().includes(q)) : [];
  const boxStyle = {
    width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box',
    border: `1px solid ${error ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6,
    fontSize: 14, color: '#111827', outline: 'none',
  };
  const typed = query.trim();
  return (
    <div style={{ position: 'relative' }}>
      <input value={query} placeholder={placeholder} style={boxStyle}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20, background: '#fff',
          border: '1px solid #E5E7EB', borderRadius: 6, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          {filtered.map(o => (
            <div key={o.id}
              onMouseDown={() => { onChange(o.id); setQuery(getLabel(o)); setOpen(false); }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
              style={{ padding: '8px 10px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              {getLabel(o)}
            </div>
          ))}
          {filtered.length === 0 && !onAdd && (
            <div style={{ padding: '8px 10px', fontSize: 13, color: '#9CA3AF' }}>No matches.</div>
          )}
          {onAdd && (
            <div
              onMouseDown={() => { setOpen(false); onAdd(typed); }}
              onMouseEnter={e => { e.currentTarget.style.background = '#EEF2FF'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
              style={{ padding: '8px 10px', fontSize: 13, color: '#4F46E5', fontWeight: 600, cursor: 'pointer',
                borderTop: filtered.length ? '1px solid #F3F4F6' : 'none' }}>
              + {addLabel}{typed ? ` "${typed}"` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Lightweight inline overlay to create a lookup (Item Type / Category / UOM) without
// leaving the Item screen. Page-local — not a shared ERP component. Posts to the master's
// existing endpoint, then the caller appends + auto-selects the returned record.
export function AddLookupModal({ config, onClose, onCreated }) {
  const [fields, setFields] = useState(() => {
    const init = {};
    for (const f of config.fields) init[f.key] = f.default !== undefined ? f.default : '';
    return init;
  });
  const [errors, setErrors] = useState({});
  const [permError, setPermError] = useState('');
  const [saving, setSaving] = useState(false);

  function set(key, val, upper) { setFields(p => ({ ...p, [key]: upper ? String(val).toUpperCase() : val })); setErrors(p => ({ ...p, [key]: undefined })); setPermError(''); }

  function validate() {
    const e = {};
    for (const f of config.fields) {
      if (f.required && !String(fields[f.key] ?? '').trim()) e[f.key] = `${f.label} is required.`;
      if (f.type === 'number' && fields[f.key] !== '' && (!Number.isInteger(Number(fields[f.key])) || Number(fields[f.key]) < 0))
        e[f.key] = `${f.label} must be an integer of 0 or greater.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    const body = {};
    for (const f of config.fields) {
      let v = fields[f.key];
      if (f.upper) v = String(v).trim().toUpperCase();
      else if (typeof v === 'string') v = v.trim();
      if (f.type === 'number') v = Number(v);
      body[f.key] = v === '' ? null : v;
    }
    const { data, error } = await api.post(config.endpoint, body);
    setSaving(false);
    if (error) {
      if (error.status === 403 || error.code === 'FORBIDDEN') { setPermError(`You don't have permission to add a ${config.title.toLowerCase()}.`); return; }
      if (error.code === 'CONFLICT') { setErrors(p => ({ ...p, [config.codeKey]: error.message })); return; }
      setPermError(error.message || `Failed to create ${config.title.toLowerCase()}.`);
      return;
    }
    onCreated(data);
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const card    = { background: '#fff', borderRadius: 10, width: 420, maxWidth: '92vw', padding: 22, boxShadow: '0 10px 40px rgba(0,0,0,0.18)' };
  const lbl     = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 };
  const err     = { display: 'block', fontSize: 12, color: '#DC2626', marginTop: 4 };
  function fieldStyle(hasError) {
    return { width: '100%', height: 36, padding: '0 10px', boxSizing: 'border-box',
      border: `1px solid ${hasError ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' };
  }

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={card} onMouseDown={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700, color: '#111827' }}>New {config.title}</h3>
        {config.fields.map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={lbl}>{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'textarea'
              ? <textarea value={fields[f.key]} onChange={e => set(f.key, e.target.value)} rows={2}
                  style={{ ...fieldStyle(errors[f.key]), height: 'auto', padding: '8px 10px', fontFamily: 'inherit', resize: 'vertical' }} />
              : <input type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} step={f.type === 'number' ? 1 : undefined}
                  value={fields[f.key]} onChange={e => set(f.key, e.target.value, f.upper)}
                  style={{ ...fieldStyle(errors[f.key]), ...(f.upper ? { fontFamily: 'monospace', textTransform: 'uppercase' } : {}) }} />}
            {errors[f.key] && <span style={err}>{errors[f.key]}</span>}
          </div>
        ))}
        {permError && <div style={{ ...err, marginBottom: 10 }}>{permError}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={{ background: 'none', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// Inline Add-New configs (one per lookup picker). Posts to the existing master endpoints.
export const ADD_LOOKUP_CONFIGS = {
  item_type: {
    title: 'Item Type', endpoint: '/api/v1/item-types/master', codeKey: 'type_code',
    fields: [
      { key: 'type_code', label: 'Type Code', required: true, upper: true },
      { key: 'type_name', label: 'Type Name', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  category: {
    title: 'Category', endpoint: '/api/v1/item-categories/master', codeKey: 'category_code',
    fields: [
      { key: 'category_code', label: 'Category Code', required: true, upper: true },
      { key: 'category_name', label: 'Category Name', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  uom: {
    title: 'UOM', endpoint: '/api/v1/uoms/master', codeKey: 'uom_code',
    fields: [
      { key: 'uom_code', label: 'UOM Code', required: true, upper: true },
      { key: 'uom_name', label: 'UOM Name', required: true },
      { key: 'decimal_places', label: 'Decimal Places', required: true, type: 'number', default: 2 },
    ],
  },
};

export function VehicleSearchPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    let c = false;
    const t = setTimeout(async () => {
      const { data } = await api.get('/api/v1/vehicles/search', { search: q, limit: 20 });
      if (!c) setRes(data ?? []);
    }, 200);
    return () => { c = true; clearTimeout(t); };
  }, [q, open]);
  useEffect(() => {
    function d(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', d);
    return () => document.removeEventListener('mousedown', d);
  }, []);
  return (
    <div ref={boxRef} style={{ position: 'relative', marginBottom: 10 }}>
      <div onClick={() => setOpen(o => !o)} style={{ height: 36, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 13, color: '#6B7280', background: '#fff' }}>
        <span>+ Add compatible vehicle…</span><span style={{ fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: 40, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 240, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search vehicle…"
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          {res.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No vehicles.</div>
            : res.map(v => (
              <div key={v.id} onClick={() => { onPick(v); setOpen(false); setQ(''); }}
                style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>
                {v.vehicle_name}{v.make ? <span style={{ color: '#9CA3AF', marginLeft: 8 }}>{v.make}</span> : null}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function VehicleCompatEditor({ value, onChange, editing }) {
  const rows = value ?? [];
  const add = v => { if (rows.some(r => r.vehicle_id === v.id)) return; onChange([...rows, { vehicle_id: v.id, vehicle_name: v.vehicle_name, is_default: rows.length === 0 }]); };
  const remove = i => { const next = rows.filter((_, j) => j !== i); if (next.length && !next.some(r => r.is_default)) next[0].is_default = true; onChange(next); };
  const setDefault = i => onChange(rows.map((r, j) => ({ ...r, is_default: j === i })));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  if (!editing) return (
    <div>{rows.length === 0 ? <div style={{ fontSize: 13, color: '#9CA3AF' }}>No compatible vehicles.</div>
      : rows.map((r, i) => (
        <div key={i} style={{ fontSize: 13, color: '#111827', padding: '4px 0' }}>
          {r.vehicle_name}{r.is_default && <span style={{ marginLeft: 8, fontSize: 11, color: '#059669', border: '1px solid #059669', borderRadius: 4, padding: '1px 6px' }}>Default</span>}
        </div>))}</div>
  );
  return (
    <div>
      <VehicleSearchPicker onPick={add} />
      {rows.length === 0 ? <div style={{ fontSize: 13, color: '#9CA3AF' }}>No vehicles added.</div>
        : rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
              <input type="radio" checked={!!r.is_default} onChange={() => setDefault(i)} />Default
            </label>
            <span style={{ flex: 1, fontSize: 13, color: '#111827' }}>{r.vehicle_name}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={{ border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', width: 26, height: 26, cursor: 'pointer', opacity: i === 0 ? 0.4 : 1 }}>↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} style={{ border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', width: 26, height: 26, cursor: 'pointer', opacity: i === rows.length - 1 ? 0.4 : 1 }}>↓</button>
            <button type="button" onClick={() => remove(i)} style={{ border: '1px solid #FCA5A5', borderRadius: 5, background: '#fff', color: '#DC2626', width: 26, height: 26, cursor: 'pointer' }}>✕</button>
          </div>))}
    </div>
  );
}

