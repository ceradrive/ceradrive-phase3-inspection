/**
 * CERADRIVE ERP — Production Log Service (Phase 1: foundation / execution recording)
 *
 * Records immutable ENTRY rows against RELEASED work orders. NO inventory, WIP, stage
 * generation, QC, costing, scheduler, MRP. NEVER writes wo_headers or any table other
 * than production_logs. rejected_qty is set = rework_qty + scrap_qty at this layer.
 *
 * Mirrors woService: supabase from config, { data, error } returns, thrown { code, message }
 * for business-rule violations. Embeds rely on the existing production_logs FKs.
 */

import { supabase } from '../config/supabase.js';

// ─── Pickers ───────────────────────────────────────────────────────────────────

export async function searchReleasedWorkOrders({ search, limit = 20 } = {}) {
  let q = supabase
    .from('wo_headers')
    .select('id, wo_number, planned_qty, status, item:item_master ( item_code, item_name )')
    .eq('status', 'released')
    .order('wo_number', { ascending: true })
    .limit(Math.min(Number(limit) || 20, 50));
  if (search) q = q.ilike('wo_number', `%${search}%`);
  const { data, error } = await q;
  return { data, error };
}

export async function listStepsForWorkOrder(wo_id) {
  if (!wo_id) return { data: [], error: null };
  const { data, error } = await supabase
    .from('wo_step_lines')
    .select('id, wo_id, seq_no, step_name, step_status')
    .eq('wo_id', wo_id)
    .order('seq_no', { ascending: true });
  return { data, error };
}

export async function listShifts() {
  // Defensive select: shift_master display columns are resolved on the client
  // (shift_name ?? shift_code ?? id), so we avoid hard-coding column names here.
  const { data, error } = await supabase.from('shift_master').select('*');
  return { data, error };
}

export async function listWorkers() {
  const { data, error } = await supabase
    .from('worker_master')
    .select('id, worker_code, worker_name')
    .eq('is_active', true)
    .order('worker_code', { ascending: true });
  return { data, error };
}

export async function listMachines() {
  const { data, error } = await supabase
    .from('machine_master')
    .select('id, machine_code, machine_name')
    .order('machine_code', { ascending: true });
  return { data, error };
}

// ─── List + get ──────────────────────────────────────────────────────────────

const LOG_SELECT = `
  id, wo_id, step_line_id, entry_date, shift_id, worker_id, machine_id,
  good_qty, rework_qty, scrap_qty, rejected_qty, entry_type, lot_no, notes, created_at,
  actual_start_at, actual_end_at, expected_minutes, actual_minutes, delay_minutes, delay_reason,
  correction_of_log_id, correction_reason, correction_note,
  correction_delta_good_qty, correction_delta_scrap_qty, correction_delta_rejected_qty,
  wo:wo_headers ( wo_number ),
  step:wo_step_lines ( seq_no, step_name ),
  worker:worker_master ( worker_code, worker_name ),
  machine:machine_master ( machine_code, machine_name )
`;

