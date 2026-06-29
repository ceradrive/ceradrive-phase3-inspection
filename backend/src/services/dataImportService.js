import { supabase } from '../config/supabase.js';
import * as itemService from './itemService.js';
import * as stageRecipeService from './stageRecipeService.js';
import * as customerService from './customerService.js';
import * as supplierService from './supplierService.js';

function text(v) { return String(v ?? '').trim(); }
function upper(v) { return text(v).toUpperCase(); }
function bool(v, fallback = false) {
  const s = text(v).toLowerCase();
  if (!s) return fallback;
  return ['true','yes','y','1','on'].includes(s);
}
function num(v, fallback = null) {
  if (v === undefined || v === null || text(v) === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function rowError(row_no, message, field = null) {
  return { row_no, ok: false, action: 'ERROR', error: message, field };
}
function normaliseRows(rows) {
  return Array.isArray(rows) ? rows.map((r, idx) => ({ row_no: idx + 2, row: r || {} })) : [];
}

async function lookupMaps() {
  const [typesRes, catsRes, uomsRes, processesRes, machinesRes, itemsRes] = await Promise.all([
    supabase.from('item_types').select('id,type_code').eq('is_active', true),
    supabase.from('item_categories').select('id,category_code').eq('is_active', true),
    supabase.from('uom_master').select('id,uom_code').eq('is_active', true),
    supabase.from('process_types').select('id,type_code').eq('is_active', true),
    supabase.from('machine_master').select('id,machine_code').eq('is_active', true),
    supabase.from('item_master').select('id,item_code,item_name,uom_id').eq('is_active', true),
  ]);
  for (const res of [typesRes, catsRes, uomsRes, processesRes, machinesRes, itemsRes]) if (res.error) throw res.error;
  return {
    typeByCode: new Map((typesRes.data || []).map(x => [upper(x.type_code), x])),
    catByCode: new Map((catsRes.data || []).map(x => [upper(x.category_code), x])),
    uomByCode: new Map((uomsRes.data || []).map(x => [upper(x.uom_code), x])),
    processByCode: new Map((processesRes.data || []).map(x => [upper(x.type_code), x])),
    machineByCode: new Map((machinesRes.data || []).map(x => [upper(x.machine_code), x])),
    itemByCode: new Map((itemsRes.data || []).map(x => [upper(x.item_code), x])),
  };
}

export function getTemplate(docType) {
  if (docType === 'ITEM_MASTER') return [
    'item_code','item_name','item_type_code','category_code','uom_code',
    'purchase_uom_code','sales_uom_code','stage_type','planning_unit','make_policy',
    'is_purchasable','is_sellable','is_manufactured','is_stocked',
    'calculation_basis','pcs_per_set','bp_weight_g','weight_g','notes'
  ];
  if (docType === 'RECIPE_BUILDER') return [
    'recipe_code','recipe_name','fg_item_code','status',
    'step_no','output_item_code','to_make_qty','to_make_uom',
    'process_code','machine_code','calculation_basis',
    'input_item_code','input_qty','input_uom','qty_basis',
    'qc_required','fpa_required','notes'
  ];
  if (docType === 'CUSTOMER_MASTER') return [
    'customer_code','customer_name','customer_type','gstin','pan',
    'contact_name','contact_mobile','contact_email',
    'address_line1','address_line2','city','state','pincode','country',
    'credit_days','credit_limit','notes','is_active'
  ];
  if (docType === 'SUPPLIER_MASTER') return [
    'supplier_code','supplier_name','supplier_type','gstin','pan',
    'contact_name','contact_mobile','contact_email',
    'city','state','credit_days','payment_terms','default_currency','notes','is_active'
  ];
  throw { code: 'VALIDATION_ERROR', message: 'Unsupported import document type.' };
}

async function validateItemRows(rows, mode = 'create') {
  const maps = await lookupMaps();
  const out = [];
  const inputRows = normaliseRows(rows);
  const codes = inputRows.map(x => upper(x.row.item_code)).filter(Boolean);
  const existing = codes.length
    ? await supabase.from('item_master').select('id,item_code').in('item_code', [...new Set(codes)])
    : { data: [], error: null };
  if (existing.error) throw existing.error;
  const existingByCode = new Map((existing.data || []).map(x => [upper(x.item_code), x]));

  for (const { row_no, row } of inputRows) {
    const item_code = upper(row.item_code);
    const item_name = text(row.item_name);
    if (!item_code) { out.push(rowError(row_no, 'item_code required', 'item_code')); continue; }
    if (!item_name) { out.push(rowError(row_no, 'item_name required', 'item_name')); continue; }

    const type = maps.typeByCode.get(upper(row.item_type_code));
    const cat = maps.catByCode.get(upper(row.category_code));
    const uom = maps.uomByCode.get(upper(row.uom_code));
    const puom = upper(row.purchase_uom_code) ? maps.uomByCode.get(upper(row.purchase_uom_code)) : null;
    const suom = upper(row.sales_uom_code) ? maps.uomByCode.get(upper(row.sales_uom_code)) : null;

    if (!type) { out.push(rowError(row_no, `Item type not found: ${row.item_type_code}`, 'item_type_code')); continue; }
    if (!cat) { out.push(rowError(row_no, `Category not found: ${row.category_code}`, 'category_code')); continue; }
    if (!uom) { out.push(rowError(row_no, `UOM not found: ${row.uom_code}`, 'uom_code')); continue; }

    const exists = existingByCode.get(item_code);
    if (mode === 'create' && exists) {
      out.push({ row_no, ok: false, action: 'SKIP', error: 'Item already exists', item_code });
      continue;
    }

    out.push({
      row_no,
      ok: true,
      action: exists ? 'UPDATE' : 'CREATE',
      item_code,
      payload: {
        item_code,
        item_name,
        item_type_id: type.id,
        category_id: cat.id,
        uom_id: uom.id,
        purchase_uom_id: puom?.id || null,
        sales_uom_id: suom?.id || null,
        stage_type: upper(row.stage_type) || null,
        planning_unit: upper(row.planning_unit) || null,
        make_policy: upper(row.make_policy) || null,
        is_purchasable: bool(row.is_purchasable, false),
        is_sellable: bool(row.is_sellable, false),
        is_manufactured: bool(row.is_manufactured, false),
        is_stocked: bool(row.is_stocked, true),
        calculation_basis: upper(row.calculation_basis) || null,
        pcs_per_set: num(row.pcs_per_set),
        bp_weight_g: num(row.bp_weight_g),
        weight_g: num(row.weight_g),
        notes: text(row.notes) || null,
      },
      existing_id: exists?.id || null,
    });
  }
  return out;
}

async function validateRecipeRows(rows, mode = 'create') {
  const maps = await lookupMaps();
  const inputRows = normaliseRows(rows);
  const grouped = new Map();
  const errors = [];

  for (const { row_no, row } of inputRows) {
    const recipe_code = upper(row.recipe_code);
    const step_no = Number(row.step_no || 0);
    if (!recipe_code) { errors.push(rowError(row_no, 'recipe_code required', 'recipe_code')); continue; }
    if (!(step_no > 0)) { errors.push(rowError(row_no, 'valid step_no required', 'step_no')); continue; }

    if (!grouped.has(recipe_code)) grouped.set(recipe_code, { headerRow: row, steps: new Map(), rowNos: [] });
    const group = grouped.get(recipe_code);
    group.rowNos.push(row_no);

    if (!group.steps.has(step_no)) group.steps.set(step_no, { row, inputs: [] });
    group.steps.get(step_no).inputs.push({ row_no, row });
  }

  const recipes = [];
  for (const [recipe_code, group] of grouped.entries()) {
    const h = group.headerRow;
    const recipe_name = text(h.recipe_name);
    const fg = maps.itemByCode.get(upper(h.fg_item_code));
    if (!recipe_name) { errors.push(rowError(group.rowNos[0], 'recipe_name required', 'recipe_name')); continue; }
    if (!fg) { errors.push(rowError(group.rowNos[0], `FG item not found: ${h.fg_item_code}`, 'fg_item_code')); continue; }

    const steps = [];
    for (const [step_no, stepGroup] of [...group.steps.entries()].sort((a,b) => a[0] - b[0])) {
      const sr = stepGroup.row;
      const output = maps.itemByCode.get(upper(sr.output_item_code));
      const uom = maps.uomByCode.get(upper(sr.to_make_uom));
      const process = upper(sr.process_code) ? maps.processByCode.get(upper(sr.process_code)) : null;
      const machine = upper(sr.machine_code) ? maps.machineByCode.get(upper(sr.machine_code)) : null;

      if (!output) { errors.push(rowError(stepGroup.inputs[0].row_no, `Output item not found: ${sr.output_item_code}`, 'output_item_code')); continue; }
      if (!uom) { errors.push(rowError(stepGroup.inputs[0].row_no, `To make UOM not found: ${sr.to_make_uom}`, 'to_make_uom')); continue; }

      const inputs = [];
      for (const { row_no, row } of stepGroup.inputs) {
        const inp = maps.itemByCode.get(upper(row.input_item_code));
        const iuom = maps.uomByCode.get(upper(row.input_uom));
        const qty = num(row.input_qty);
        if (!inp) { errors.push(rowError(row_no, `Input item not found: ${row.input_item_code}`, 'input_item_code')); continue; }
        if (!iuom) { errors.push(rowError(row_no, `Input UOM not found: ${row.input_uom}`, 'input_uom')); continue; }
        if (!(qty > 0)) { errors.push(rowError(row_no, 'input_qty must be > 0', 'input_qty')); continue; }
        inputs.push({ input_item_id: inp.id, qty, uom_id: iuom.id, qty_basis: upper(row.qty_basis) || 'PER_BATCH', notes: text(row.notes) || null });
      }

      steps.push({
        step_no,
        output_item_id: output.id,
        output_basis_qty: num(sr.to_make_qty, 1),
        output_basis_uom_id: uom.id,
        process_type_id: process?.id || null,
        machine_id: machine?.id || null,
        calculation_basis: upper(sr.calculation_basis) || null,
        qc_required: bool(sr.qc_required, false),
        fpa_required: bool(sr.fpa_required, false),
        notes: text(sr.notes) || null,
        inputs,
      });
    }

    recipes.push({
      recipe_code,
      recipe_name,
      fg_item_id: fg.id,
      status: text(h.status) || 'draft',
      planning_unit: null,
      make_policy: null,
      notes: text(h.notes) || null,
      steps,
    });
  }

  const existing = recipes.length
    ? await supabase.from('stage_recipe_headers').select('id,recipe_code').in('recipe_code', recipes.map(r => r.recipe_code))
    : { data: [], error: null };
  if (existing.error) throw existing.error;
  const existingByCode = new Map((existing.data || []).map(x => [upper(x.recipe_code), x]));

  return [
    ...errors,
    ...recipes.map((r) => {
      const exists = existingByCode.get(r.recipe_code);
      if (mode === 'create' && exists) return { row_no: 0, ok: false, action: 'SKIP', recipe_code: r.recipe_code, error: 'Recipe already exists' };
      return { row_no: 0, ok: true, action: exists ? 'UPDATE' : 'CREATE', recipe_code: r.recipe_code, payload: r, existing_id: exists?.id || null };
    }),
  ];
}

async function importItemRows(rows, mode, userId) {
  const preview = await validateItemRows(rows, mode);
  const result = [];
  for (const r of preview) {
    if (!r.ok) { result.push(r); continue; }
    const res = r.existing_id ? await itemService.updateItem(r.existing_id, r.payload, userId) : await itemService.createItem(r.payload, userId);
    result.push(res.error ? { ...r, ok: false, action: 'ERROR', error: res.error.message || 'Import failed' } : { ...r, imported_id: res.data?.id || r.existing_id });
  }
  return result;
}

async function importRecipeRows(rows, mode, userId) {
  const preview = await validateRecipeRows(rows, mode);
  const result = [];
  for (const r of preview) {
    if (!r.ok) { result.push(r); continue; }
    const res = r.existing_id ? await stageRecipeService.updateStageRecipe(r.existing_id, r.payload, userId) : await stageRecipeService.createStageRecipe(r.payload, userId);
    result.push(res.error ? { ...r, ok: false, action: 'ERROR', error: res.error.message || 'Import failed' } : { ...r, imported_id: res.data?.id || r.existing_id });
  }
  return result;
}


async function validateCustomerRows(rows, mode = 'create') {
  const out = [];
  const inputRows = normaliseRows(rows);
  const codes = inputRows.map(x => upper(x.row.customer_code)).filter(Boolean);
  const existing = codes.length
    ? await supabase.from('customer_master').select('id,customer_code').in('customer_code', [...new Set(codes)])
    : { data: [], error: null };
  if (existing.error) throw existing.error;
  const existingByCode = new Map((existing.data || []).map(x => [upper(x.customer_code), x]));

  for (const { row_no, row } of inputRows) {
    const customer_code = upper(row.customer_code);
    const customer_name = text(row.customer_name);

    if (!customer_code) { out.push(rowError(row_no, 'customer_code required', 'customer_code')); continue; }
    if (!customer_name) { out.push(rowError(row_no, 'customer_name required', 'customer_name')); continue; }

    const exists = existingByCode.get(customer_code);
    if (mode === 'create' && exists) {
      out.push({ row_no, ok: false, action: 'SKIP', customer_code, error: 'Customer already exists' });
      continue;
    }

    out.push({
      row_no,
      ok: true,
      action: exists ? 'UPDATE' : 'CREATE',
      customer_code,
      payload: {
        customer_code,
        customer_name,
        customer_type: text(row.customer_type) || null,
        gstin: upper(row.gstin) || null,
        pan: upper(row.pan) || null,
        contact_name: text(row.contact_name) || null,
        contact_mobile: text(row.contact_mobile) || null,
        contact_email: text(row.contact_email) || null,
        address_line1: text(row.address_line1) || null,
        address_line2: text(row.address_line2) || null,
        city: text(row.city) || null,
        state: text(row.state) || null,
        pincode: text(row.pincode) || null,
        country: text(row.country) || 'India',
        credit_days: num(row.credit_days),
        credit_limit: num(row.credit_limit),
        notes: text(row.notes) || null,
        is_active: bool(row.is_active, true),
      },
      existing_id: exists?.id || null,
    });
  }

  return out;
}

async function importCustomerRows(rows, mode, userId) {
  const preview = await validateCustomerRows(rows, mode);
  const result = [];

  for (const r of preview) {
    if (!r.ok) { result.push(r); continue; }
    const res = r.existing_id
      ? await customerService.updateCustomer(r.existing_id, r.payload, userId)
      : await customerService.createCustomer(r.payload, userId);

    result.push(res.error
      ? { ...r, ok: false, action: 'ERROR', error: res.error.message || 'Import failed' }
      : { ...r, imported_id: res.data?.id || r.existing_id });
  }

  return result;
}

async function validateSupplierRows(rows, mode = 'create') {
  const out = [];
  const inputRows = normaliseRows(rows);
  const codes = inputRows.map(x => upper(x.row.supplier_code)).filter(Boolean);
  const existing = codes.length
    ? await supabase.from('supplier_master').select('id,supplier_code').in('supplier_code', [...new Set(codes)])
    : { data: [], error: null };
  if (existing.error) throw existing.error;
  const existingByCode = new Map((existing.data || []).map(x => [upper(x.supplier_code), x]));

  for (const { row_no, row } of inputRows) {
    const supplier_code = upper(row.supplier_code);
    const supplier_name = text(row.supplier_name);

    if (!supplier_code) { out.push(rowError(row_no, 'supplier_code required', 'supplier_code')); continue; }
    if (!supplier_name) { out.push(rowError(row_no, 'supplier_name required', 'supplier_name')); continue; }

    const exists = existingByCode.get(supplier_code);
    if (mode === 'create' && exists) {
      out.push({ row_no, ok: false, action: 'SKIP', supplier_code, error: 'Supplier already exists' });
      continue;
    }

    out.push({
      row_no,
      ok: true,
      action: exists ? 'UPDATE' : 'CREATE',
      supplier_code,
      payload: {
        supplier_code,
        supplier_name,
        supplier_type: text(row.supplier_type) || null,
        gstin: upper(row.gstin) || null,
        pan: upper(row.pan) || null,
        contact_name: text(row.contact_name) || null,
        contact_mobile: text(row.contact_mobile) || null,
        contact_email: text(row.contact_email) || null,
        city: text(row.city) || null,
        state: text(row.state) || null,
        credit_days: num(row.credit_days),
        payment_terms: text(row.payment_terms) || null,
        default_currency: text(row.default_currency) || 'INR',
        notes: text(row.notes) || null,
        is_active: bool(row.is_active, true),
      },
      existing_id: exists?.id || null,
    });
  }

  return out;
}

async function importSupplierRows(rows, mode, userId) {
  const preview = await validateSupplierRows(rows, mode);
  const result = [];

  for (const r of preview) {
    if (!r.ok) { result.push(r); continue; }
    const res = r.existing_id
      ? await supplierService.updateSupplier(r.existing_id, r.payload, userId)
      : await supplierService.createSupplier(r.payload, userId);

    result.push(res.error
      ? { ...r, ok: false, action: 'ERROR', error: res.error.message || 'Import failed' }
      : { ...r, imported_id: res.data?.id || r.existing_id });
  }

  return result;
}


export async function previewImport({ doc_type, mode = 'create', rows = [] }) {
  try {
    if (doc_type === 'ITEM_MASTER') return { data: await validateItemRows(rows, mode), error: null };
    if (doc_type === 'RECIPE_BUILDER') return { data: await validateRecipeRows(rows, mode), error: null };
    if (doc_type === 'CUSTOMER_MASTER') return { data: await validateCustomerRows(rows, mode), error: null };
    if (doc_type === 'SUPPLIER_MASTER') return { data: await validateSupplierRows(rows, mode), error: null };
    throw { code: 'VALIDATION_ERROR', message: 'Unsupported import document type.' };
  } catch (err) { return { data: null, error: err }; }
}

export async function runImport({ doc_type, mode = 'create', rows = [] }, userId) {
  try {
    if (doc_type === 'ITEM_MASTER') return { data: await importItemRows(rows, mode, userId), error: null };
    if (doc_type === 'RECIPE_BUILDER') return { data: await importRecipeRows(rows, mode, userId), error: null };
    if (doc_type === 'CUSTOMER_MASTER') return { data: await importCustomerRows(rows, mode, userId), error: null };
    if (doc_type === 'SUPPLIER_MASTER') return { data: await importSupplierRows(rows, mode, userId), error: null };
    throw { code: 'VALIDATION_ERROR', message: 'Unsupported import document type.' };
  } catch (err) { return { data: null, error: err }; }
}
