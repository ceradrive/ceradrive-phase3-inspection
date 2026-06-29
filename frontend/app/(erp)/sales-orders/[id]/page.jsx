'use client';

/**
 * CERADRIVE ERP — Sales Order detail / edit (10C). Draft CRUD. Header (non-customer) + line diff.
 * Customer + so_number immutable here. PATCH /api/v1/sales-orders/master/:id.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams }        from 'next/navigation';
import { api }                         from '../../../../lib/api.js';
import { useToast }                    from '../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const cellInput  = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none' };

function SearchSelect({ endpoint, valueLabel, placeholder, onPick, render, full, rowKey, fieldName, onAfterPick, allowCreate, onCreate, onCreateLabel = '+ Add New' }) {
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
      const { data } = await api.get(endpoint, { search: q, limit: 20 });
      const safe = Array.isArray(data)
        ? data.filter(r => r?.id && !r.__create && !r.create && !r.createNew && !r.is_new)
        : [];
      if (!cancelled) { setResults(safe); setLoading(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open, endpoint]);

  useEffect(() => {
    function d(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', d);
    return () => document.removeEventListener('mousedown', d);
  }, []);

  async function pick(r) {
    await onPick(r);
    setOpen(false);
    setQ('');
    if (onAfterPick) setTimeout(onAfterPick, 0);
  }

  const style = full ? inputStyle(false) : cellInput;
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div
        tabIndex={0}
        data-so-row={rowKey ?? undefined}
        data-so-field={fieldName ?? undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <span style={{ color: valueLabel ? '#111827' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valueLabel || placeholder || 'Select…'}</span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: full ? 42 : 38, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search existing records…"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              if (e.key === 'Enter') { e.preventDefault(); if (results[0]) pick(results[0]); }
            }}
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }} />
          {loading ? <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Searching…</div>
            : results.length === 0 ? (
              <div>
                {allowCreate && q.trim() && (
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(false); onCreate?.(q.trim()); }}
                    style={{ width: '100%', border: 'none', borderBottom: '1px solid #F3F4F6', background: '#EEF2FF', color: '#4338CA', padding: '9px 10px', textAlign: 'left', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{onCreateLabel}</button>
                )}
                <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No matching existing record.</div>
              </div>
            )
            : results.map(r => (
              <div key={r.id} onClick={() => pick(r)}
                style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>{render(r)}</div>
            ))}
        </div>
      )}
    </div>
  );
}

function QuickCreateItemModal({ open, initialSearch, onClose, onCreated }) {
  const [lookups, setLookups] = useState({ item_types: [], item_categories: [], uom_master: [] });
  const [form, setForm] = useState({ item_code: '', item_name: '', item_type_id: '', category_id: '', uom_id: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const seed = (initialSearch || '').trim();
    const codeSeed = seed ? seed.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30) : '';
    setForm({ item_code: codeSeed, item_name: seed, item_type_id: '', category_id: '', uom_id: '' });
    setError('');
    let cancelled = false;
    setLoading(true);
    api.get('/api/v1/items/lookups').then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message || 'Failed to load item lookups.');
      setLookups({
        item_types: data?.item_types ?? [],
        item_categories: data?.item_categories ?? [],
        uom_master: data?.uom_master ?? [],
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, initialSearch]);

  if (!open) return null;

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  async function saveItem() {
    const itemCode = form.item_code.trim().toUpperCase();
    const itemName = form.item_name.trim();
    if (!itemCode || !itemName || !form.uom_id || !form.item_type_id || !form.category_id) {
      setError('Item Code, Item Name, UOM, Item Type and Item Category are required.');
      return;
    }

    setSaving(true);
    setError('');
    const { data, error } = await api.post('/api/v1/items/master', {
      item_code: itemCode,
      item_name: itemName,
      item_type_id: form.item_type_id,
      category_id: form.category_id,
      uom_id: form.uom_id,
      sales_uom_id: form.uom_id,
      purchase_uom_id: form.uom_id,
      is_active: true,
      is_stocked: true,
      is_manufactured: false,
      is_sellable: true,
      is_purchasable: true,
    });
    setSaving(false);
    if (error) {
      setError(error.message || 'Failed to create item.');
      return;
    }
    await onCreated(data);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 10, boxShadow: '0 20px 40px rgba(0,0,0,0.18)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Quick Create Item</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>Create minimum item master data and continue this Sales Order.</div>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, lineHeight: 1, color: '#6B7280', cursor: 'pointer' }}>×</button>
        </div>

        {loading ? <div style={{ fontSize: 13, color: '#6B7280', padding: '12px 0' }}>Loading mandatory fields…</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Item Code *</label><input value={form.item_code} onChange={e => setField('item_code', e.target.value.toUpperCase())} style={inputStyle(false)} /></div>
            <div><label style={labelStyle}>Item Name *</label><input value={form.item_name} onChange={e => setField('item_name', e.target.value)} style={inputStyle(false)} /></div>
            <div><label style={labelStyle}>UOM *</label><select value={form.uom_id} onChange={e => setField('uom_id', e.target.value)} style={inputStyle(false)}><option value="">Select UOM</option>{lookups.uom_master.map(u => <option key={u.id} value={u.id}>{u.uom_code} — {u.uom_name}</option>)}</select></div>
            <div><label style={labelStyle}>Item Type *</label><select value={form.item_type_id} onChange={e => setField('item_type_id', e.target.value)} style={inputStyle(false)}><option value="">Select type</option>{lookups.item_types.map(t => <option key={t.id} value={t.id}>{t.type_code} — {t.type_name}</option>)}</select></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Item Category *</label><select value={form.category_id} onChange={e => setField('category_id', e.target.value)} style={inputStyle(false)}><option value="">Select category</option>{lookups.item_categories.map(c => <option key={c.id} value={c.id}>{c.category_code} — {c.category_name}</option>)}</select></div>
          </div>
        )}

        {error && <div style={{ marginTop: 12, fontSize: 12, color: '#DC2626' }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={() => window.open('/masters/items/new', '_blank')} style={{ height: 36, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Open full Item Master form</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ height: 36, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={saveItem} disabled={saving || loading} style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving || loading ? 'default' : 'pointer', opacity: saving || loading ? 0.65 : 1 }}>{saving ? 'Creating…' : 'Create & Select'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function calcLineValue(line) {
  const qty = toNum(line.qty);
  const rate = toNum(line.unit_rate);
  if (qty === null || rate === null) return null;
  const gross = qty * rate;
  let discount = 0;
  const dv = toNum(line.discount_value);
  if (line.discount_type === 'percent' && dv !== null) discount = gross * dv / 100;
  if (line.discount_type === 'amount' && dv !== null) discount = dv;
  return Math.max(gross - discount, 0);
}

function money(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function focusSOField(key, field) {
  if (key === null || key === undefined || !field) return;
  setTimeout(() => {
    const el = document.querySelector(`[data-so-row="${key}"][data-so-field="${field}"]`);
    if (el) { el.focus(); if (typeof el.select === 'function') el.select(); }
  }, 0);
}

function normalizeApplicationOptions(rows) {
  return (rows ?? [])
    .map(v => ({
      vehicle_id: v.vehicle_id ?? v.id,
      vehicle_name: v.vehicle_name,
      is_default: Boolean(v.is_default),
    }))
    .filter(v => v.vehicle_id && v.vehicle_name);
}

function defaultApplicationName(options) {
  const rows = normalizeApplicationOptions(options);
  const def = rows.find(v => v.is_default) ?? rows[0];
  return def?.vehicle_name ?? '';
}

async function resolveApplicationOptionsForItem(it) {
  const fromSearch = normalizeApplicationOptions(it?.vehicles ?? []);
  if (fromSearch.length) return fromSearch;
  if (!it?.id) return [];
  const { data } = await api.get(`/api/v1/items/master/${it.id}/vehicles`);
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.vehicles) ? data.vehicles : []);
  return normalizeApplicationOptions(rows);
}

function applicationIsRequired(line) {
  return Array.isArray(line.application_options) && line.application_options.length > 0;
}

function selectedApplicationIsValid(line) {
  if (!applicationIsRequired(line)) return true;
  return line.application_options.some(v => v.vehicle_name === line.printable_vehicle_name);
}

// 10D: build a { item_id: {unit_rate, discount_percent, discount_amount} } map from a price list.
async function loadPriceMap(priceListId) {
  if (!priceListId) return {};
  const { data } = await api.get(`/api/v1/price-lists/master/${priceListId}`);
  const map = {};
  (data?.lines ?? []).forEach(l => {
    map[l.item_id] = { unit_rate: l.unit_rate, discount_percent: l.discount_percent ?? null, discount_amount: l.discount_amount ?? null };
  });
  return map;
}

// 10D: apply a price-list entry to a line patch on item pick. Missing -> blank + manual.
function priceFillPatch(it, priceMap) {
  const pm = priceMap?.[it.id];
  if (!pm || pm.unit_rate == null) {
    return { unit_rate: '', discount_type: 'none', discount_value: '', rate_source: 'manual' };
  }
  const patch = { unit_rate: String(pm.unit_rate), rate_source: 'price_list', discount_type: 'none', discount_value: '' };
  if (pm.discount_percent != null) { patch.discount_type = 'percent'; patch.discount_value = String(pm.discount_percent); }
  else if (pm.discount_amount != null) { patch.discount_type = 'amount'; patch.discount_value = String(pm.discount_amount); }
  return patch;
}

function LineRow({ line, onChange, onRemove, priceMap, isLast, nextKey, onAdvance, onQuickCreateItem }) {
  const lineTotal = calcLineValue(line);

  async function pickItem(it) {
    const applicationOptions = await resolveApplicationOptionsForItem(it);
    const applicationName = defaultApplicationName(applicationOptions);
    onChange(line.key, {
      item_id: it.id,
      item_label: `${it.item_code} — ${it.item_name}`,
      uom_id: it.uom_id ?? null,
      application_options: applicationOptions,
      printable_vehicle_name: applicationName,
      ...priceFillPatch(it, priceMap),
    });
  }

  function finishLine() {
    if (isLast) {
      if (line.item_id && onAdvance) onAdvance();
      return;
    }
    focusSOField(nextKey, 'item');
  }

  function enterTo(field) {
    return (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (field === 'vehicle') focusSOField(line.key, 'qty');
      else if (field === 'qty') focusSOField(line.key, 'rate');
      else if (field === 'rate') focusSOField(line.key, 'discountType');
      else if (field === 'discountType') {
        if (line.discount_type === 'none') finishLine();
        else focusSOField(line.key, 'discountValue');
      }
      else if (field === 'discountValue') finishLine();
    };
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 130px 80px 110px 170px 120px 36px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <SearchSelect endpoint="/api/v1/items/search" valueLabel={line.item_label} placeholder="Search item / application…" rowKey={line.key} fieldName="item" onAfterPick={() => focusSOField(line.key, 'vehicle')}
        allowCreate onCreateLabel="+ Add New Item" onCreate={(searchText) => onQuickCreateItem?.(line.key, searchText)}
        render={r => (<><span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{r.item_code}</span><span style={{ color: '#6B7280', marginLeft: 8 }}>{r.item_name}</span>{r.vehicles?.length ? <span style={{ color: '#9CA3AF', marginLeft: 8 }}>Applications: {r.vehicles.map(v => v.vehicle_name).join(', ')}</span> : null}</>)}
        onPick={pickItem} />
      <select data-so-row={line.key} data-so-field="vehicle" value={effectiveApplicationName(line)}
        disabled={!line.item_id || !applicationIsRequired(line)}
        onChange={e => onChange(line.key, { printable_vehicle_name: e.target.value })}
        onKeyDown={enterTo('vehicle')}
        title={applicationIsRequired(line) ? 'Select one application attached to this item' : 'No applications attached to this item'}
        style={{ ...cellInput, background: !line.item_id || !applicationIsRequired(line) ? '#F9FAFB' : '#fff', color: line.printable_vehicle_name ? '#111827' : '#9CA3AF' }}>
        <option value="">{line.item_id ? (applicationIsRequired(line) ? 'Select application' : 'No applications') : 'Select item first'}</option>
        {(line.application_options ?? []).map(v => (
          <option key={v.vehicle_id ?? v.vehicle_name} value={v.vehicle_name}>{v.vehicle_name}</option>
        ))}
      </select>
      <input data-so-row={line.key} data-so-field="qty" type="number" min="0" step="0.0001" value={line.qty} placeholder="Qty" onChange={e => onChange(line.key, { qty: e.target.value })} onKeyDown={enterTo('qty')} style={cellInput} />
      <input data-so-row={line.key} data-so-field="rate" type="number" min="0" step="0.0001" value={line.unit_rate} placeholder="Rate" onChange={e => onChange(line.key, { unit_rate: e.target.value, rate_source: 'manual' })} onKeyDown={enterTo('rate')} style={cellInput} />
      <div style={{ display: 'grid', gridTemplateColumns: line.discount_type === 'none' ? '1fr' : '76px 1fr', gap: 6 }}>
        <select data-so-row={line.key} data-so-field="discountType" value={line.discount_type}
          onChange={e => {
            const v = e.target.value;
            onChange(line.key, { discount_type: v, discount_value: '', rate_source: 'manual' });
            if (v !== 'none') focusSOField(line.key, 'discountValue');
          }}
          onKeyDown={enterTo('discountType')} style={cellInput}>
          <option value="none">No disc.</option><option value="percent">Disc %</option><option value="amount">Disc Rs</option>
        </select>
        {line.discount_type !== 'none' && (
          <input data-so-row={line.key} data-so-field="discountValue" type="number" min="0" step="0.0001" value={line.discount_value} placeholder={line.discount_type === 'percent' ? '%' : 'Rs'}
            onChange={e => onChange(line.key, { discount_value: e.target.value, rate_source: 'manual' })} onKeyDown={enterTo('discountValue')} style={cellInput} />
        )}
      </div>
      <div title="Line value" style={{ ...cellInput, background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: lineTotal == null ? '#9CA3AF' : '#111827', fontVariantNumeric: 'tabular-nums' }}>{money(lineTotal)}</div>
      <button type="button" onClick={() => onRemove(line.key)} title="Remove" style={{ height: 34, border: '1px solid #FCA5A5', borderRadius: 5, background: '#fff', color: '#DC2626', cursor: 'pointer' }}>x</button>
    </div>
  );
}

function effectiveApplicationName(line) {
  return line.printable_vehicle_name?.trim() || defaultApplicationName(line.application_options) || '';
}

function buildLines(lines) {
  return lines.filter(l => l.item_id).map(l => {
    const lineTotal = calcLineValue(l);
    const o = {
      item_id: l.item_id,
      uom_id: l.uom_id ?? null,
      qty: Number(l.qty),
      unit_rate: l.unit_rate === '' || l.unit_rate == null ? null : Number(l.unit_rate),
      rate_source: l.rate_source ?? 'manual',
      printable_vehicle_name: effectiveApplicationName(l) || null,
      line_total: lineTotal == null ? null : Number(lineTotal.toFixed(4)),
    };
    if (l.id) o.id = l.id;
    if (l.discount_type === 'percent') o.discount_percent = l.discount_value === '' ? null : Number(l.discount_value);
    if (l.discount_type === 'amount')  o.discount_amount  = l.discount_value === '' ? null : Number(l.discount_value);
    return o;
  });
}

function validateSO(customerId, lines) {
  const e = {};
  if (!customerId) e.customer = 'Customer is required.';
  const filled = lines.filter(l => l.item_id);
  if (filled.length === 0) e.lines = 'At least one line with an item is required.';
  for (const l of filled) {
    const effectiveApp = effectiveApplicationName(l);
    const lineForValidation = { ...l, printable_vehicle_name: effectiveApp };
    if (!(Number(l.qty) > 0)) e.lines = 'Every line needs qty greater than 0.';
    if (applicationIsRequired(lineForValidation) && !effectiveApp) e.lines = 'Select one application for every item that has attached applications.';
    if (applicationIsRequired(lineForValidation) && !selectedApplicationIsValid(lineForValidation)) e.lines = 'Selected application must be attached to the selected item.';
    if (l.unit_rate !== '' && l.unit_rate != null && Number(l.unit_rate) < 0) e.lines = 'Rate cannot be negative.';
    if (l.discount_type !== 'none' && l.discount_value !== '' && Number(l.discount_value) < 0) e.lines = 'Discount cannot be negative.';
  }
  return e;
}

function emptyLine(k) { return { key: k, id: null, item_id: '', item_label: '', uom_id: null, qty: '', unit_rate: '', discount_type: 'none', discount_value: '', printable_vehicle_name: '', application_options: [], rate_source: 'manual' }; }

function fmtDate(d) { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

export default function SalesOrderDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const addToast = useToast();
  const lineKey = useRef(1);

  const [so, setSo]           = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [acting, setActing]   = useState(false);
  const [errors, setErrors]   = useState({});
  const [priceMap, setPriceMap] = useState({});
  const [quickItem, setQuickItem] = useState({ open: false, rowKey: null, initialSearch: '' });

  const [soDate, setSoDate]         = useState('');
  const [deliveryDate, setDelivery] = useState('');
  const [custRef, setCustRef]       = useState('');
  const [payTerms, setPayTerms]     = useState('');
  const [notes, setNotes]           = useState('');
  const [lines, setLines]           = useState([]);
  const originalIds = useRef([]);

  function dTypeOf(l) { return l.discount_percent != null ? 'percent' : l.discount_amount != null ? 'amount' : 'none'; }
  function dValOf(l)  { return l.discount_percent != null ? String(l.discount_percent) : l.discount_amount != null ? String(l.discount_amount) : ''; }

  async function hydrateApplicationOptions(initialLines) {
    const enriched = await Promise.all(initialLines.map(async (line) => {
      if (!line.item_id) return line;
      const options = await resolveApplicationOptionsForItem({ id: line.item_id });
      const selectedStillValid = !line.printable_vehicle_name || options.some(v => v.vehicle_name === line.printable_vehicle_name);
      const fallbackApplication = defaultApplicationName(options);
      return {
        ...line,
        application_options: options,
        printable_vehicle_name: selectedStillValid ? (line.printable_vehicle_name || fallbackApplication) : fallbackApplication,
      };
    }));
    setLines(enriched);
  }

  function hydrate(data) {
    setSo(data);
    setSoDate(data.so_date ?? ''); setDelivery(data.delivery_date ?? '');
    setCustRef(data.customer_reference ?? ''); setPayTerms(data.payment_terms ?? ''); setNotes(data.notes ?? '');
    const ls = (data.lines ?? []).map(l => ({
      key: lineKey.current++, id: l.id, item_id: l.item_id,
      item_label: l.item_master ? `${l.item_master.item_code} — ${l.item_master.item_name}` : '',
      uom_id: l.uom_id ?? null, qty: l.qty != null ? String(l.qty) : '',
      unit_rate: l.unit_rate != null ? String(l.unit_rate) : '',
      discount_type: dTypeOf(l), discount_value: dValOf(l),
      rate_source: l.rate_source ?? 'manual',
      printable_vehicle_name: l.printable_vehicle_name ?? '',
      application_options: [],
    }));
    setLines(ls); originalIds.current = (data.lines ?? []).map(l => l.id);
    hydrateApplicationOptions(ls);
    loadPriceMap(data.price_list_id).then(setPriceMap);
  }

  useEffect(() => {
    api.get(`/api/v1/sales-orders/master/${id}`).then(({ data, error }) => {
      if (error || !data) addToast('Sales order not found.'); else hydrate(data);
      setLoading(false);
    });
  }, [id, addToast]);

  const setLine = (key, patch) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const addLine = () => {
    const k = lineKey.current++;
    setLines(prev => [...prev, emptyLine(k)]);
    focusSOField(k, 'item');
    return k;
  };
  const removeLine = (key) => setLines(prev => {
    const next = prev.filter(l => l.key !== key);
    return next.length ? next : [emptyLine(lineKey.current++)];
  });

  async function handleQuickItemCreated(item) {
    if (!item?.id || quickItem.rowKey === null) return;
    const applicationOptions = await resolveApplicationOptionsForItem(item);
    const applicationName = defaultApplicationName(applicationOptions);
    setLine(quickItem.rowKey, {
      item_id: item.id,
      item_label: `${item.item_code} — ${item.item_name}`,
      uom_id: item.uom_id ?? null,
      application_options: applicationOptions,
      printable_vehicle_name: applicationName,
      ...priceFillPatch(item, priceMap),
    });
    setQuickItem({ open: false, rowKey: null, initialSearch: '' });
    focusSOField(quickItem.rowKey, applicationOptions.length ? 'vehicle' : 'qty');
  }

  function handleCancel() { if (so) hydrate(so); setErrors({}); setEditing(false); }

  async function handleSave() {
    const errs = validateSO(so?.customer_id, lines);
    delete errs.customer;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    const payload = buildLines(lines).filter(l => l.item_id);
    const { data, error } = await api.patch(`/api/v1/sales-orders/master/${id}`, {
      so_date: soDate, delivery_date: deliveryDate || null,
      customer_reference: custRef.trim() || null, payment_terms: payTerms.trim() || null,
      notes: notes.trim() || null, lines: payload,
    });
    setSaving(false);
    if (error) { if (error.code === 'VALIDATION_ERROR') setErrors({ lines: error.message }); else addToast(error.message ?? 'Failed to save.'); return; }
    hydrate(data); setEditing(false); addToast('Sales order updated.');
  }

  async function approveSO() {
    setActing(true);
    const { data, error } = await api.post(`/api/v1/sales-orders/master/${id}/approve`, {});
    setActing(false);
    if (error) { addToast(error.message ?? 'Failed to approve sales order.'); return; }
    hydrate(data); addToast('Sales order approved.');
  }
  async function cancelSO() {
    if (!window.confirm('Cancel this sales order? This cannot be undone.')) return;
    setActing(true);
    const { data, error } = await api.post(`/api/v1/sales-orders/master/${id}/cancel`, {});
    setActing(false);
    if (error) { addToast(error.message ?? 'Failed to cancel sales order.'); return; }
    hydrate(data); addToast('Sales order cancelled.');
  }

  if (loading) return <div style={{ padding: 40, color: '#9CA3AF', fontSize: 14 }}>Loading…</div>;
  if (!so) return <div style={{ padding: 40, color: '#DC2626', fontSize: 14 }}>Sales order not found.</div>;

  const ro = (v) => <div style={{ fontSize: 14, color: v ? '#374151' : '#9CA3AF', padding: '8px 0' }}>{v || '—'}</div>;
  const custName = so.customer_master ? `${so.customer_master.customer_code} — ${so.customer_master.customer_name}` : '—';
  const plName = so.price_list_headers ? `${so.price_list_headers.price_list_code} — ${so.price_list_headers.price_list_name}` : '— none —';

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1040 }}>
      <button onClick={() => router.push('/sales-orders')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Sales Orders</button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>{so.so_number} <span style={{ color: '#9CA3AF', fontSize: 13 }}>({so.status})</span></h1>
        {!editing && (
          <div style={{ display: 'flex', gap: 8 }}>
            {so.status === 'draft' && <button onClick={approveSO} disabled={acting} style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: '#16A34A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1 }}>{acting ? 'Working…' : 'Approve'}</button>}
            {so.status === 'draft' && <button onClick={() => setEditing(true)} style={{ height: 36, padding: '0 16px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Edit</button>}
            {(so.status === 'draft' || so.status === 'approved') && <button onClick={cancelSO} disabled={acting} style={{ height: 36, padding: '0 16px', border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', fontSize: 13, color: '#DC2626', cursor: acting ? 'default' : 'pointer', opacity: acting ? 0.6 : 1 }}>Cancel order</button>}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 16, marginBottom: 20 }}>
        <div><label style={labelStyle}>Customer</label>{ro(custName)}</div>
        <div><label style={labelStyle}>Assigned price list</label>{ro(plName)}</div>
        <div><label style={labelStyle}>SO date</label>{editing ? <input type="date" value={soDate} onChange={e => setSoDate(e.target.value)} style={inputStyle(false)} /> : ro(fmtDate(so.so_date))}</div>
        <div><label style={labelStyle}>Delivery date</label>{editing ? <input type="date" value={deliveryDate} onChange={e => setDelivery(e.target.value)} style={inputStyle(false)} /> : ro(fmtDate(so.delivery_date))}</div>
        <div><label style={labelStyle}>Customer reference</label>{editing ? <input value={custRef} onChange={e => setCustRef(e.target.value)} style={inputStyle(false)} /> : ro(so.customer_reference)}</div>
        <div><label style={labelStyle}>Payment terms</label>{editing ? <input value={payTerms} onChange={e => setPayTerms(e.target.value)} style={inputStyle(false)} /> : ro(so.payment_terms)}</div>
        <div><label style={labelStyle}>Notes</label>{editing ? <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} /> : ro(so.notes)}</div>
      </div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Lines</div>
        {editing && <button onClick={addLine} style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>+ Add line</button>}
      </div>
      {errors.lines && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{errors.lines}</div>}

      {editing ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 130px 80px 110px 170px 120px 36px', gap: 8, marginBottom: 6, fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>
            <div>Item</div><div>Application</div><div>Qty</div><div>Rate</div><div>Discount</div><div>Value</div><div></div>
          </div>
          {lines.map((l, i) => <LineRow key={l.key} line={l} onChange={setLine} onRemove={removeLine} priceMap={priceMap} isLast={i === lines.length - 1} nextKey={lines[i + 1]?.key} onAdvance={addLine} onQuickCreateItem={(rowKey, initialSearch) => setQuickItem({ open: true, rowKey, initialSearch })} />)}
        </>
      ) : (
        <div className="erp-table">
          <div className="erp-table-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) 130px 90px 110px 120px 120px', padding: '9px 14px' }}>
            {['Item', 'Application', 'Qty', 'Unit Rate', 'Discount', 'Value'].map((h, i) => <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>{h}</div>)}
          </div>
          {(so.lines ?? []).map(l => (
            <div key={l.id} className="erp-table-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) 130px 90px 110px 120px 120px', padding: '0 14px', alignItems: 'center', minHeight: 44 }}>
              <div style={{ fontSize: 13, color: '#111827' }}>{l.item_master ? `${l.item_master.item_code} — ${l.item_master.item_name}` : l.item_id}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{l.printable_vehicle_name || '—'}</div>
              <div style={{ fontSize: 13, color: '#111827' }}>{l.qty}</div>
              <div style={{ fontSize: 13, color: '#111827' }}>{l.unit_rate ?? '—'}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{l.discount_percent != null ? `${l.discount_percent}%` : l.discount_amount != null ? `Rs ${l.discount_amount}` : '—'}</div>
              <div style={{ fontSize: 13, color: '#111827', textAlign: 'right' }}>{money(l.line_total ?? calcLineValue({ qty: l.qty, unit_rate: l.unit_rate, discount_type: l.discount_percent != null ? 'percent' : l.discount_amount != null ? 'amount' : 'none', discount_value: l.discount_percent ?? l.discount_amount ?? '' }))}</div>
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
      <QuickCreateItemModal open={quickItem.open} initialSearch={quickItem.initialSearch} onClose={() => setQuickItem({ open: false, rowKey: null, initialSearch: '' })} onCreated={handleQuickItemCreated} />
    </div>
  );
}