export async function listLogs({ wo_id, entry_date, worker_id, machine_id, page = 1, limit = 50 } = {}) {
  const from = (page - 1) * limit;
  const to   = from + limit - 1;
  let q = supabase
    .from('production_logs')
    .select(LOG_SELECT, { count: 'exact' })
    .eq('entry_type', 'ENTRY')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (wo_id)      q = q.eq('wo_id', wo_id);
  if (entry_date) q = q.eq('entry_date', entry_date);
  if (worker_id)  q = q.eq('worker_id', worker_id);
  if (machine_id) q = q.eq('machine_id', machine_id);
  const { data, error, count } = await q;
  if (error) return { data, error, count };

  const rows = data ?? [];
  const entryIds = rows.map((r) => r.id).filter(Boolean);
  const correctionsByLog = new Map();

  if (entryIds.length) {
    const { data: corrections } = await supabase
      .from('production_logs')
      .select('id, correction_of_log_id, correction_delta_good_qty, correction_delta_scrap_qty, correction_delta_rejected_qty, correction_reason, correction_note, created_at')
      .eq('entry_type', 'CORRECTION')
      .in('correction_of_log_id', entryIds)
      .order('created_at', { ascending: true });

    for (const c of corrections || []) {
      const current = correctionsByLog.get(c.correction_of_log_id) || {
        correction_count: 0,
        correction_delta_good_qty: 0,
        correction_delta_scrap_qty: 0,
        correction_delta_rejected_qty: 0,
        last_correction_reason: null,
        corrections: [],
      };

      current.correction_count += 1;
      current.correction_delta_good_qty += Number(c.correction_delta_good_qty || 0);
      current.correction_delta_scrap_qty += Number(c.correction_delta_scrap_qty || 0);
      current.correction_delta_rejected_qty += Number(c.correction_delta_rejected_qty || 0);
      current.last_correction_reason = c.correction_reason || current.last_correction_reason;
      current.corrections.push(c);

      correctionsByLog.set(c.correction_of_log_id, current);
    }
  }

  const enriched = rows.map((r) => {
    const corr = correctionsByLog.get(r.id) || {
      correction_count: 0,
      correction_delta_good_qty: 0,
      correction_delta_scrap_qty: 0,
      correction_delta_rejected_qty: 0,
      last_correction_reason: null,
      corrections: [],
    };

    return {
      ...r,
      ...corr,
      net_good_qty: Number(r.good_qty || 0) + Number(corr.correction_delta_good_qty || 0),
      net_scrap_qty: Number(r.scrap_qty || 0) + Number(corr.correction_delta_scrap_qty || 0),
      net_rejected_qty: Number(r.rejected_qty || 0) + Number(corr.correction_delta_rejected_qty || 0),
    };
  });

  return { data: enriched, error: null, count };
}

export async function getLogById(id) {
  const { data, error } = await supabase
    .from('production_logs')
    .select(LOG_SELECT)
    .eq('id', id)
    .single();
  if (error || !data) return { data: null, error: error ?? { code: 'NOT_FOUND', message: 'Production log not found.' } };
  return { data, error: null };
}

// ─── Create (immutable ENTRY) ──────────────────────────────────────────────────

function nonNegOrThrow(value, field) {
  const n = value === '' || value === undefined || value === null ? 0 : Number(value);
  if (isNaN(n) || n < 0) throw { code: 'VALIDATION_ERROR', message: `${field} must be zero or greater.` };
  return n;
}

