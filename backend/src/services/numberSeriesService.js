/**
 * CERADRIVE ERP — Number Series Service
 * Phase 9B: Implemented via get_next_number RPC function.
 * Batch 7A: RPC supports pattern_template, suffix_template, {YYYY}, {YY}, {FY}, {MM}, {DD}, and ###/#### sequence tokens.
 *
 * RPC function deployed: batch10_step13_rpc_get_next_number.sql
 * Concurrency: SELECT FOR UPDATE inside Postgres function — safe for simultaneous requests.
 * {FY} token: RIGHT(fy_start_year,2)||RIGHT(fy_end_year,2), e.g. 2627 for FY 2026-27
 */

import { supabase } from '../config/supabase.js';

/**
 * Get the next formatted document number for a series.
 * Delegates to get_next_number(p_series_code) Postgres RPC function.
 *
 * @param {string} seriesCode - 'PO' | 'GRN' | 'WORK_ORDER'
 * @returns {Promise<string>} - e.g. 'PO/2526/0001'
 * @throws {{ code, message }} on series not found, inactive, or DB error
 */
export async function getNextNumber(seriesCode) {
  const { data, error } = await supabase.rpc('get_next_number', {
    p_series_code: seriesCode,
  });

  if (error) {
    throw {
      code:    'INTERNAL_ERROR',
      message: `Number series error for '${seriesCode}': ${error.message}`,
    };
  }

  if (!data) {
    throw {
      code:    'INTERNAL_ERROR',
      message: `get_next_number returned null for series '${seriesCode}'.`,
    };
  }

  return data;
}
