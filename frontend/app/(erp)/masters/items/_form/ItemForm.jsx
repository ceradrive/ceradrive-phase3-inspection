'use client';

// ItemForm — shared Item Master form. One generic Field renderer (edit + read-only) drives every
// section, so Create and Edit (and view vs edit) share all rendering. Layout is faithful to the
// original. Special blocks: UOM (UomFields), flags, textareas, vehicles, system/audit.
import { useEffect, useState } from 'react';
import UomFields from '../_uom/UomFields.jsx';
import { LookupPicker, VehicleCompatEditor, optionLabel, STAGE_TYPE_OPTIONS, MAKE_POLICY_OPTIONS, PLANNING_UNIT_OPTIONS, CALC_BASIS_OPTIONS } from './components.jsx';
import * as S from './styles.js';

const typeLabel = (t) => `${t.type_name}${t.type_code ? ` (${t.type_code})` : ''}`;
const catLabel = (c) => `${c.category_name}${c.category_code ? ` (${c.category_code})` : ''}`;
const qcLabel = (q) => `${q.type_name}${q.type_code ? ` (${q.type_code})` : ''}`;

// Declarative field configs per section (generic grid fields only).
const F = {
  basicTop: [
    { k: 'item_code', label: 'Code *', type: 'text', uppercase: true, mono: true, maxLength: 50, ph: 'e.g. RM-PHENOLIC-01', hint: 'Stored uppercase.', err: 'item_code', lockEdit: true, roHint: 'Code cannot be changed after creation.' },
    { k: 'item_name', label: 'Name *', type: 'text', maxLength: 150, ph: 'e.g. Phenolic Resin Powder', err: 'item_name' },
    { k: 'item_type_id', label: 'Item Type *', type: 'lookup', lookup: 'types', getLabel: typeLabel, ph: 'Search type…', err: 'item_type_id', addKind: 'item_type', addLabel: 'Add Item Type' },
    { k: 'category_id', label: 'Category *', type: 'lookup', lookup: 'categories', getLabel: catLabel, ph: 'Search category…', err: 'category_id', addKind: 'category', addLabel: 'Add Category' },
  ],
  basicBottom: [
    { k: 'barcode', label: 'Barcode', type: 'text', ph: 'Optional' },
    { k: 'hsn_code', label: 'HSN Code', type: 'text', maxLength: 20, ph: 'Optional' },
  ],
  stage: [
    { k: 'stage_type', label: 'Stage Type', type: 'select', options: STAGE_TYPE_OPTIONS, hint: 'Example: BP, SBBP, ACBP, PF, MLD, STK, FG.' },
    { k: 'make_policy', label: 'Make Policy', type: 'select', options: MAKE_POLICY_OPTIONS, hint: 'Mixing to stacking = Make to Stock; dispatch/packing = Make to Order.' },
    { k: 'planning_unit', label: 'Planning Unit (advanced)', type: 'select', options: PLANNING_UNIT_OPTIONS, hint: 'Advanced. Engine planning grain; normally the same as Base UOM. Leave as-is unless required.' },
    { k: 'calculation_basis', label: 'Calculation Basis', type: 'select', options: CALC_BASIS_OPTIONS },
  ],
  mfgDefaults: [
    { k: 'weight_g', label: 'Item Weight (g)', type: 'num', ph: 'For weight/batch calculation' },
    { k: 'bp_weight_g', label: 'Back Plate Weight (g)', type: 'num', ph: 'For BP/SBBP shot blasting' },
    { k: 'preform_weight_g', label: 'Preform Weight (g)', type: 'num', ph: 'For PF/mix planning' },
    { k: 'default_pcs_per_tray', label: 'Default PCS / Tray', type: 'num', ph: 'For adhesive/powder/oven tray loading' },
    { k: 'default_pcs_per_crate', label: 'Default PCS / Crate', type: 'num', ph: 'For stacking/storage' },
    { k: 'cavity_count', label: 'Default Cavity Count', type: 'num', ph: 'Fallback only; Die Master is preferred' },
    { k: 'grinder_category', label: 'Grinder Category', type: 'text', ph: 'Optional' },
  ],
  formDims: [
    { k: 'formulation_code', label: 'Formulation Code', type: 'text', ph: 'Optional' },
    { k: 'formulation_name', label: 'Formulation Name', type: 'text', ph: 'Optional' },
    { k: 'length_mm', label: 'Length (mm)', type: 'num', ph: 'Optional' },
    { k: 'width_mm', label: 'Width (mm)', type: 'num', ph: 'Optional' },
    { k: 'thickness_mm', label: 'Thickness (mm)', type: 'num', ph: 'Optional' },
  ],
  inventory: [
    { k: 'min_stock', label: 'Min Stock', type: 'num', ph: 'Optional' },
    { k: 'max_stock', label: 'Max Stock', type: 'num', ph: 'Optional' },
    { k: 'reorder_qty', label: 'Reorder Qty', type: 'num', ph: 'Optional' },
    { k: 'min_order_qty', label: 'Min Order Qty', type: 'num', ph: 'Optional' },
  ],
  commercial: [
    { k: 'costing_method', label: 'Costing Method', type: 'text', ph: 'Optional' },
    { k: 'standard_cost', label: 'Standard Cost', type: 'num', ph: 'Optional' },
    { k: 'last_purchase_rate', label: 'Last Purchase Rate', type: 'num', ph: 'Optional' },
    { k: 'standard_rate', label: 'Standard Rate', type: 'num', ph: 'Optional' },
  ],
  drawings: [
    { k: 'drawing_no', label: 'Drawing No', type: 'text', ph: 'Optional' },
    { k: 'item_image_url', label: 'Item Image URL', type: 'text', ph: 'Optional' },
    { k: 'drawing_image_url', label: 'Drawing Image URL', type: 'text', ph: 'Optional' },
    { k: 'drawing_pdf_url', label: 'Drawing PDF URL', type: 'text', ph: 'Optional' },
  ],
};

