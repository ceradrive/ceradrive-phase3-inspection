/**
 * CERADRIVE ERP — Tax Snapshot Helper
 *
 * Reads tax_master and builds the tax snapshot object to be stored on PO/GRN lines.
 *
 * Confirmed columns (PIC-01):
 *   tax_master.tax_percent  — numeric — rate column (OBD-07 resolved)
 *   tax_master.tax_name     — varchar — display name
 *   tax_master.id           — uuid    — primary key
 *
 * C6: Tax values are snapshotted at time of line save.
 * Once saved, changes to tax_master do not affect existing PO/GRN lines.
 *
 * Phase 9A: This helper is scaffolded for read-only use.
 * Write usage (snapshotting onto new lines) is activated in Phase 9B/9D.
 */

import { supabase } from '../config/supabase.js';

/**
 * Build a tax snapshot object from tax_master.
 *
 * @param {string|null} taxId   - UUID from tax_master, or null for manual/no-tax entry
 * @returns {Promise<{
 *   tax_id:      string|null,
 *   tax_name:    string|null,
 *   tax_percent: number|null
 * }>}
 *
 * If taxId is null: returns null snapshot (manual tax entry — caller sets tax_name
 * and tax_percent from request body directly).
 *
 * If taxId is provided and not found: throws { code: 'NOT_FOUND', message: '...' }
 */
export async function buildTaxSnapshot(taxId) {
  // No taxId — manual tax entry or no tax. Caller handles tax_name and tax_percent.
  if (!taxId) {
    return {
      tax_id:      null,
      tax_name:    null,
      tax_percent: null,
    };
  }

  const { data, error } = await supabase
    .from('tax_master')
    .select('id, tax_name, tax_percent')
    .eq('id', taxId)
    .single();

  if (error || !data) {
    throw {
      code:    'NOT_FOUND',
      message: `Tax record not found: ${taxId}. Verify the tax_id or enter tax details manually.`,
    };
  }

  return {
    tax_id:      data.id,
    tax_name:    data.tax_name,
    tax_percent: data.tax_percent,
  };
}

/**
 * Validate a manually-entered tax snapshot (when tax_id is null).
 *
 * Rules:
 * - If tax_name is provided, tax_percent must also be provided (and vice versa)
 * - tax_percent must be >= 0 if provided
 * - Neither is required — both null = no tax (tax_amount will be 0)
 *
 * @param {{ tax_name?: string, tax_percent?: number }} params
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManualTaxEntry({ tax_name, tax_percent }) {
  const errors = [];

  if (tax_name && (tax_percent === undefined || tax_percent === null)) {
    errors.push('tax_percent is required when tax_name is provided.');
  }
  if ((tax_percent !== undefined && tax_percent !== null) && !tax_name) {
    errors.push('tax_name is required when tax_percent is provided.');
  }
  if (typeof tax_percent === 'number' && tax_percent < 0) {
    errors.push('tax_percent cannot be negative.');
  }

  return { valid: errors.length === 0, errors };
}
