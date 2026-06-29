/**
 * CERADRIVE ERP — Supplier Service
 *
 * All data access for the Supplier Master module.
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 *
 * Live schema (confirmed from Architecture Audit v2.1 + codebase):
 *   supplier_master: id, supplier_code, supplier_name, is_active,
 *     supplier_category_id, supplier_type, gstin, pan,
 *     default_tax_id, default_warehouse_id, credit_days, payment_terms,
 *     default_currency, notes, contact_name, contact_mobile, contact_email,
 *     city, state, created_by, created_at, updated_by, updated_at
 *
 * Governance (R45): mandatory fields at go-live = supplier_code, supplier_name, is_active only.
 * All other fields optional. Onboarding must complete in under 30 seconds (R46).
 *
 * GSTIN: Indian format — 15 chars, stored uppercase, validated on save.
 * supplier_code: stored uppercase, unique.
 * Deactivate guard: blocked if referenced by purchase_orders or grn_headers.
 */

import { supabase } from '../config/supabase.js';
function sanitizeOrSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[,%_()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


// ─── GSTIN validation ─────────────────────────────────────────────────────────
// Format: 22AAAAA0000A1Z5 (15 chars)
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function validateGSTIN(raw) {
  if (!raw?.trim()) return null; // optional — blank is valid
  const v = raw.trim().toUpperCase();
  if (!GSTIN_REGEX.test(v)) {
    return 'Invalid GSTIN. Expected format: 22AAAAA0000A1Z5 (15 characters).';
  }
  return null;
}

// ─── Column selects ───────────────────────────────────────────────────────────

const LIST_COLS = `
  id, supplier_code, supplier_name, is_active,
  gstin, contact_name, contact_mobile, contact_email,
  city, state, credit_days, payment_terms,
  created_at, updated_at
`;

const DETAIL_COLS = `
  id, supplier_code, supplier_name, is_active,
  supplier_category_id, supplier_type,
  gstin, pan, default_tax_id, default_warehouse_id,
  credit_days, payment_terms, default_currency,
  notes, contact_name, contact_mobile, contact_email,
  city, state,
  created_by, created_at, updated_by, updated_at
`;

// ─── Live search (used by Create PO supplier dropdown) ────────────────────────

export async function searchSuppliers({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);

  let query = supabase
    .from('supplier_master')
    .select('id, supplier_code, supplier_name')
    .eq('is_active', true)
    .order('supplier_name', { ascending: true })
    .limit(safeLimit);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `supplier_name.ilike.%${safeSearch}%,supplier_code.ilike.%${safeSearch}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listSuppliers({ search, is_active, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('supplier_master')
    .select(LIST_COLS, { count: 'exact' })
    .order('supplier_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `supplier_name.ilike.%${safeSearch}%,supplier_code.ilike.%${safeSearch}%,gstin.ilike.%${safeSearch}%`,
    );
  }
  if (is_active !== undefined && is_active !== '') {
    query = query.eq('is_active', is_active === 'true' || is_active === true);
  }

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getSupplierById(id) {
  const { data, error } = await supabase
    .from('supplier_master')
    .select(DETAIL_COLS)
    .eq('id', id)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Supplier not found.' } };
  return { data, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function createSupplier(body, userId) {
  const { supplier_code, supplier_name } = body;

  if (!supplier_code?.trim()) throw { code: 'VALIDATION_ERROR', message: 'Supplier code is required.' };
  if (!supplier_name?.trim()) throw { code: 'VALIDATION_ERROR', message: 'Supplier name is required.' };

  const code = supplier_code.trim().toUpperCase();

  // Duplicate code check
  const { data: existing } = await supabase
    .from('supplier_master')
    .select('id')
    .eq('supplier_code', code)
    .maybeSingle();
  if (existing) throw { code: 'CONFLICT', message: `Supplier code '${code}' already exists.` };

  // GSTIN validation and uniqueness
  if (body.gstin?.trim()) {
    const gstinErr = validateGSTIN(body.gstin);
    if (gstinErr) throw { code: 'VALIDATION_ERROR', message: gstinErr };

    const normalised = body.gstin.trim().toUpperCase();
    const { data: gstinClash } = await supabase
      .from('supplier_master')
      .select('id, supplier_name')
      .eq('gstin', normalised)
      .maybeSingle();
    if (gstinClash) {
      throw { code: 'CONFLICT', message: `GSTIN '${normalised}' is already registered to '${gstinClash.supplier_name}'.` };
    }
  }

  const { data, error } = await supabase
    .from('supplier_master')
    .insert(buildRow(body, userId, true, code))
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

export async function updateSupplier(id, body, userId) {
  if (body.supplier_name !== undefined && !body.supplier_name?.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Supplier name cannot be blank.' };
  }

  // GSTIN validation if being updated
  if (body.gstin !== undefined && body.gstin?.trim()) {
    const gstinErr = validateGSTIN(body.gstin);
    if (gstinErr) throw { code: 'VALIDATION_ERROR', message: gstinErr };

    const normalised = body.gstin.trim().toUpperCase();
    const { data: clash } = await supabase
      .from('supplier_master')
      .select('id, supplier_name')
      .eq('gstin', normalised)
      .neq('id', id)
      .maybeSingle();
    if (clash) {
      throw { code: 'CONFLICT', message: `GSTIN '${normalised}' is already registered to '${clash.supplier_name}'.` };
    }
  }

  const { data, error } = await supabase
    .from('supplier_master')
    .update(buildPatchRow(body, userId))
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Supplier not found.' } };
  return { data, error: null };
}

export async function toggleSupplierActive(id, userId) {
  const { data: sup, error: fetchErr } = await getSupplierById(id);
  if (fetchErr || !sup) throw { code: 'NOT_FOUND', message: 'Supplier not found.' };

  if (sup.is_active) {
    const [po, grn] = await Promise.all([
      supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('supplier_id', id),
      supabase.from('grn_headers').select('id', { count: 'exact', head: true }).eq('supplier_id', id),
    ]);

    const blocking = [];
    if ((po.count  ?? 0) > 0) blocking.push(`${po.count} purchase order(s)`);
    if ((grn.count ?? 0) > 0) blocking.push(`${grn.count} GRN(s)`);

    if (blocking.length > 0) {
      throw {
        code: 'CONFLICT',
        message: `Cannot deactivate — '${sup.supplier_code}' is linked to: ${blocking.join(', ')}.`,
      };
    }
  }

  const { data, error } = await supabase
    .from('supplier_master')
    .update({ is_active: !sup.is_active, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

function setIfPresent(row, body, field, transform = (v) => v) {
  if (Object.prototype.hasOwnProperty.call(body, field)) row[field] = transform(body[field]);
}

function nullableText(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function nullableUpper(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return s || null;
}

function nullableNumber(v) {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildPatchRow(body, userId) {
  const row = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  setIfPresent(row, body, 'supplier_name', v => String(v ?? '').trim());
  setIfPresent(row, body, 'is_active', v => Boolean(v));
  setIfPresent(row, body, 'gstin', nullableUpper);
  setIfPresent(row, body, 'pan', nullableUpper);
  setIfPresent(row, body, 'supplier_type', nullableText);
  setIfPresent(row, body, 'credit_days', nullableNumber);
  setIfPresent(row, body, 'payment_terms', nullableText);
  setIfPresent(row, body, 'default_currency', nullableText);
  setIfPresent(row, body, 'notes', nullableText);
  setIfPresent(row, body, 'contact_name', nullableText);
  setIfPresent(row, body, 'contact_mobile', nullableText);
  setIfPresent(row, body, 'contact_email', nullableText);
  setIfPresent(row, body, 'city', nullableText);
  setIfPresent(row, body, 'state', nullableText);
  setIfPresent(row, body, 'supplier_category_id', v => v || null);
  setIfPresent(row, body, 'default_tax_id', v => v || null);
  setIfPresent(row, body, 'default_warehouse_id', v => v || null);

  return row;
}


// ─── Internal: build row ──────────────────────────────────────────────────────

function buildRow(body, userId, isCreate, normalisedCode) {
  const now = new Date().toISOString();
  const row = {
    supplier_name:    (body.supplier_name ?? '').trim(),
    is_active:        body.is_active !== undefined ? Boolean(body.is_active) : true,
    gstin:            body.gstin?.trim() ? body.gstin.trim().toUpperCase() : null,
    pan:              body.pan              || null,
    supplier_type:    body.supplier_type   || null,
    credit_days:      body.credit_days != null ? Number(body.credit_days) : null,
    payment_terms:    body.payment_terms   || null,
    default_currency: body.default_currency || null,
    notes:            body.notes           || null,
    contact_name:     body.contact_name    || null,
    contact_mobile:   body.contact_mobile  || null,
    contact_email:    body.contact_email   || null,
    city:             body.city            || null,
    state:            body.state           || null,
    updated_by:       userId,
    updated_at:       now,
  };

  if (normalisedCode)          row.supplier_code          = normalisedCode;
  if (isCreate)                row.created_by              = userId;
  if (body.supplier_category_id) row.supplier_category_id = body.supplier_category_id;
  if (body.default_tax_id)       row.default_tax_id        = body.default_tax_id;
  if (body.default_warehouse_id) row.default_warehouse_id  = body.default_warehouse_id;

  return row;
}
