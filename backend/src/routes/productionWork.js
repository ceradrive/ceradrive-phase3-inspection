import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import { calculateWorkOrderExpectedMinutes } from '../services/recipeCalculationService.js';

const router = Router();

const READ_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
  ROLES.WAREHOUSE_OPERATOR,
];

const WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
  ROLES.SUPERVISOR,
  ROLES.PLANNER,
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function shortQty(v) {
  const n = num(v);
  if (n >= 1000) return Math.round(n).toLocaleString();
  return Number(n.toFixed(2)).toLocaleString();
}

async function addInputShortageReasons(rows) {
  if (!rows?.length) return [];

  // P1: Production Control input shortage/reason derives from wo_component_lines (WO
  // component readiness) — the SAME source as the PPO Process Tree. The prior
  // stage_recipe_inputs path emitted a false recipe-mapping reason when a recipe step
  // did not match; that path is removed. Display only. Every Supabase error is handled.

  const neutral = (msg) => rows.map(r => ({ ...r, fg_item: null, block_reason: msg, input_shortages: [] }));
  const woIds = [...new Set(rows.map(r => r.id).filter(Boolean))];

  const lineIds = [...new Set(rows.map(r => r.source_ppo_line_id).filter(Boolean))];
  const { data: ppoLines, error: ppoLinesErr } = lineIds.length
    ? await supabase.from('production_plan_order_lines').select('id,item_id,item:item_id(item_code,item_name)').in('id', lineIds)
    : { data: [], error: null };
  if (ppoLinesErr) { console.error('addInputShortageReasons: production_plan_order_lines failed', ppoLinesErr); return neutral('Input check unavailable'); }
  const lineMap = new Map((ppoLines || []).map(l => [l.id, l]));

  const { data: components, error: componentsErr } = woIds.length
    ? await supabase.from('wo_component_lines').select('wo_id, component_item_id, required_qty, issued_qty, uom_id, is_active').in('wo_id', woIds).eq('is_active', true)
    : { data: [], error: null };
  if (componentsErr) { console.error('addInputShortageReasons: wo_component_lines failed', componentsErr); return neutral('Input check unavailable'); }

  const componentItemIds = [...new Set((components || []).map(c => c.component_item_id).filter(Boolean))];

  const { data: items, error: itemsErr } = componentItemIds.length
    ? await supabase.from('item_master').select('id,item_code,item_name').in('id', componentItemIds)
    : { data: [], error: null };
  if (itemsErr) { console.error('addInputShortageReasons: item_master failed', itemsErr); return neutral('Input check unavailable'); }

  const { data: balances, error: balancesErr } = componentItemIds.length
    ? await supabase.from('inventory_balance').select('item_id,quantity,uom_id').in('item_id', componentItemIds)
    : { data: [], error: null };
  if (balancesErr) { console.error('addInputShortageReasons: inventory_balance failed', balancesErr); return neutral('Input check unavailable'); }

  const uomIds = [...new Set([...(components || []).map(c => c.uom_id), ...(balances || []).map(b => b.uom_id)].filter(Boolean))];

  const { data: uoms, error: uomsErr } = uomIds.length
    ? await supabase.from('uom_master').select('id,uom_code').in('id', uomIds)
    : { data: [], error: null };
  if (uomsErr) { console.error('addInputShortageReasons: uom_master failed', uomsErr); return neutral('Input check unavailable'); }

  const itemMap = new Map((items || []).map(i => [i.id, i]));
  const uomMap = new Map((uoms || []).map(u => [u.id, String(u.uom_code || '').toUpperCase()]));

  function isKgCode(code) { return ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(String(code || '').toUpperCase()); }
  function isGramCode(code) { return ['G', 'GM', 'GRM', 'GRAM', 'GRAMS'].includes(String(code || '').toUpperCase()); }

  function convertQty(qty, fromUomId, toUomId) {
    const n = num(qty);
    if (!fromUomId || !toUomId || fromUomId === toUomId) return n;
    const fromCode = uomMap.get(fromUomId);
    const toCode = uomMap.get(toUomId);
    if (isKgCode(fromCode) && isGramCode(toCode)) return n * 1000;
    if (isGramCode(fromCode) && isKgCode(toCode)) return n / 1000;
    return n;
  }
  function displayQtyValue(qty, uomCode) { const n = num(qty); return isGramCode(uomCode) && Math.abs(n) >= 1000 ? n / 1000 : n; }
  function displayUomCode(uomCode, qty) { return isGramCode(uomCode) && Math.abs(num(qty)) >= 1000 ? 'KG' : (uomCode || ''); }

  const balancesByItem = new Map();
  for (const b of balances || []) {
    if (!balancesByItem.has(b.item_id)) balancesByItem.set(b.item_id, []);
    balancesByItem.get(b.item_id).push(b);
  }
  function availableForComponent(itemId, targetUomId) {
    return (balancesByItem.get(itemId) || []).reduce((sum, b) => sum + convertQty(b.quantity, b.uom_id, targetUomId), 0);
  }

  const componentsByWo = new Map();
  for (const c of components || []) {
    if (!componentsByWo.has(c.wo_id)) componentsByWo.set(c.wo_id, []);
    componentsByWo.get(c.wo_id).push(c);
  }

  return rows.map(row => {
    const line = lineMap.get(row.source_ppo_line_id);
    const fgItem = line?.item || null;
    const woComponents = componentsByWo.get(row.id) || [];

    const input_details = woComponents.map(c => {
      const componentItem = itemMap.get(c.component_item_id) || {};
      const uomCode = uomMap.get(c.uom_id) || '';
      const requiredQty = Math.max(0, num(c.required_qty) - num(c.issued_qty));
      const availableQty = availableForComponent(c.component_item_id, c.uom_id);
      const shortageQty = Math.max(0, requiredQty - availableQty);
      return {
        input_item_code: componentItem.item_code || 'UNKNOWN',
        input_item_name: componentItem.item_name || '',
        required_qty: Number(requiredQty.toFixed(4)),
        available_qty: Number(availableQty.toFixed(4)),
        shortage_qty: Number(shortageQty.toFixed(4)),
        uom_code: uomCode,
        display_required_qty: Number(displayQtyValue(requiredQty, uomCode).toFixed(4)),
        display_available_qty: Number(displayQtyValue(availableQty, uomCode).toFixed(4)),
        display_shortage_qty: Number(displayQtyValue(shortageQty, uomCode).toFixed(4)),
        display_uom_code: displayUomCode(uomCode, shortageQty),
      };
    });

    const shortages = input_details.filter(x => num(x.shortage_qty) > 0);
    const block_reason = !input_details.length
      ? 'No input required'
      : shortages.length
        ? `Missing: ${shortages.slice(0, 3).map(x => x.input_item_code).join(', ')}${shortages.length > 3 ? ' +' + (shortages.length - 3) : ''}`
        : 'Inputs available';

    return { ...row, fg_item: fgItem, block_reason, input_shortages: shortages };
  });
}

