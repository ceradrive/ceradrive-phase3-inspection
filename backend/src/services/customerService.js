/**
 * CERADRIVE ERP — Customer Service
 *
 * All data access for the Customer Master module.
 * Pattern: returns { data, error } — throws plain { code, message } for business rule violations.
 * Mirrors supplierService.js conventions exactly.
 *
 * Live schema (confirmed):
 *   customer_master: id, customer_code, customer_name, is_active,
 *     customer_category_id, customer_type, gstin, pan, default_tax_id,
 *     credit_days, credit_limit, notes, contact_name, contact_mobile, contact_email,
 *     address_line1, address_line2, city, state, pincode, country,
 *     gst_certificate_url, pan_card_url,
 *     created_by, created_at, updated_by, updated_at
 *
 * Governance (R45): mandatory fields at go-live = customer_code, customer_name, is_active only.
 * All other fields optional. Onboarding must complete in under 30 seconds (R46).
 *
 * customer_code: stored uppercase, unique (duplicate validation required).
 * GSTIN: format validated ONLY if entered (no uniqueness check per locked rules).
 * PAN:   format validated ONLY if entered.
 * gst_certificate_url / pan_card_url: stored as plain text URLs only — no upload implementation.
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

// ─── PAN validation ───────────────────────────────────────────────────────────
// Format: ABCDE1234F (10 chars)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function validatePAN(raw) {
  if (!raw?.trim()) return null; // optional — blank is valid
  const v = raw.trim().toUpperCase();
  if (!PAN_REGEX.test(v)) {
    return 'Invalid PAN. Expected format: ABCDE1234F (10 characters).';
  }
  return null;
}

// ─── Column selects ───────────────────────────────────────────────────────────

const LIST_COLS = `
  id, customer_code, customer_name, is_active,
  gstin, contact_name, contact_mobile, contact_email,
  city, state, credit_days,
  created_at, updated_at
`;

const DETAIL_COLS = `
  id, customer_code, customer_name, is_active,
  customer_category_id, customer_type,
  gstin, pan, default_tax_id,
  credit_days, credit_limit,
  notes, contact_name, contact_mobile, contact_email,
  address_line1, address_line2, city, state, pincode, country,
  gst_certificate_url, pan_card_url,
  assigned_price_list_id,
  price_list_headers ( id, price_list_code, price_list_name, revision ),
  created_by, created_at, updated_by, updated_at
`;

// ─── Live search (used by master-backed customer dropdowns) ───────────────────

export async function searchCustomers({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);

  let query = supabase
    .from('customer_master')
    .select('id, customer_code, customer_name')
    .eq('is_active', true)
    .order('customer_name', { ascending: true })
    .limit(safeLimit);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `customer_name.ilike.%${safeSearch}%,customer_code.ilike.%${safeSearch}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listCustomers({ search, is_active, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const offset    = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

  let query = supabase
    .from('customer_master')
    .select(LIST_COLS, { count: 'exact' })
    .order('customer_name', { ascending: true })
    .range(offset, offset + safeLimit - 1);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) {
    query = query.or(
      `customer_name.ilike.%${safeSearch}%,customer_code.ilike.%${safeSearch}%,gstin.ilike.%${safeSearch}%`,
    );
  }
  if (is_active !== undefined && is_active !== '') {
    query = query.eq('is_active', is_active === 'true' || is_active === true);
  }

  const { data, error, count } = await query;
  if (error) return { data: null, count: null, error };
  return { data: data ?? [], count: count ?? 0, error: null };
}

export async function getCustomerById(id) {
  const { data, error } = await supabase
    .from('customer_master')
    .select(DETAIL_COLS)
    .eq('id', id)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Customer not found.' } };
  return { data, error: null };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function createCustomer(body, userId) {
  const { customer_code, customer_name } = body;

  if (!customer_code?.trim()) throw { code: 'VALIDATION_ERROR', message: 'Customer code is required.' };
  if (!customer_name?.trim()) throw { code: 'VALIDATION_ERROR', message: 'Customer name is required.' };

  const code = customer_code.trim().toUpperCase();

  // Duplicate code check
  const { data: existing } = await supabase
    .from('customer_master')
    .select('id')
    .eq('customer_code', code)
    .maybeSingle();
  if (existing) throw { code: 'CONFLICT', message: `Customer code '${code}' already exists.` };

  // GSTIN format (only if entered) — no uniqueness check per locked rules
  if (body.gstin?.trim()) {
    const gstinErr = validateGSTIN(body.gstin);
    if (gstinErr) throw { code: 'VALIDATION_ERROR', message: gstinErr };
  }

  // PAN format (only if entered)
  if (body.pan?.trim()) {
    const panErr = validatePAN(body.pan);
    if (panErr) throw { code: 'VALIDATION_ERROR', message: panErr };
  }

  const { data, error } = await supabase
    .from('customer_master')
    .insert(buildRow(body, userId, true, code))
    .select(DETAIL_COLS)
    .single();

  if (error) return { data: null, error };
  return { data, error: null };
}

export async function updateCustomer(id, body, userId) {
  if (body.customer_name !== undefined && !body.customer_name?.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Customer name cannot be blank.' };
  }

  // GSTIN format if being updated (only if non-blank)
  if (body.gstin !== undefined && body.gstin?.trim()) {
    const gstinErr = validateGSTIN(body.gstin);
    if (gstinErr) throw { code: 'VALIDATION_ERROR', message: gstinErr };
  }

  // PAN format if being updated (only if non-blank)
  if (body.pan !== undefined && body.pan?.trim()) {
    const panErr = validatePAN(body.pan);
    if (panErr) throw { code: 'VALIDATION_ERROR', message: panErr };
  }

  const { data, error } = await supabase
    .from('customer_master')
    .update(buildPatchRow(body, userId))
    .eq('id', id)
    .select(DETAIL_COLS)
    .single();

  if (error || !data) return { data: null, error: error ?? { message: 'Customer not found.' } };
  return { data, error: null };
}

export async function toggleCustomerActive(id, userId) {
  const { data: cust, error: fetchErr } = await getCustomerById(id);
  if (fetchErr || !cust) throw { code: 'NOT_FOUND', message: 'Customer not found.' };

  // NOTE: No referential deactivate guard is applied here. The Supplier guard checks
  // purchase_orders / grn_headers (confirmed tables). No customer-referencing transactional
  // table is confirmed in the current schema, so none is queried (querying an unconfirmed
  // table would break). A guard should be added when a customer-consuming module exists.

  const { data, error } = await supabase
    .from('customer_master')
    .update({ is_active: !cust.is_active, updated_by: userId, updated_at: new Date().toISOString() })
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

  setIfPresent(row, body, 'customer_name', v => String(v ?? '').trim());
  setIfPresent(row, body, 'is_active', v => Boolean(v));
  setIfPresent(row, body, 'customer_type', nullableText);
  setIfPresent(row, body, 'gstin', nullableUpper);
  setIfPresent(row, body, 'pan', nullableUpper);
  setIfPresent(row, body, 'credit_days', nullableNumber);
  setIfPresent(row, body, 'credit_limit', nullableNumber);
  setIfPresent(row, body, 'notes', nullableText);
  setIfPresent(row, body, 'contact_name', nullableText);
  setIfPresent(row, body, 'contact_mobile', nullableText);
  setIfPresent(row, body, 'contact_email', nullableText);
  setIfPresent(row, body, 'address_line1', nullableText);
  setIfPresent(row, body, 'address_line2', nullableText);
  setIfPresent(row, body, 'city', nullableText);
  setIfPresent(row, body, 'state', nullableText);
  setIfPresent(row, body, 'pincode', nullableText);
  setIfPresent(row, body, 'country', nullableText);
  setIfPresent(row, body, 'gst_certificate_url', nullableText);
  setIfPresent(row, body, 'pan_card_url', nullableText);
  setIfPresent(row, body, 'customer_category_id', v => v || null);
  setIfPresent(row, body, 'default_tax_id', v => v || null);
  setIfPresent(row, body, 'assigned_price_list_id', v => v || null);

  return row;
}


// ─── Internal: build row ──────────────────────────────────────────────────────

function buildRow(body, userId, isCreate, normalisedCode) {
  const now = new Date().toISOString();
  const row = {
    customer_name:      (body.customer_name ?? '').trim(),
    is_active:          body.is_active !== undefined ? Boolean(body.is_active) : true,
    customer_type:      body.customer_type   || null,
    gstin:              body.gstin?.trim() ? body.gstin.trim().toUpperCase() : null,
    pan:                body.pan?.trim()   ? body.pan.trim().toUpperCase()   : null,
    credit_days:        body.credit_days  != null ? Number(body.credit_days)  : null,
    credit_limit:       body.credit_limit != null && body.credit_limit !== '' ? Number(body.credit_limit) : null,
    notes:              body.notes            || null,
    contact_name:       body.contact_name     || null,
    contact_mobile:     body.contact_mobile   || null,
    contact_email:      body.contact_email    || null,
    address_line1:      body.address_line1    || null,
    address_line2:      body.address_line2    || null,
    city:               body.city             || null,
    state:              body.state            || null,
    pincode:            body.pincode          || null,
    country:            body.country          || null,
    gst_certificate_url: body.gst_certificate_url || null,
    pan_card_url:        body.pan_card_url        || null,
    updated_by:         userId,
    updated_at:         now,
  };

  if (normalisedCode)            row.customer_code        = normalisedCode;
  if (isCreate)                  row.created_by           = userId;
  if (body.customer_category_id) row.customer_category_id = body.customer_category_id;
  if (body.default_tax_id)       row.default_tax_id       = body.default_tax_id;
  if (body.assigned_price_list_id !== undefined) row.assigned_price_list_id = body.assigned_price_list_id || null;

  return row;
}