function Field({ f, ctx }) {
  const { form, set, errors, editing, mode, lookups, openAddLookup, item } = ctx;
  const editable = editing && !(f.lockEdit && mode === 'edit');
  const err = f.err ? errors[f.err] : undefined;
  const val = form[f.k];

  if (!editable) {
    const rv = item ? item[f.k] : val;
    let display;
    if (f.type === 'select') display = optionLabel(f.options, rv) || '—';
    else if (f.type === 'lookup') { const o = (lookups[f.lookup] || []).find((x) => x.id === rv); display = o ? f.getLabel(o) : '—'; }
    else display = (rv || rv === 0) ? rv : '—';
    return (
      <div style={S.fieldWrap}>
        <label style={S.lbl}>{f.label.replace(' *', '')}</label>
        <div style={S.roBox}>{display}</div>
        {f.lockEdit && mode === 'edit' && f.roHint ? <span style={S.hintStyle}>{f.roHint}</span> : null}
      </div>
    );
  }

  let input;
  if (f.type === 'select') {
    input = <select value={val} onChange={(e) => set(f.k, e.target.value)} style={S.ctrl(!!err)}>{f.options.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  } else if (f.type === 'lookup') {
    input = <LookupPicker options={lookups[f.lookup]} value={val} onChange={(id) => set(f.k, id)} getLabel={f.getLabel} placeholder={f.ph} error={err} addLabel={f.addLabel} onAdd={f.addKind ? (t) => openAddLookup(f.addKind, t) : undefined} />;
  } else {
    input = <input type={f.type === 'num' ? 'number' : 'text'} step={f.type === 'num' ? 'any' : undefined} value={val} onChange={(e) => set(f.k, e.target.value)} placeholder={f.ph} maxLength={f.maxLength} style={{ ...S.ctrl(!!err), ...(f.uppercase ? { textTransform: 'uppercase' } : {}), ...(f.mono ? { fontFamily: 'monospace' } : {}) }} />;
  }
  return (
    <div style={S.fieldWrap}>
      <label style={S.lbl}>{f.label}</label>
      {input}
      {err ? <span style={S.errStyle}>{err}</span> : (f.hint ? <span style={S.hintStyle}>{f.hint}</span> : null)}
    </div>
  );
}

const Grid = ({ fields, ctx }) => <div style={S.grid2(ctx.isMobile)}>{fields.map((f) => <Field key={f.k} f={f} ctx={ctx} />)}</div>;

function Flags({ ctx }) {
  const { form, set, editing, item } = ctx;
  const FL = [['is_active', 'Active'], ['is_purchasable', 'Purchasable'], ['is_sellable', 'Sellable'], ['is_manufactured', 'Manufactured'], ['is_stocked', 'Stocked']];
  return (
    <div style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid #F3F4F6' }}>
      <div style={S.sectionLabel}>Flags</div>
      {editing ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
          {FL.map(([k, label]) => (
            <label key={k} style={S.flagRow}><input type="checkbox" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#6B7280' }}>
          {FL.map(([k, label], i) => <span key={k}>{i ? '· ' : ''}{label}: {(item ? item[k] : form[k]) ? 'Yes' : 'No'}</span>)}
        </div>
      )}
    </div>
  );
}

function TextArea({ k, label, ctx }) {
  const { form, set, editing, item } = ctx;
  return (
    <div style={S.fieldWrap}>
      <label style={S.lbl}>{label}</label>
      {editing
        ? <textarea value={form[k]} onChange={(e) => set(k, e.target.value)} rows={2} placeholder={`Optional ${label.toLowerCase()}…`} style={S.area} />
        : <div style={S.roText}>{(item ? item[k] : form[k]) || '—'}</div>}
    </div>
  );
}

export function Section({ sectionKey: key, ctx }) {
  const { form, set, editing, mode, lookups, openAddLookup, item } = ctx;
  const uomUi = { LookupPicker, ctrl: S.ctrl, lbl: S.lbl, hintStyle: S.hintStyle, fieldWrap: S.fieldWrap, errStyle: S.errStyle, roBox: S.roBox, uomLabel: (u) => u.uom_name ?? u.name ?? u.uom_code ?? u.code ?? u.id, onAddUom: (t) => openAddLookup('uom', t) };

  if (key === 'basic') return (
    <>
      <div style={S.grid2(ctx.isMobile)}>
        {F.basicTop.map((f) => <Field key={f.k} f={f} ctx={ctx} />)}
        <UomFields uoms={lookups.uoms} value={form.uom} onChange={(u) => set('uom', u)} errors={ctx.errors} editing={editing} stageType={form.stage_type} ui={uomUi} />
        {F.basicBottom.map((f) => <Field key={f.k} f={f} ctx={ctx} />)}
      </div>
      <TextArea k="description" label="Description" ctx={ctx} />
      <TextArea k="notes" label="Notes" ctx={ctx} />
      <Flags ctx={ctx} />
    </>
  );

  if (key === 'manufacturing') return (
    <>
      <div style={{ marginBottom: 14, padding: 12, border: '1px solid #E0E7FF', borderRadius: 8, background: '#F8FAFF', color: '#374151', fontSize: 12, lineHeight: 1.5 }}>
        Planner fields help the future Recipe Builder calculate machine time. BOM will still store only input items and quantities.
      </div>
      <div style={S.sectionLabel}>SFG / Stage Settings</div>
      <Grid fields={F.stage} ctx={ctx} />
      <div style={S.sectionLabel}>Manufacturing Defaults</div>
      <Grid fields={F.mfgDefaults} ctx={ctx} />
      <div style={S.sectionLabel}>Formulation &amp; Dimensions</div>
      <Grid fields={F.formDims} ctx={ctx} />
    </>
  );

  if (key === 'inventory') return <Grid fields={F.inventory} ctx={ctx} />;
  if (key === 'commercial') return <Grid fields={F.commercial} ctx={ctx} />;

  if (key === 'qc') return (
    <div style={S.grid2(ctx.isMobile)}>
      <div style={S.fieldWrap}>
        <label style={S.lbl}>QC Required</label>
        {editing
          ? <label style={{ ...S.flagRow, height: 38 }}><input type="checkbox" checked={!!form.qc_required} onChange={(e) => set('qc_required', e.target.checked)} /> Requires QC inspection</label>
          : <div style={S.roBox}>{(item ? item.qc_required : form.qc_required) ? 'Yes' : 'No'}</div>}
      </div>
      <Field f={{ k: 'default_qc_type_id', label: 'Default QC Type', type: 'lookup', lookup: 'qcTypes', getLabel: qcLabel, ph: 'Search QC type…' }} ctx={ctx} />
    </div>
  );

  if (key === 'drawings') return <Grid fields={F.drawings} ctx={ctx} />;

  if (key === 'system') return item ? (
    <div style={S.grid2(ctx.isMobile)}>
      <div style={S.fieldWrap}><label style={S.lbl}>Created</label><div style={S.roBox}>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</div></div>
      <div style={S.fieldWrap}><label style={S.lbl}>Last Updated</label><div style={S.roBox}>{item.updated_at ? new Date(item.updated_at).toLocaleString() : '—'}</div></div>
    </div>
  ) : (
    <div style={{ fontSize: 13, color: '#6B7280', padding: '8px 0' }}>
      System fields (created/updated by &amp; timestamps) are set automatically after the item is saved.
    </div>
  );

  if (key === 'compatibility') return <VehicleCompatEditor value={form.vehicles} onChange={(v) => set('vehicles', v)} editing={editing} />;
  return null;
}

export function ItemFormShell({ title, back, actions, ctx }) {
  const [activeTab, setActiveTab] = useState('basic');
  const [openSections, setOpenSections] = useState({ basic: true });
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', apply) : mq.removeListener(apply); };
  }, []);
  const sctx = { ...ctx, isMobile };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: '#F8F9FA', paddingBottom: 12, marginBottom: 16, borderBottom: '1px solid #E5E7EB' }}>
        <button onClick={back} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>← Items</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>{title}</h1>
          <div style={{ display: 'flex', gap: 10 }}>{actions}</div>
        </div>
      </div>

      {!isMobile && (
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 16, overflowX: 'auto' }}>
          {S.TABS.map(([k, label]) => <button key={k} onClick={() => setActiveTab(k)} style={S.tabBtn(activeTab === k)}>{label}</button>)}
        </div>
      )}
      {!isMobile && <div style={S.cardStyle}><Section sectionKey={activeTab} ctx={sctx} /></div>}

      {isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {S.TABS.map(([k, label]) => (
            <div key={k} style={S.cardStyle}>
              <button onClick={() => setOpenSections((s) => ({ ...s, [k]: !s[k] }))} style={S.accHeader}>
                {label}<span style={{ fontSize: 18, color: '#9CA3AF' }}>{openSections[k] ? '−' : '+'}</span>
              </button>
              {openSections[k] && <div style={{ marginTop: 14 }}><Section sectionKey={k} ctx={sctx} /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