async function getValidMachinesForWorkOrder(woId) {
  const { data: wo, error: woErr } = await supabase
    .from('wo_headers')
    .select('id, item_id, source_ppo_line_id, process_type_id, stage_output_item_id, assigned_machine_id, routing_id')
    .eq('id', woId)
    .maybeSingle();

  if (woErr) return { data: [], error: woErr, status: 500 };
  if (!wo) return { data: [], error: { message: 'Work Order not found.' }, status: 404 };

  /* P3H-DIRB-ROUTING-AWARE */
  let effProcessTypeId = wo.process_type_id;
  let effOutputItemId = wo.stage_output_item_id || wo.item_id;
  let routeMachineRequired = null;
  if (!wo.process_type_id || !wo.stage_output_item_id) {
    const { data: sl } = await supabase
      .from('wo_step_lines')
      .select('routing_step_id, seq_no')
      .eq('wo_id', woId)
      .not('routing_step_id', 'is', null)
      .order('seq_no', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sl && sl.routing_step_id) {
      const { data: rs } = await supabase
        .from('routing_steps')
        .select('process_type_id, output_item_id, machine_required')
        .eq('id', sl.routing_step_id)
        .maybeSingle();
      if (rs) {
        if (!effProcessTypeId) effProcessTypeId = rs.process_type_id;
        if (!wo.stage_output_item_id && rs.output_item_id) effOutputItemId = rs.output_item_id;
        routeMachineRequired = rs.machine_required;
      }
    }
  }
  /* P3K-RECIPE-PRIMARY: routing-header fallback for drafts without snapshotted wo_step_lines.
     Recipe-step machine_id mapping (stage_recipe_steps by process_type_id + output_item_id) stays the
     candidate source; this only ensures the keys resolve so that mapping is reachable. */
  if (!effProcessTypeId && wo.routing_id) {
    const { data: rsteps } = await supabase
      .from('routing_steps')
      .select('seq_no, process_type_id, output_item_id, machine_required')
      .eq('routing_header_id', wo.routing_id)
      .eq('is_active', true)
      .order('seq_no', { ascending: true });
    if (rsteps && rsteps.length) {
      const producing = rsteps.find((s) => s.output_item_id === wo.item_id) || rsteps[rsteps.length - 1];
      if (!effProcessTypeId) effProcessTypeId = producing.process_type_id || null;
      if (!wo.stage_output_item_id && producing.output_item_id) effOutputItemId = producing.output_item_id;
      if (routeMachineRequired === null) routeMachineRequired = producing.machine_required;
    }
  }
  const outputItemId = effOutputItemId;

  // Stage WOs carry the stage item as wo.item_id / stage_output_item_id, which is NOT the
  // recipe parent (stage_recipe_headers.fg_item_id). Resolve the producing step DIRECTLY by
  // (output_item_id, process_type_id) regardless of header fg_item_id. Lookup only.
  async function resolveStepMachineTypeId() {
    if (!effProcessTypeId || !outputItemId) return {};
    const { data: steps, error: stepErr } = await supabase
      .from('stage_recipe_steps')
      .select('id, recipe_id, machine_id')
      .eq('process_type_id', effProcessTypeId)
      .eq('output_item_id', outputItemId);
    if (stepErr) return { error: stepErr };

    const candidateSteps = (steps || []).filter((s) => s.machine_id);
    if (!candidateSteps.length) return {};

    // Prefer a step whose recipe header is active; otherwise take any matching step.
    const recipeIds = [...new Set(candidateSteps.map((s) => s.recipe_id).filter(Boolean))];
    let activeRecipeIds = new Set();
    if (recipeIds.length) {
      const { data: headers, error: hErr } = await supabase
        .from('stage_recipe_headers')
        .select('id, status')
        .in('id', recipeIds);
      if (hErr) return { error: hErr };
      activeRecipeIds = new Set((headers || []).filter((h) => h.status === 'active').map((h) => h.id));
    }
    const chosen = candidateSteps.find((s) => activeRecipeIds.has(s.recipe_id)) || candidateSteps[0];
    if (!chosen?.machine_id) return {};

    const { data: recipeMachine, error: machineErr } = await supabase
      .from('machine_master')
      .select('id, machine_type_id')
      .eq('id', chosen.machine_id)
      .maybeSingle();
    if (machineErr) return { error: machineErr };
    return { machineId: chosen.machine_id, machineTypeId: recipeMachine?.machine_type_id || null };
  }

  const resolved = await resolveStepMachineTypeId();
  if (resolved.error) return { data: [], error: resolved.error, status: 500 };

  const byId = new Map();

  if (resolved.machineTypeId) {
    const { data: typeMachines, error: validErr } = await supabase
      .from('machine_master')
      .select('id, machine_code, machine_name, machine_type_id, cycle_time_sec, setup_time_min, batch_capacity_kg')
      .eq('machine_type_id', resolved.machineTypeId)
      .eq('is_active', true)
      .order('machine_code');
    if (validErr) return { data: [], error: validErr, status: 500 };
    for (const m of typeMachines || []) byId.set(m.id, m);
  }

  // Always include the recipe-step's own machine (covers machines with no machine_type_id).
  if (resolved.machineId && !byId.has(resolved.machineId)) {
    const { data: stepMachine, error: smErr } = await supabase
      .from('machine_master')
      .select('id, machine_code, machine_name, machine_type_id, cycle_time_sec, setup_time_min, batch_capacity_kg')
      .eq('id', resolved.machineId)
      .maybeSingle();
    if (smErr) return { data: [], error: smErr, status: 500 };
    if (stepMachine?.id) byId.set(stepMachine.id, stepMachine);
  }

  // Always include the WO's currently assigned machine so the dropdown shows it,
  // even when recipe-step resolution is incomplete.
  if (wo.assigned_machine_id && !byId.has(wo.assigned_machine_id)) {
    const { data: assignedMachine, error: amErr } = await supabase
      .from('machine_master')
      .select('id, machine_code, machine_name, machine_type_id, cycle_time_sec, setup_time_min, batch_capacity_kg')
      .eq('id', wo.assigned_machine_id)
      .maybeSingle();
    if (amErr) return { data: [], error: amErr, status: 500 };
    if (assignedMachine?.id) byId.set(assignedMachine.id, assignedMachine);
  }

  const machines = [...byId.values()].sort((a, b) =>
    String(a.machine_code || '').localeCompare(String(b.machine_code || '')));

  if (!machines.length) {
    return { data: [], error: { message: 'No valid machine configured for this Work Order process. Add a recipe-step machine mapping or assign a machine.' }, status: 409, machineRequired: routeMachineRequired };
  }

  return { data: machines, error: null, status: 200, machineRequired: routeMachineRequired };
}

