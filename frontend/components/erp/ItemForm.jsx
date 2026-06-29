'use client';

/**
 * CERADRIVE ERP — ItemForm
 * Shared form for Add and Edit Item pages.
 * Tab layout: Basic | UOM & Commercial | Inventory | Manufacturing | QC | Notes
 * Approved blueprint: Batch 4B governance decision.
 * All confirmed item_master columns only. formulation_code replaces mix_family_id (locked).
 */

import { useState } from 'react';

const INPUT = {
  width: '100%', height: 38,
  border: '1px solid #D1D5DB', borderRadius: 6,
  padding: '0 12px', fontSize: 13, color: '#111827',
  background: '#fff', outline: 'none', fontFamily: 'inherit',
};
const LABEL = { fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' };
const ERR   = { fontSize: 12, color: '#DC2626', marginTop: 3 };
const HINT  = { fontSize: 11, color: '#9CA3AF', marginTop: 3 };
const GRID2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
const GRID3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 };
const GRID4 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 };

const TABS = [
  { id: 'basic',   label: 'Basic' },
  { id: 'uom',     label: 'UOM & Commercial' },
  { id: 'inv',     label: 'Inventory' },
  { id: 'mfg',     label: 'Manufacturing' },
  { id: 'qc',      label: 'QC' },
  { id: 'notes',   label: 'Notes' },
];

function Field({ label, error, required, hint, children }) {
  return (
    <div>
      <label style={LABEL}>{label}{required && <span style={{ color: '#DC2626' }}> *</span>}</label>
      {children}
      {error && <div style={ERR}>{error}</div>}
      {!error && hint && <div style={HINT}>{hint}</div>}
    </div>
  );
}

function Sel({ value, onChange, options, placeholder = 'Select…', error }) {
  return (
    <select value={value ?? ''} onChange={onChange}
      style={{ ...INPUT, cursor: 'pointer', ...(error ? { borderColor: '#DC2626' } : {}) }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 15, height: 15, cursor: 'pointer' }} />
      {label}
    </label>
  );
}