export async function createLog(body, userId) {
  if (!body.wo_id)        throw { code: 'VALIDATION_ERROR', message: 'Work order is required.' };
  if (!body.step_line_id) throw { code: 'VALIDATION_ERROR', message: 'Work order step is required.' };
  if (!body.shift_id)     throw { code: 'VALIDATION_ERROR', message: 'Shift is required.' };

  // WO must exist and be RELEASED.
  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, status, planned_qty')
    .eq('id', body.wo_id)
    .single();
  if (woErr || !wo) throw { code: 'NOT_FOUND', message: 'Work order not found.' };
  if (wo.status !== 'released') {
    throw { code: 'VALIDATION_ERROR', message: 'Production can only be logged against released work orders.' };
  }

  // Step must belong to this WO.
  const { data: step, error: stErr } = await supabase
    .from('wo_step_lines')
    .select('id, wo_id')
    .eq('id', body.step_line_id)
    .single();
  if (stErr || !step) throw { code: 'VALIDATION_ERROR', message: 'Selected step does not exist.' };
  if (step.wo_id !== body.wo_id) {
    throw { code: 'VALIDATION_ERROR', message: 'Selected step does not belong to this work order.' };
  }

  const good_qty   = nonNegOrThrow(body.good_qty,   'Good quantity');
  const rework_qty = nonNegOrThrow(body.rework_qty, 'Rework quantity');
  const scrap_qty  = nonNegOrThrow(body.scrap_qty,  'Scrap quantity');
  const rejected_qty = rework_qty + scrap_qty;

  const plannedQty = Number(wo.planned_qty || 0);
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Work order planned quantity must be greater than zero.' };
  }

  const { data: priorLogs, error: priorLogsErr } = await supabase
    .from('production_logs')
    .select('entry_type, good_qty, correction_delta_good_qty')
    .eq('wo_id', body.wo_id);

  if (priorLogsErr) return { data: null, error: priorLogsErr };

  const priorNetGood = (priorLogs || []).reduce((sum, log) => {
    if (log.entry_type === 'CORRECTION') {
      return sum + Number(log.correction_delta_good_qty || 0);
    }
    return sum + Number(log.good_qty || 0);
  }, 0);

  if (priorNetGood + good_qty > plannedQty) {
    throw {
      code: 'VALIDATION_ERROR',
      message: `Production log exceeds planned quantity. Planned: ${plannedQty}, already logged: ${priorNetGood}, trying to add: ${good_qty}.`,
    };
  }

  // Production date defaults to today (server) when not supplied; entry_date is the
  // business date, created_at is the immutable server timestamp.
  const entry_date = body.entry_date && body.entry_date !== ''
    ? body.entry_date
    : new Date().toISOString().slice(0, 10);

  function parseOptionalIso(value, field) {
    if (value === undefined || value === null || value === '') return null;
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) {
      throw { code: 'VALIDATION_ERROR', message: `${field} is invalid.` };
    }
    return d.toISOString();
  }

  const actual_start_at = parseOptionalIso(body.actual_start_at, 'Actual start time');
  const actual_end_at = parseOptionalIso(body.actual_end_at, 'Actual end time') || new Date().toISOString();

  let expected_minutes = null;
  if (body.expected_minutes !== undefined && body.expected_minutes !== null && body.expected_minutes !== '') {
    expected_minutes = Number(body.expected_minutes);
    if (!Number.isFinite(expected_minutes) || expected_minutes < 0) {
      throw { code: 'VALIDATION_ERROR', message: 'Expected minutes must be zero or greater.' };
    }
  }

  let actual_minutes = null;
  if (actual_start_at && actual_end_at) {
    const startMs = new Date(actual_start_at).getTime();
    const endMs = new Date(actual_end_at).getTime();

    if (endMs < startMs) {
      throw { code: 'VALIDATION_ERROR', message: 'Actual end time cannot be before actual start time.' };
    }

    actual_minutes = Math.round(((endMs - startMs) / 60000) * 100) / 100;
  }

  const delay_minutes =
    actual_minutes != null && expected_minutes != null
      ? Math.max(0, Math.round((actual_minutes - expected_minutes) * 100) / 100)
      : null;

  const delay_tolerance_minutes =
    expected_minutes != null
      ? Math.max(5, Math.round((expected_minutes * 0.10) * 100) / 100)
      : 5;

  if (delay_minutes != null && delay_minutes > delay_tolerance_minutes && !String(body.delay_reason || '').trim()) {
    throw {
      code: 'VALIDATION_ERROR',
      message: `Delay reason is required when delay is more than ${delay_tolerance_minutes} minutes.`,
    };
  }

  const row = {
    wo_id:        body.wo_id,
    step_line_id: body.step_line_id,
    entry_date,
    shift_id:     body.shift_id,
    worker_id:    body.worker_id  || null,
    machine_id:   body.machine_id || null,
    good_qty,
    rework_qty,
    scrap_qty,
    rejected_qty,
    entry_type:   'ENTRY',
    lot_no:       body.lot_no ? String(body.lot_no).trim() || null : null,
    notes:        body.notes ? String(body.notes).trim() : null,
    actual_start_at,
    actual_end_at,
    expected_minutes,
    actual_minutes,
    delay_minutes,
    delay_reason: delay_minutes != null && delay_minutes > 0 ? String(body.delay_reason || '').trim() || null : null,
    created_by:   userId,
    posted_by:    null,
    posted_at:    null,
  };

  const { data: created, error } = await supabase
    .from('production_logs')
    .insert(row)
    .select('id')
    .single();
  if (error) return { data: null, error };

  return getLogById(created.id);
}