router.get('/pickers',
  authenticate,
  roleGuard(READ_ROLES),
  async (_req, res) => {
    const [workers, shifts, machines] = await Promise.all([
      supabase.from('worker_master').select('id, worker_code, worker_name, department, designation').eq('is_active', true).order('worker_code'),
      supabase.from('shift_master').select('id, shift_code, shift_name, start_time, end_time').eq('is_active', true).order('shift_code'),
      supabase.from('machine_master').select('id, machine_code, machine_name, machine_type_id, cycle_time_sec, setup_time_min, batch_capacity_kg').eq('is_active', true).order('machine_code'),
    ]);

    if (workers.error || shifts.error || machines.error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load assignment pickers.', 500);
    }

    return sendSuccess(res, {
      workers: workers.data || [],
      shifts: shifts.data || [],
      machines: machines.data || [],
    });
  }
);

router.get('/:id/valid-machines',
  authenticate,
  roleGuard(READ_ROLES),
  async (req, res) => {
    try {
      const result = await getValidMachinesForWorkOrder(req.params.id);

      if (result.error) {
        return sendError(
          res,
          result.status === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.CONFLICT,
          result.error.message || 'No valid machine configured for this Work Order.',
          result.status || 409
        );
      }

      return sendSuccess(res, {
        machines: result.data || [],
        count: (result.data || []).length,
      });
    } catch (error) {
      console.error('production-work valid-machines error', error);
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load valid machines.', 500);
    }
  }
);