export default function ItemForm({ values, errors, onChange, onSave, onCancel, saving, isEdit, lookups = {} }) {
  const [activeTab, setActiveTab] = useState('basic');

  const {
    item_types       = [],
    item_categories  = [],
    uom_master       = [],
    qc_types         = [],
  } = lookups;

  const typeOpts  = item_types.map(t      => ({ id: t.id, label: t.type_name  ?? t.type_code }));
  const catOpts   = item_categories.map(c => ({ id: c.id, label: c.category_name ?? c.category_code }));
  const uomOpts   = uom_master.map(u      => ({ id: u.id, label: `${u.uom_name} (${u.uom_code})` }));
  const qcOpts    = qc_types.map(q        => ({ id: q.id, label: q.type_name  ?? q.type_code }));

  function set(field)    { return e => onChange(field, e.target.value); }
  function setNum(field) { return e => onChange(field, e.target.value === '' ? null : Number(e.target.value)); }

  function inp(field, extra = {}) {
    return {
      value:    values[field] ?? '',
      onChange: set(field),
      style:    { ...INPUT, ...(errors[field] ? { borderColor: '#DC2626' } : {}), ...extra },
    };
  }

  // ─── Tab: Basic ─────────────────────────────────────────────────────────────

  function TabBasic() {
    return (
      <div>
        {/* Quick toggles */}
        <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick flags</span>
          <Checkbox label="Purchasable"  checked={values.is_purchasable}  onChange={v => onChange('is_purchasable', v)} />
          <Checkbox label="Sellable"     checked={values.is_sellable}     onChange={v => onChange('is_sellable', v)} />
          <Checkbox label="Manufactured" checked={values.is_manufactured} onChange={v => onChange('is_manufactured', v)} />
          <Checkbox label="Stocked"      checked={values.is_stocked}      onChange={v => onChange('is_stocked', v)} />
        </div>

        <div style={GRID2}>
          <Field label="Item Code" error={errors.item_code} hint="Auto-uppercased · must be unique">
            <input {...inp('item_code')}
              placeholder="e.g. RM001, BP101, VO-PF101"
              style={{ ...INPUT, textTransform: 'uppercase', ...(errors.item_code ? { borderColor: '#DC2626' } : {}) }}
            />
          </Field>

          <Field label="Item Name" required error={errors.item_name}>
            <input {...inp('item_name')} placeholder="Full item name" />
          </Field>

          <Field label="Item Type" error={errors.item_type_id}>
            <Sel value={values.item_type_id} error={errors.item_type_id}
              onChange={e => onChange('item_type_id', e.target.value || null)}
              options={typeOpts} placeholder="Select type…" />
          </Field>

          <Field label="Category" error={errors.category_id}>
            <Sel value={values.category_id} error={errors.category_id}
              onChange={e => onChange('category_id', e.target.value || null)}
              options={catOpts} placeholder="Select category…" />
          </Field>

          <Field label="Status">
            <select value={values.is_active !== undefined ? String(values.is_active) : 'true'}
              onChange={e => onChange('is_active', e.target.value === 'true')}
              style={{ ...INPUT, cursor: 'pointer' }}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
        </div>
      </div>
    );
  }

  // ─── Tab: UOM & Commercial ───────────────────────────────────────────────────

  function TabUom() {
    return (
      <div>
        <div style={{ ...GRID3, marginBottom: 20 }}>
          <Field label="Base UOM" required error={errors.uom_id}>
            <Sel value={values.uom_id} error={errors.uom_id}
              onChange={e => onChange('uom_id', e.target.value || null)}
              options={uomOpts} placeholder="Select UOM…" />
          </Field>

          <Field label="Purchase UOM" hint="Leave blank to use Base UOM">
            <Sel value={values.purchase_uom_id}
              onChange={e => onChange('purchase_uom_id', e.target.value || null)}
              options={uomOpts} placeholder="Same as base" />
          </Field>

          <Field label="Sales UOM" hint="Leave blank to use Base UOM">
            <Sel value={values.sales_uom_id}
              onChange={e => onChange('sales_uom_id', e.target.value || null)}
              options={uomOpts} placeholder="Same as base" />
          </Field>
        </div>

        <div style={GRID3}>
          <Field label="HSN Code" hint="8-digit GST HSN/SAC code">
            <input {...inp('hsn_code')} placeholder="e.g. 87082900" maxLength={8} />
          </Field>

          <Field label="Standard Sales Rate (₹)">
            <input value={values.standard_rate ?? ''} onChange={setNum('standard_rate')}
              type="number" min="0" step="any" placeholder="0.00"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>

          <Field label="Costing Method">
            <select value={values.costing_method ?? ''}
              onChange={e => onChange('costing_method', e.target.value || null)}
              style={{ ...INPUT, cursor: 'pointer' }}>
              <option value="">Select…</option>
              <option value="standard">Standard</option>
              <option value="average">Moving Average</option>
              <option value="fifo">FIFO</option>
            </select>
          </Field>

          <Field label="Standard Cost (₹)">
            <input value={values.standard_cost ?? ''} onChange={setNum('standard_cost')}
              type="number" min="0" step="any" placeholder="0.00"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>

          <Field label="Last Purchase Rate (₹)" hint="Updated automatically on GRN posting">
            <input value={values.last_purchase_rate ?? ''} onChange={setNum('last_purchase_rate')}
              type="number" min="0" step="any" placeholder="0.00"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
        </div>
      </div>
    );
  }

  // ─── Tab: Inventory ──────────────────────────────────────────────────────────

  function TabInventory() {
    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <Checkbox label="Item is stocked (tracked in inventory)"
            checked={values.is_stocked}
            onChange={v => onChange('is_stocked', v)} />
        </div>
        <div style={GRID3}>
          <Field label="Min Stock" hint="Reorder trigger level">
            <input value={values.min_stock ?? ''} onChange={setNum('min_stock')}
              type="number" min="0" step="any" placeholder="0"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="Max Stock" hint="Maximum storage level">
            <input value={values.max_stock ?? ''} onChange={setNum('max_stock')}
              type="number" min="0" step="any" placeholder="0"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="Reorder Qty" hint="Standard reorder quantity">
            <input value={values.reorder_qty ?? ''} onChange={setNum('reorder_qty')}
              type="number" min="0" step="any" placeholder="0"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
        </div>
      </div>
    );
  }

  // ─── Tab: Manufacturing ──────────────────────────────────────────────────────

  function TabManufacturing() {
    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <Checkbox label="This item is manufactured (enables BOM)"
            checked={values.is_manufactured}
            onChange={v => onChange('is_manufactured', v)} />
        </div>

        <div style={{ ...GRID2, marginBottom: 20 }}>
          <Field label="Formulation Code" hint="Groups items by formulation — free text, no lookup table">
            <input {...inp('formulation_code')} placeholder="e.g. FC-001" />
          </Field>
          <Field label="Formulation Name">
            <input {...inp('formulation_name')} placeholder="e.g. Standard Ceramic Mix" />
          </Field>
        </div>

        <div style={GRID3}>
          <Field label="Weight (g)">
            <input value={values.weight_g ?? ''} onChange={setNum('weight_g')}
              type="number" min="0" step="any" placeholder="0.00"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="Preform Weight (g)">
            <input value={values.preform_weight_g ?? ''} onChange={setNum('preform_weight_g')}
              type="number" min="0" step="any" placeholder="0.00"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="BP Weight (g)">
            <input value={values.bp_weight_g ?? ''} onChange={setNum('bp_weight_g')}
              type="number" min="0" step="any" placeholder="0.00"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="Pieces Per Set">
            <input value={values.pcs_per_set ?? ''} onChange={setNum('pcs_per_set')}
              type="number" min="0" step="1" placeholder="e.g. 4"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="Cavity Count">
            <input value={values.cavity_count ?? ''} onChange={setNum('cavity_count')}
              type="number" min="0" step="1" placeholder="e.g. 2"
              style={{ ...INPUT, textAlign: 'right' }} />
          </Field>
          <Field label="Grinder Category">
            <input {...inp('grinder_category')} placeholder="e.g. Heavy, Light" />
          </Field>
          <Field label="Drawing No">
            <input {...inp('drawing_no')} placeholder="Drawing reference" />
          </Field>
        </div>
      </div>
    );
  }

  // ─── Tab: QC ────────────────────────────────────────────────────────────────

  function TabQc() {
    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <Checkbox label="QC required for this item"
            checked={values.qc_required}
            onChange={v => onChange('qc_required', v)} />
        </div>

        {values.qc_required && (
          <div style={{ maxWidth: 360 }}>
            <Field label="Default QC Type" hint="Applied when this item is inspected">
              <Sel value={values.default_qc_type_id}
                onChange={e => onChange('default_qc_type_id', e.target.value || null)}
                options={qcOpts} placeholder="Select QC type…" />
            </Field>
          </div>
        )}

        {!values.qc_required && (
          <div style={{ padding: '20px 0', color: '#9CA3AF', fontSize: 13 }}>
            Enable "QC required" above to assign a default QC type.
          </div>
        )}
      </div>
    );
  }

  // ─── Tab: Notes ─────────────────────────────────────────────────────────────

  function TabNotes() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Description">
          <textarea value={values.description ?? ''} onChange={set('description')} rows={4}
            placeholder="Item description…"
            style={{ ...INPUT, height: 'auto', padding: '8px 12px', resize: 'vertical', lineHeight: 1.5 }} />
        </Field>
        <Field label="Internal Notes">
          <textarea value={values.notes ?? ''} onChange={set('notes')} rows={4}
            placeholder="Internal notes about this item…"
            style={{ ...INPUT, height: 'auto', padding: '8px 12px', resize: 'vertical', lineHeight: 1.5 }} />
        </Field>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  function renderActiveTab() {
    switch (activeTab) {
      case 'basic': return TabBasic();
      case 'uom': return TabUom();
      case 'inv': return TabInventory();
      case 'mfg': return TabManufacturing();
      case 'qc': return TabQc();
      case 'notes': return TabNotes();
      default: return TabBasic();
    }
  }

  return (
    <div style={{ maxWidth: 900, paddingBottom: 80 }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', marginBottom: 24, gap: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              height: 40, padding: '0 18px', border: 'none', background: 'none',
              fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
              color:        activeTab === tab.id ? '#2563EB' : '#6B7280',
              borderBottom: activeTab === tab.id ? '2px solid #2563EB' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <div style={{ minHeight: 300 }}>
        {renderActiveTab()}
      </div>

      {/* Fixed footer */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #E5E7EB',
        padding: '12px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', zIndex: 100,
      }}>
        <button onClick={onCancel}
          style={{ height: 36, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', padding: '0 16px', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saving}
          style={{ height: 36, background: saving ? '#93C5FD' : '#2563EB', color: '#fff', border: 'none', borderRadius: 6, padding: '0 20px', fontSize: 13, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Item'}
        </button>
      </div>

    </div>
  );
}