export async function deleteUnpostedLog(id) {
  if (!id) return { data: null, error: null };

  // Only cleanup the just-created log if no ledger rows exist for it.
  const { data: ledgerRows, error: ledgerErr } = await supabase
    .from('inventory_ledger')
    .select('id')
    .eq('reference_id', id)
    .limit(1);

  if (ledgerErr) return { data: null, error: ledgerErr };
  if ((ledgerRows || []).length) {
    return { data: null, error: { code: 'CONFLICT', message: 'Cannot cleanup production log with ledger rows.' } };
  }

  const { data, error } = await supabase
    .from('production_logs')
    .delete()
    .eq('id', id)
    .select('id');

  return { data, error };
}

export async function correctLog(originalLogId, body, userId) {
  if (!originalLogId) {
    throw { code: 'VALIDATION_ERROR', message: 'Original production log is required.' };
  }

  const actualGoodQty = Number(body.actual_good_qty);
  const actualScrapQty = Number(body.actual_scrap_qty || 0);
  const reason = String(body.reason || '').trim();
  const note = body.note ? String(body.note).trim() : null;

  if (!Number.isFinite(actualGoodQty) || actualGoodQty < 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Actual good qty must be zero or greater.' };
  }

  if (!Number.isFinite(actualScrapQty) || actualScrapQty < 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Actual scrap qty must be zero or greater.' };
  }

  if (!reason) {
    throw { code: 'VALIDATION_ERROR', message: 'Correction reason is required.' };
  }

  const { data: originalLog, error: originalLogErr } = await supabase
    .from('production_logs')
    .select('id, wo_id, entry_type, good_qty')
    .eq('id', originalLogId)
    .single();

  if (originalLogErr || !originalLog) {
    throw { code: 'NOT_FOUND', message: 'Original production log not found.' };
  }

  if (originalLog.entry_type !== 'ENTRY') {
    throw { code: 'VALIDATION_ERROR', message: 'Only ENTRY production logs can be corrected.' };
  }

  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, planned_qty')
    .eq('id', originalLog.wo_id)
    .single();

  if (woErr || !wo) {
    throw { code: 'NOT_FOUND', message: 'Work order not found for production log.' };
  }

  const plannedQty = Number(wo.planned_qty || 0);
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
    throw { code: 'VALIDATION_ERROR', message: 'Work order planned quantity must be greater than zero.' };
  }

  const { data: originalCorrections, error: originalCorrectionsErr } = await supabase
    .from('production_logs')
    .select('correction_delta_good_qty')
    .eq('correction_of_log_id', originalLogId)
    .eq('entry_type', 'CORRECTION');

  if (originalCorrectionsErr) {
    return { data: null, error: originalCorrectionsErr };
  }

  const currentOriginalGood = Number(originalLog.good_qty || 0)
    + (originalCorrections || []).reduce((sum, log) => {
      return sum + Number(log.correction_delta_good_qty || 0);
    }, 0);

  const proposedDeltaGood = actualGoodQty - currentOriginalGood;

  if (proposedDeltaGood > 0) {
    const { data: woLogs, error: woLogsErr } = await supabase
      .from('production_logs')
      .select('entry_type, good_qty, correction_delta_good_qty')
      .eq('wo_id', originalLog.wo_id);

    if (woLogsErr) {
      return { data: null, error: woLogsErr };
    }

    const priorNetGood = (woLogs || []).reduce((sum, log) => {
      if (log.entry_type === 'CORRECTION') {
        return sum + Number(log.correction_delta_good_qty || 0);
      }
      return sum + Number(log.good_qty || 0);
    }, 0);

    if (priorNetGood + proposedDeltaGood > plannedQty) {
      throw {
        code: 'VALIDATION_ERROR',
        message: `Production correction exceeds planned quantity. Planned: ${plannedQty}, already logged: ${priorNetGood}, correction increase: ${proposedDeltaGood}.`,
      };
    }
  }

  const { data, error } = await supabase.rpc('fn_correct_production_log', {
    p_original_log_id: originalLogId,
    p_actual_good_qty: actualGoodQty,
    p_actual_scrap_qty: actualScrapQty,
    p_reason: reason,
    p_note: note,
    p_corrected_by: userId,
  });

  if (error) {
    return { data: null, error: { code: 'CONFLICT', message: error.message } };
  }

  return { data, error: null };
}