router.post('/:id/assign',
  authenticate,
  roleGuard(WRITE_ROLES),
  async (req, res) => {
    /* P3H-ASSIGN-NULLMACHINE */
    const { worker_id, shift_id, planned_start_at, note } = req.body || {};
    const machineIdRaw = (req.body || {}).machine_id;
    const machine_id =
      machineIdRaw === '' || machineIdRaw === 'null' || machineIdRaw === 'undefined'
        || machineIdRaw === undefined || machineIdRaw === null
        ? null
        : machineIdRaw;

    if (!worker_id || !shift_id || !planned_start_at) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Worker, shift and start time are required.', 400);
    }

    /* P3H-DIRB-REQUIRE */
    if (!machine_id) {
      const reqCheck = await getValidMachinesForWorkOrder(req.params.id);
      if (reqCheck && reqCheck.machineRequired === true) {
        return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'A machine is required for this process step. Please select a machine.', 400);
      }
    }

    if (machine_id) {
      const { data: machine, error: machineError } = await supabase
        .from('machine_master')
        .select('id')
        .eq('id', machine_id)
        .single();

      if (machineError || !machine) {
        return sendError(res, ERROR_CODES.NOT_FOUND, 'Machine not found.', 404);
      }

      const validMachineResult = await getValidMachinesForWorkOrder(req.params.id);
      if (validMachineResult.error) {
        return sendError(res, ERROR_CODES.CONFLICT, validMachineResult.error.message || 'No valid machine configured for this Work Order.', validMachineResult.status || 409);
      }

      const isValidMachine = (validMachineResult.data || []).some(m => m.id === machine_id);
      if (!isValidMachine) {
        return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Selected machine is not valid for this Work Order process.', 400);
      }
    }

    const runtime = await calculateWorkOrderExpectedMinutes(req.params.id, { machineId: machine_id });

    if (runtime.error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, runtime.error.message || 'Failed to calculate expected runtime.', 500);
    }

    const estimatedMinutes = runtime.data?.expected_minutes == null
      ? null
      : Math.max(1, Math.ceil(Number(runtime.data.expected_minutes)));

    const start = new Date(planned_start_at);
    const end = estimatedMinutes == null ? null : new Date(start.getTime() + estimatedMinutes * 60000);

    const { data, error } = await supabase
      .from('wo_headers')
      .update({
        assigned_worker_id: worker_id,
        assigned_shift_id: shift_id,
        assigned_machine_id: machine_id,
        assigned_by: req.user.id,
        assigned_at: new Date().toISOString(),
        planned_start_at: start.toISOString(),
        planned_end_at: end ? end.toISOString() : null,
        estimated_minutes: estimatedMinutes,
        assignment_note: note || null,
        updated_by: req.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'released')
      .select('id, wo_number, assigned_worker_id, assigned_shift_id, assigned_machine_id, planned_start_at, planned_end_at, estimated_minutes')
      .single();

    if (error) {
      return sendError(res, ERROR_CODES.CONFLICT, 'Only released Work Orders can be assigned.', 409);
    }

    return sendSuccess(res, data);
  }
);


