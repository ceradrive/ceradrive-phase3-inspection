'use client';

/**
 * CERADRIVE ERP — Sales Order create (final rebuild).
 * Sales-side only: item + application, order-level discount %, order-level tax.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api.js';
import { useToast } from '../../../../components/ui/Toast.jsx';

const inputStyle = (err) => ({ width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${err ? '#DC2626' : '#D1D5DB'}`, borderRadius: 6, fontSize: 14, color: '#111827', outline: 'none', background: '#fff' });
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const cellInput = { width: '100%', height: 34, padding: '0 8px', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 13, color: '#111827', outline: 'none', background: '#fff' };
const mutedBox = { ...inputStyle(false), display: 'flex', alignItems: 'center', background: '#F9FAFB', color: '#6B7280' };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function round4(v) {
  return Number((Number(v) || 0).toFixed(4));
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lineBaseValue(line) {
  const qty = toNum(line.qty);
  const rate = toNum(line.unit_rate);
  if (qty === null || rate === null) return null;
  return Math.max(qty * rate, 0);
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

function effectiveApplication(line) {
  return line.printable_vehicle_name || defaultApplicationName(line.application_options) || '';
}

function applicationIsRequired(line) {
  return Array.isArray(line.application_options) && line.application_options.length > 0;
}

function selectedApplicationIsValid(line) {
  if (!applicationIsRequired(line)) return true;
  const selected = effectiveApplication(line);
  return line.application_options.some(v => v.vehicle_name === selected);
}

async function resolveApplicationOptionsForItem(it) {
  const fromSearch = normalizeApplicationOptions(it?.vehicles ?? []);
  if (fromSearch.length) return fromSearch;
  if (!it?.id) return [];
  const { data } = await api.get(`/api/v1/items/master/${it.id}/vehicles`);
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.vehicles) ? data.vehicles : []);
  return normalizeApplicationOptions(rows);
}

async function loadPriceMap(priceListId) {
  if (!priceListId) return {};
  const { data } = await api.get(`/api/v1/price-lists/master/${priceListId}`);
  const map = {};
  (data?.lines ?? []).forEach(l => {
    map[l.item_id] = { unit_rate: l.unit_rate };
  });
  return map;
}

function priceFillPatch(it, priceMap) {
  const pm = priceMap?.[it.id];
  if (!pm || pm.unit_rate == null) return { unit_rate: '', rate_source: 'manual' };
  return { unit_rate: String(pm.unit_rate), rate_source: 'price_list' };
}

function SearchSelect({ endpoint, valueLabel, placeholder, onPick, render, full, rowKey, fieldName, minChars = 0, allowCreate, onCreate, onCreateLabel = '+ Add New', onAfterPick, autoOpen, onAutoOpened, onEmptyEnter, extraParams = {} }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    if (open && autoOpen && onAutoOpened) onAutoOpened();
  }, [open, autoOpen, onAutoOpened]);

  useEffect(() => {
    if (!open) return;
    const search = q.trim();
    if (search.length < minChars) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await api.get(endpoint, { search, limit: 20, ...extraParams });
      const safe = Array.isArray(data)
        ? data.filter(r => r?.id && !r.__create && !r.create && !r.createNew && !r.is_new)
        : [];
      if (!cancelled) {
        setResults(safe);
        setActiveIndex(0);
        setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open, endpoint, minChars, JSON.stringify(extraParams)]);

  useEffect(() => {
    function closeOnOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, []);

  async function pick(r) {
    await onPick(r);
    setOpen(false);
    setQ('');
    if (onAfterPick) setTimeout(onAfterPick, 0);
  }

  const style = full ? inputStyle(false) : cellInput;
  const canCreate = allowCreate && q.trim().length >= Math.max(minChars, 1);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div
        tabIndex={0}
        data-so-row={rowKey ?? undefined}
        data-so-field={fieldName ?? undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!valueLabel && onEmptyEnter) { onEmptyEnter(); return; }
            setOpen(true);
          }
          if (e.key === ' ') { e.preventDefault(); setOpen(true); }
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <span style={{ color: valueLabel ? '#111827' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valueLabel || placeholder || 'Select…'}</span>
        <span style={{ color: '#9CA3AF', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 50, top: full ? 42 : 38, left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 280, overflowY: 'auto' }}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={minChars > 0 ? `Type at least ${minChars} characters…` : 'Search existing records…'}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex(i => Math.min(i + 1, Math.max(results.length - 1, 0)));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex(i => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (q.trim().length < minChars) { onEmptyEnter?.(); return; }
                if (results[activeIndex]) pick(results[activeIndex]);
              }
            }}
            style={{ width: '100%', height: 34, padding: '0 10px', boxSizing: 'border-box', border: 'none', borderBottom: '1px solid #E5E7EB', fontSize: 13, outline: 'none' }}
          />
          {q.trim().length < minChars ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Type at least {minChars} characters</div>
          ) : loading ? (
            <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>Searching…</div>
          ) : results.length === 0 ? (
            <div>
              {canCreate && (
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(false); onCreate?.(q.trim()); }}
                  style={{ width: '100%', border: 'none', borderBottom: '1px solid #F3F4F6', background: '#EEF2FF', color: '#4338CA', padding: '9px 10px', textAlign: 'left', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{onCreateLabel}</button>
              )}
              <div style={{ padding: 12, fontSize: 12, color: '#9CA3AF' }}>No matching existing record.</div>
            </div>
          ) : results.map((r, idx) => (
            <div key={r.id} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActiveIndex(idx)} onClick={() => pick(r)}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #F3F4F6', background: idx === activeIndex ? '#EEF2FF' : '#fff' }}>{render(r)}</div>
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
      setLookups({ item_types: data?.item_types ?? [], item_categories: data?.item_categories ?? [], uom_master: data?.uom_master ?? [] });
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
    if (error) { setError(error.message || 'Failed to create item.'); return; }
    await onCreated(data);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(560px, 100%)', background: '#fff', borderRadius: 10, boxShadow: '0 20px 40px rgba(0,0,0,0.18)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Quick Create Item</div><div style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>Create minimum item master data and continue this Sales Order.</div></div>
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

function QuickCreateCustomerModal({ open, initialSearch, onClose, onCreated }) {
  const [form, setForm] = useState({ customer_code: '', customer_name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const seed = (initialSearch || '').trim();
    const codeSeed = seed ? seed.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30) : '';
    setForm({ customer_code: codeSeed, customer_name: seed });
    setError('');
  }, [open, initialSearch]);

  if (!open) return null;

  async function saveCustomer() {
    const customerCode = form.customer_code.trim().toUpperCase();
    const customerName = form.customer_name.trim();
    if (!customerCode || !customerName) { setError('Customer Code and Customer Name are required.'); return; }
    setSaving(true);
    setError('');
    const { data, error } = await api.post('/api/v1/customers/master', { customer_code: customerCode, customer_name: customerName, customer_type: 'CUSTOMER', is_active: true });
    setSaving(false);
    if (error) { setError(error.message || 'Failed to create customer.'); return; }
    await onCreated(data);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(520px, 100%)', background: '#fff', borderRadius: 10, boxShadow: '0 20px 40px rgba(0,0,0,0.18)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Quick Create Customer</div><div style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>Create minimum customer master data and continue this Sales Order.</div></div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, lineHeight: 1, color: '#6B7280', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={labelStyle}>Customer Code *</label><input value={form.customer_code} onChange={e => setForm(prev => ({ ...prev, customer_code: e.target.value.toUpperCase() }))} style={inputStyle(false)} /></div>
          <div><label style={labelStyle}>Customer Name *</label><input value={form.customer_name} onChange={e => setForm(prev => ({ ...prev, customer_name: e.target.value }))} style={inputStyle(false)} /></div>
        </div>
        {error && <div style={{ marginTop: 12, fontSize: 12, color: '#DC2626' }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={() => window.open('/masters/customers/new', '_blank')} style={{ height: 36, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Open full Customer Master form</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ height: 36, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={saveCustomer} disabled={saving} style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.65 : 1 }}>{saving ? 'Creating…' : 'Create & Select'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function emptyLine(key) {
  return { key, id: null, item_id: '', item_label: '', uom_id: null, qty: '', unit_rate: '', printable_vehicle_name: '', application_options: [], rate_source: 'manual' };
}

function calcOrderTotals(lines, discountPercent, selectedTax) {
  const valid = lines.filter(l => l.item_id);
  const subtotal = valid.reduce((sum, l) => sum + (lineBaseValue(l) ?? 0), 0);
  const discPct = Math.max(Number(discountPercent) || 0, 0);
  const discountAmount = Math.min(subtotal, subtotal * discPct / 100);
  const taxableAmount = Math.max(subtotal - discountAmount, 0);
  const taxPct = selectedTax ? Number(selectedTax.tax_percent) || 0 : 0;
  const taxAmount = taxableAmount * taxPct / 100;
  const grandTotal = taxableAmount + taxAmount;
  return { subtotal, discPct, discountAmount, taxableAmount, taxPct, taxAmount, grandTotal };
}

function allocateLines(lines, discountPercent, selectedTax) {
  const valid = lines.filter(l => l.item_id);
  const totals = calcOrderTotals(valid, discountPercent, selectedTax);
  const subtotal = totals.subtotal || 0;
  let discountAllocated = 0;
  let taxAllocated = 0;

  return valid.map((l, idx) => {
    const base = lineBaseValue(l) ?? 0;
    const isLast = idx === valid.length - 1;
    let lineDiscount = 0;
    if (totals.discountAmount > 0 && subtotal > 0) {
      lineDiscount = isLast ? totals.discountAmount - discountAllocated : round4(totals.discountAmount * base / subtotal);
    }
    discountAllocated += lineDiscount;
    const lineTaxable = Math.max(base - lineDiscount, 0);
    let lineTax = 0;
    if (totals.taxAmount > 0 && totals.taxableAmount > 0) {
      lineTax = isLast ? totals.taxAmount - taxAllocated : round4(totals.taxAmount * lineTaxable / totals.taxableAmount);
    }
    taxAllocated += lineTax;

    return {
      item_id: l.item_id,
      uom_id: l.uom_id ?? null,
      qty: Number(l.qty),
      unit_rate: l.unit_rate === '' || l.unit_rate == null ? null : Number(l.unit_rate),
      rate_source: l.rate_source ?? 'manual',
      printable_vehicle_name: effectiveApplication(l) || null,
      discount_percent: totals.discPct > 0 ? totals.discPct : null,
      discount_amount: totals.discountAmount > 0 ? round4(lineDiscount) : null,
      tax_id: selectedTax?.id ?? null,
      tax_percent: selectedTax ? Number(selectedTax.tax_percent) : null,
      tax_amount: round4(lineTax),
      line_total: round4(lineTaxable + lineTax),
    };
  });
}

function validateSO(customerId, lines) {
  const e = {};
  if (!customerId) e.customer = 'Customer is required.';
  const valid = lines.filter(l => l.item_id);
  if (!valid.length) e.lines = 'At least one item line is required.';
  for (const l of valid) {
    if (!l.qty || Number(l.qty) <= 0) e.lines = 'Qty must be greater than zero.';
    if (l.unit_rate !== '' && l.unit_rate != null && Number(l.unit_rate) < 0) e.lines = 'Rate cannot be negative.';
    if (applicationIsRequired(l) && !selectedApplicationIsValid(l)) e.lines = 'Selected application must be attached to the selected item.';
  }
  return e;
}

function LineRow({ line, onChange, onRemove, priceMap, onAdvance, onQuickCreateItem, autoOpenItem, onAutoOpenedItem, onBlankEnter }) {
  const lineValue = lineBaseValue(line);

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
    setTimeout(() => {
      const nextField = applicationOptions.length ? 'vehicle' : 'qty';
      const el = document.querySelector(`[data-so-row="${line.key}"][data-so-field="${nextField}"]`);
      if (el) { el.focus(); el.select?.(); }
    }, 0);
  }

  function finishLine() {
    if (!line.item_id) { onBlankEnter?.(); return; }
    onAdvance?.();
  }

  function enterTo(field) {
    return (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (field === 'vehicle') {
        const el = document.querySelector(`[data-so-row="${line.key}"][data-so-field="qty"]`);
        if (el) { el.focus(); el.select?.(); }
      } else if (field === 'qty') {
        const el = document.querySelector(`[data-so-row="${line.key}"][data-so-field="rate"]`);
        if (el) { el.focus(); el.select?.(); }
      } else if (field === 'rate') finishLine();
    };
  }

  const selectedApplication = effectiveApplication(line);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) 150px 90px 120px 120px 36px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <SearchSelect
        endpoint="/api/v1/items/search"
        extraParams={{ sales_only: true }}
        valueLabel={line.item_label}
        placeholder="Search item / application…"
        rowKey={line.key}
        fieldName="item"
        minChars={3}
        autoOpen={autoOpenItem}
        onAutoOpened={onAutoOpenedItem}
        onEmptyEnter={onBlankEnter}
        allowCreate
        onCreateLabel="+ Add New Item"
        onCreate={(searchText) => onQuickCreateItem?.(line.key, searchText)}
        render={r => (<><span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{r.item_code}</span><span style={{ color: '#6B7280', marginLeft: 8 }}>{r.item_name}</span>{r.vehicles?.length ? <span style={{ color: '#9CA3AF', marginLeft: 8 }}>Applications: {r.vehicles.map(v => v.vehicle_name).join(', ')}</span> : null}</>)}
        onPick={pickItem}
      />
      <select data-so-row={line.key} data-so-field="vehicle" value={selectedApplication}
        disabled={!line.item_id || !applicationIsRequired(line)}
        onChange={e => onChange(line.key, { printable_vehicle_name: e.target.value })}
        onKeyDown={enterTo('vehicle')}
        title={applicationIsRequired(line) ? 'Select one application attached to this item' : 'No applications attached to this item'}
        style={{ ...cellInput, background: !line.item_id || !applicationIsRequired(line) ? '#F9FAFB' : '#fff', color: selectedApplication ? '#111827' : '#9CA3AF' }}>
        <option value="">{line.item_id ? (applicationIsRequired(line) ? 'Select application' : 'No applications') : 'Select item first'}</option>
        {(line.application_options ?? []).map(v => <option key={v.vehicle_id ?? v.vehicle_name} value={v.vehicle_name}>{v.vehicle_name}</option>)}
      </select>
      <input data-so-row={line.key} data-so-field="qty" type="number" min="0" step="0.0001" value={line.qty} placeholder="Qty" onChange={e => onChange(line.key, { qty: e.target.value })} onKeyDown={enterTo('qty')} style={cellInput} />
      <input data-so-row={line.key} data-so-field="rate" type="number" min="0" step="0.0001" value={line.unit_rate} placeholder="Rate" onChange={e => onChange(line.key, { unit_rate: e.target.value, rate_source: 'manual' })} onKeyDown={enterTo('rate')} style={cellInput} />
      <div style={{ textAlign: 'right', fontSize: 13, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{money(lineValue)}</div>
      <button type="button" onClick={() => onRemove(line.key)} style={{ height: 34, border: '1px solid #FCA5A5', borderRadius: 5, background: '#fff', color: '#DC2626', cursor: 'pointer' }}>×</button>
    </div>
  );
}

export default function NewSalesOrderPage() {
  const router = useRouter();
  const addToast = useToast();
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [priceListId, setPriceListId] = useState(null);
  const [priceListLabel, setPriceListLabel] = useState('');
  const [priceMap, setPriceMap] = useState({});
  const [soDate, setSoDate] = useState(todayISO());
  const [deliveryDate, setDelivery] = useState('');
  const [custRef, setCustRef] = useState('');
  const [payTerms, setPayTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([emptyLine(Date.now())]);
  const [discountPercent, setDiscountPercent] = useState('');
  const [taxOptions, setTaxOptions] = useState([]);
  const [orderTaxId, setOrderTaxId] = useState('');
  const [autoFocusRowKey, setAutoFocusRowKey] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [quickItem, setQuickItem] = useState({ open: false, rowKey: null, initialSearch: '' });
  const [quickCustomer, setQuickCustomer] = useState({ open: false, initialSearch: '' });

  useEffect(() => {
    api.get('/api/v1/taxes?is_active=true').then(({ data }) => setTaxOptions(Array.isArray(data) ? data : []));
  }, []);

  const selectedTax = useMemo(() => taxOptions.find(t => t.id === orderTaxId) ?? null, [taxOptions, orderTaxId]);
  const totals = useMemo(() => calcOrderTotals(lines, discountPercent, selectedTax), [lines, discountPercent, selectedTax]);

  async function pickCustomer(c) {
    setCustomerId(c.id);
    setCustomerLabel(`${c.customer_code} — ${c.customer_name}`);
    const pl = c.assigned_price_list ?? c.price_list ?? c.price_list_headers ?? null;
    const plId = c.assigned_price_list_id ?? c.price_list_id ?? pl?.id ?? null;
    setPriceListId(plId);
    setPriceListLabel(pl ? `${pl.price_list_code ?? ''}${pl.price_list_code ? ' — ' : ''}${pl.price_list_name ?? ''}` : '');
    setPriceMap(await loadPriceMap(plId));
  }

  function setLine(key, patch) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }

  function addLine() {
    const newKey = Date.now();
    setLines(prev => [...prev, emptyLine(newKey)]);
    setAutoFocusRowKey(newKey);
  }

  function removeLine(key) {
    setLines(prev => {
      const next = prev.filter(l => l.key !== key);
      return next.length ? next : [emptyLine(Date.now())];
    });
  }

  function focusSelector(selector) {
    setTimeout(() => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.focus();
      el.select?.();
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

  function handleBlankRowEnter(key) {
    setLines(prev => {
      const target = prev.find(l => l.key === key);
      if (!target || target.item_id) return prev;
      const next = prev.filter(l => l.key !== key);
      return next.length ? next : [emptyLine(Date.now())];
    });
    focusSelector('[data-so-order="discount"], [data-so-action="create"]');
  }

  async function handleQuickItemCreated(item) {
    const rowKey = quickItem.rowKey;
    setQuickItem({ open: false, rowKey: null, initialSearch: '' });
    if (!rowKey || !item?.id) return;
    const applicationOptions = await resolveApplicationOptionsForItem(item);
    setLine(rowKey, {
      item_id: item.id,
      item_label: `${item.item_code} — ${item.item_name}`,
      uom_id: item.uom_id ?? null,
      application_options: applicationOptions,
      printable_vehicle_name: defaultApplicationName(applicationOptions),
      ...priceFillPatch(item, priceMap),
    });
    setTimeout(() => {
      const field = applicationOptions.length ? 'vehicle' : 'qty';
      const el = document.querySelector(`[data-so-row="${rowKey}"][data-so-field="${field}"]`);
      if (el) { el.focus(); el.select?.(); }
    }, 0);
  }

  async function handleQuickCustomerCreated(customer) {
    setQuickCustomer({ open: false, initialSearch: '' });
    if (customer?.id) await pickCustomer(customer);
  }

  async function handleSave() {
    const errs = validateSO(customerId, lines);
    if (Number(discountPercent) < 0) errs.discount = 'Discount % cannot be negative.';
    if (Number(discountPercent) > 100) errs.discount = 'Discount % cannot be more than 100.';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    const payloadLines = allocateLines(lines, discountPercent, selectedTax);
    const { data, error } = await api.post('/api/v1/sales-orders/master', {
      customer_id: customerId,
      price_list_id: priceListId,
      so_date: soDate,
      delivery_date: deliveryDate || null,
      customer_reference: custRef.trim() || null,
      payment_terms: payTerms.trim() || null,
      notes: notes.trim() || null,
      lines: payloadLines,
    });
    setSaving(false);
    if (error) {
      if (error.code === 'VALIDATION_ERROR') setErrors({ lines: error.message });
      else addToast(error.message ?? 'Failed to create sales order.');
      return;
    }
    addToast('Sales order created.');
    router.push(`/sales-orders/${data.id}`);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1120 }}>
      <button type="button" onClick={() => router.push('/sales-orders')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Sales Orders</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>New Sales Order</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 16, marginBottom: 20 }}>
        <div>
          <label style={labelStyle}>Customer *</label>
          <SearchSelect endpoint="/api/v1/customers" valueLabel={customerLabel} placeholder="Search customer…" full
            allowCreate onCreateLabel="+ Add New Customer" onCreate={(initialSearch) => setQuickCustomer({ open: true, initialSearch })}
            render={r => (<><span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{r.customer_code}</span><span style={{ color: '#6B7280', marginLeft: 8 }}>{r.customer_name}</span></>)}
            onPick={pickCustomer} />
          {errors.customer && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>{errors.customer}</div>}
        </div>
        <div><label style={labelStyle}>Assigned price list</label><div style={mutedBox}>{priceListLabel || '— none —'}</div></div>
        <div><label style={labelStyle}>SO date *</label><input type="date" value={soDate} onChange={e => setSoDate(e.target.value)} style={inputStyle(false)} /></div>
        <div><label style={labelStyle}>Delivery date</label><input type="date" value={deliveryDate} onChange={e => setDelivery(e.target.value)} style={inputStyle(false)} /></div>
        <div><label style={labelStyle}>Customer reference</label><input value={custRef} onChange={e => setCustRef(e.target.value)} style={inputStyle(false)} /></div>
        <div><label style={labelStyle}>Payment terms</label><input value={payTerms} onChange={e => setPayTerms(e.target.value)} style={inputStyle(false)} /></div>
      </div>
      <div style={{ marginBottom: 20 }}><label style={labelStyle}>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(false)} /></div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Lines</div>
        <button type="button" onClick={addLine} style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>+ Add line</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) 150px 90px 120px 120px 36px', gap: 8, marginBottom: 6, fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase' }}>
        <div>Item</div><div>Application</div><div>Qty</div><div>Rate</div><div style={{ textAlign: 'right' }}>Value</div><div></div>
      </div>
      {errors.lines && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{errors.lines}</div>}
      {lines.map(l => (
        <LineRow
          key={l.key}
          line={l}
          onChange={setLine}
          onRemove={removeLine}
          priceMap={priceMap}
          onAdvance={addLine}
          onQuickCreateItem={(rowKey, initialSearch) => setQuickItem({ open: true, rowKey, initialSearch })}
          autoOpenItem={autoFocusRowKey === l.key}
          onAutoOpenedItem={() => setAutoFocusRowKey(null)}
          onBlankEnter={() => handleBlankRowEnter(l.key)}
        />
      ))}

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 'min(420px, 100%)', border: '1px solid #E5E7EB', borderRadius: 8, padding: 14, background: '#FAFAFA' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0', fontSize: 13 }}>
            <span>Discount %</span>
            <input data-so-order="discount" type="number" min="0" max="100" step="0.0001" value={discountPercent} placeholder="0" onChange={e => setDiscountPercent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusSelector('[data-so-order="tax"]'); } }}
              style={{ ...cellInput, width: 110, textAlign: 'right' }} />
          </div>
          {errors.discount && <div style={{ fontSize: 11, color: '#DC2626', textAlign: 'right' }}>{errors.discount}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#6B7280' }}><span>Discount Amount</span><span>{money(totals.discountAmount)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}><span>Taxable Amount</span><strong>{money(totals.taxableAmount)}</strong></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0', fontSize: 13 }}>
            <span>Tax</span>
            <select data-so-order="tax" value={orderTaxId} onChange={e => setOrderTaxId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusSelector('[data-so-action="create"]'); } }}
              style={{ ...cellInput, width: 190 }}>
              <option value="">No Tax</option>
              {taxOptions.map(t => <option key={t.id} value={t.id}>{t.tax_name} ({t.tax_percent}%)</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#6B7280' }}><span>Tax Amount</span><span>{money(totals.taxAmount)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', marginTop: 8, paddingTop: 10, fontSize: 15 }}><span>Grand Total</span><strong>{money(totals.grandTotal)}</strong></div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button data-so-action="create" type="button" onClick={handleSave} disabled={saving} style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create Sales Order'}</button>
        <button type="button" onClick={() => router.push('/sales-orders')} style={{ height: 38, padding: '0 18px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>

      <QuickCreateItemModal open={quickItem.open} initialSearch={quickItem.initialSearch} onClose={() => setQuickItem({ open: false, rowKey: null, initialSearch: '' })} onCreated={handleQuickItemCreated} />
      <QuickCreateCustomerModal open={quickCustomer.open} initialSearch={quickCustomer.initialSearch} onClose={() => setQuickCustomer({ open: false, initialSearch: '' })} onCreated={handleQuickCustomerCreated} />
    </div>
  );
}
