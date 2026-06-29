// useItemForm — one form-state object for all Item Master fields + hydrate/validate/toPayload.
// Reproduces the original create/edit payload exactly. Reuses the V1 UOM logic.
import { useState } from 'react';
import { deriveUomState, validateUom, buildUomPayload } from '../_uom/uomLogic.js';

export const STRING_OPT = ['barcode', 'hsn_code', 'description', 'notes', 'grinder_category', 'formulation_code', 'formulation_name', 'costing_method', 'drawing_no', 'item_image_url', 'drawing_image_url', 'drawing_pdf_url'];
export const NUMBER_FIELDS = ['weight_g', 'bp_weight_g', 'preform_weight_g', 'default_pcs_per_tray', 'default_pcs_per_crate', 'cavity_count', 'length_mm', 'width_mm', 'thickness_mm', 'min_stock', 'max_stock', 'reorder_qty', 'min_order_qty', 'standard_cost', 'last_purchase_rate', 'standard_rate'];
export const SELECT_FIELDS = ['stage_type', 'make_policy', 'planning_unit', 'calculation_basis'];
export const FLAG_FIELDS = ['is_active', 'is_purchasable', 'is_sellable', 'is_manufactured', 'is_stocked', 'qc_required'];

const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export const BLANK_FORM = () => ({
  item_code: '', item_name: '', item_type_id: '', category_id: '',
  uom: { baseUomId: '', altUomId: '', convFactor: '' }, legacyPcsPerSet: null,
  barcode: '', hsn_code: '', description: '', notes: '',
  is_active: true, is_purchasable: false, is_sellable: false, is_manufactured: false, is_stocked: true,
  qc_required: false, default_qc_type_id: '',
  stage_type: '', make_policy: '', planning_unit: '', calculation_basis: '',
  formulation_code: '', formulation_name: '',
  weight_g: '', bp_weight_g: '', preform_weight_g: '', default_pcs_per_tray: '', default_pcs_per_crate: '', cavity_count: '', grinder_category: '',
  length_mm: '', width_mm: '', thickness_mm: '',
  min_stock: '', max_stock: '', reorder_qty: '', min_order_qty: '',
  costing_method: '', standard_cost: '', last_purchase_rate: '', standard_rate: '',
  drawing_no: '', item_image_url: '', drawing_image_url: '', drawing_pdf_url: '',
  vehicles: [],
});

export function useItemForm() {
  const [form, setForm] = useState(BLANK_FORM());
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Leaving the SET stage clears any Alternate/conversion immediately (no stale SET on non-SET items).
      if (key === 'stage_type' && String(value ?? '').toUpperCase() !== 'SET') {
        next.uom = { ...f.uom, altUomId: '', convFactor: '' };
      }
      return next;
    });
    setErrors((e) => {
      if (key === 'uom') return { ...e, uom_id: undefined, conv_factor: undefined };
      if (key === 'stage_type') return { ...e, stage_type: undefined, uom_id: undefined, conv_factor: undefined };
      if (e[key] === undefined) return e;
      return { ...e, [key]: undefined };
    });
  };

  const hydrate = (item, vehicles) => {
    const d = deriveUomState(item);
    const next = BLANK_FORM();
    next.item_code = item.item_code ?? '';
    next.item_name = item.item_name ?? '';
    next.item_type_id = item.item_type_id ?? '';
    next.category_id = item.category_id ?? '';
    next.uom = { baseUomId: d.baseUomId, altUomId: d.altUomId, convFactor: d.convFactor };
    next.legacyPcsPerSet = d.legacyPcsPerSet;
    next.default_qc_type_id = item.default_qc_type_id ?? '';
    for (const k of STRING_OPT) next[k] = item[k] ?? '';
    for (const k of NUMBER_FIELDS) next[k] = item[k] ?? '';
    for (const k of SELECT_FIELDS) next[k] = item[k] ?? '';
    for (const k of FLAG_FIELDS) next[k] = Boolean(item[k]);
    next.vehicles = vehicles ?? [];
    setForm(next);
  };

  return { form, setForm, set, errors, setErrors, hydrate, validate: (uoms) => validateForm(form, uoms), toPayload: (uoms) => buildPayload(form, uoms) };
}

// Pure (testable) — exact reproduction of the original create/edit validation + payload.
export function validateForm(form, uoms) {
  const errs = {};
  if (!form.item_code.trim()) errs.item_code = 'Code is required.';
  if (!form.item_name.trim()) errs.item_name = 'Name is required.';
  if (!form.item_type_id) errs.item_type_id = 'Item type is required.';
  if (!form.category_id) errs.category_id = 'Category is required.';
  Object.assign(errs, validateUom({ uoms, ...form.uom, stageType: form.stage_type }));
  return errs;
}

export function buildPayload(form, uoms) {
  const p = {
    item_code: form.item_code.trim().toUpperCase(),
    item_name: form.item_name.trim(),
    item_type_id: form.item_type_id,
    category_id: form.category_id,
    ...buildUomPayload({ uoms, ...form.uom, stageType: form.stage_type }),
    default_qc_type_id: form.default_qc_type_id || null,
  };
  for (const k of STRING_OPT) p[k] = form[k].trim() || null;
  for (const k of NUMBER_FIELDS) p[k] = n(form[k]);
  for (const k of SELECT_FIELDS) p[k] = form[k] || null;
  for (const k of FLAG_FIELDS) p[k] = !!form[k];
  p.vehicles = form.vehicles.map((v, i) => ({ vehicle_id: v.vehicle_id, is_default: !!v.is_default, sort_order: i }));
  return p;
}