router.get('/',
  authenticate,
  roleGuard(READ_ROLES),
  async (req, res) => {
    const { readiness, process } = req.query;

    let q = supabase
      .from('wo_headers')
      .select(`
        id,
        wo_number,
        item_id,
        source_ppo_id,
        source_ppo_line_id,
        source_sales_order_id,
        source_sales_order_line_id,
        customer_id,
        customer_lot_code,
        lot_tracking_scope,
        source_sales_order:source_sales_order_id(so_number),
        process_type_id,
        stage_output_item_id,
        planned_qty,
        status,
        wo_kind,
        source_internal_plan_id,
        source_internal_plan_line_id,
        readiness_status,
        ready_to_start_qty,
        blocked_qty,
        planned_process_date,
        assigned_worker_id,
        assigned_shift_id,
        assigned_machine_id,
        assigned_at,
        planned_start_at,
        planned_end_at,
        estimated_minutes,
        assignment_note,
        created_at,
        item:item_id(item_code,item_name),
        process:process_type_id(type_code,type_name),
        assigned_worker:assigned_worker_id(worker_code,worker_name),
        assigned_shift:assigned_shift_id(shift_code,shift_name),
        assigned_machine:assigned_machine_id(machine_code,machine_name,cycle_time_sec,setup_time_min,batch_capacity_kg)
      `)
      // P3-IPP-PRODUCTION-WORK-CHAIN-VISIBILITY-1:
      // Production Work must show the full INTERNAL_PLAN chain, not only the first released/READY stage.
      // Keep PPO_STAGE behavior restricted to released WOs; allow draft INTERNAL_PLAN WOs so blocked
      // downstream stages remain visible for manager review. Display-only; no posting/schema change.
      .in('wo_kind', ['PPO_STAGE', 'INTERNAL_PLAN'])
      // P3-CHAIN-COMPLETED-VISIBILITY: include 'completed' so finished INTERNAL_PLAN stages
      // remain in the manager chain summary (worker active list still excludes them by status).
      .in('status', ['released', 'RELEASED', 'draft', 'DRAFT', 'completed', 'COMPLETED'])
      .order('created_at', { ascending: true });

    const { data, error } = await q;

    if (error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to load production work.', 500);
    }

    let rows = (data || []).filter((r) => {
      const status = String(r.status || '').toLowerCase();
      const kind = String(r.wo_kind || '').toUpperCase();
      if (status === 'released') return true;
      // P3-CHAIN-COMPLETED-VISIBILITY: keep completed INTERNAL_PLAN stages visible so the manager
      // chain summary counts done stages; PPO_STAGE stays released-only.
      return kind === 'INTERNAL_PLAN' && (status === 'draft' || status === 'completed');
    });

    if (process && process !== 'ALL') {
      rows = rows.filter(r => r.process?.type_code === process);
    }

    rows = await addInputShortageReasons(rows);

    const woIds = rows.map(r => r.id).filter(Boolean);
    const producedByWo = new Map();

    if (woIds.length) {
      const { data: logs, error: logErr } = await supabase
        .from('production_logs')
        .select('wo_id, good_qty, scrap_qty, entry_type, correction_delta_good_qty, correction_delta_scrap_qty')
        .in('wo_id', woIds);

      if (!logErr) {
        for (const log of logs || []) {
          const current = producedByWo.get(log.wo_id) || { good_qty: 0, scrap_qty: 0 };

          if (log.entry_type === 'CORRECTION') {
            current.good_qty += Number(log.correction_delta_good_qty || 0);
            current.scrap_qty += Number(log.correction_delta_scrap_qty || 0);
          } else {
            current.good_qty += Number(log.good_qty || 0);
            current.scrap_qty += Number(log.scrap_qty || 0);
          }

          producedByWo.set(log.wo_id, current);
        }
      }
    }

    rows = rows.map(r => {
      const produced = producedByWo.get(r.id) || { good_qty: 0, scrap_qty: 0 };

      const plannedQty = Number(r.planned_qty || 0);
      const producedQty = Math.max(0, Number(produced.good_qty || 0));
      const storedReadyQty = Math.max(0, Number(r.ready_to_start_qty || 0));

      const isCompletedByLogs = plannedQty > 0 && producedQty >= plannedQty;
      const effectiveReadyQty = isCompletedByLogs
        ? plannedQty
        : Math.max(storedReadyQty, Math.min(plannedQty, producedQty));

      const effectiveBlockedQty = isCompletedByLogs
        ? 0
        : Math.max(0, plannedQty - effectiveReadyQty);

      const effectiveStatus = isCompletedByLogs
        ? 'COMPLETED'
        : effectiveReadyQty >= plannedQty
          ? 'READY'
          : effectiveReadyQty > 0
            ? 'PARTIAL'
            : (r.readiness_status || 'BLOCKED');

      return {
        ...r,
        readiness_status: effectiveStatus,
        stored_readiness_status: r.readiness_status,
        ready_to_start_qty: effectiveReadyQty,
        blocked_qty: effectiveBlockedQty,
        produced_qty: producedQty,
        logged_scrap_qty: produced.scrap_qty,
        is_completed_by_logs: isCompletedByLogs,
      };
    });

    if (readiness && readiness !== 'ALL') {
      rows = rows.filter(r => r.readiness_status === readiness);
    }

    return sendSuccess(res, rows);
  }
);

export default router;
