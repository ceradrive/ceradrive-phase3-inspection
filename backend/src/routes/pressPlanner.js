import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import { supabase } from '../config/supabase.js';
import { calculatePressPlan, createPressWorkOrder } from '../services/pressPlannerService.js';

const router = Router();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


router.get('/calculate',
  authenticate,
  roleGuard(ALL_ROLES),
  async (req, res) => {
    return sendSuccess(
      res,
      calculatePressPlan({
        qty: Number(req.query.qty || 0),
        cycleTimeSec: 510,
        pcsPerCycle: 8
      })
    );
  }
);


router.post('/resolve-items',
  authenticate,
  roleGuard(ALL_ROLES),
  async (req, res) => {
    try {
      const requestItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const codes = requestItems.map((x) => x.item_code).filter(Boolean);

      if (!codes.length) {
        return sendSuccess(res, { items: [] });
      }

      const { data: masterItems, error: itemErr } = await supabase
        .from('item_master')
        .select('id,item_code,item_name,stage_type,pcs_per_set')
        .in('item_code', codes);

      if (itemErr) throw itemErr;

      const itemById = new Map((masterItems || []).map((x) => [x.id, x]));
      const itemByCode = new Map((masterItems || []).map((x) => [x.item_code, x]));
      const targetIds = Array.from(itemById.keys());

      const { data: directHeaders, error: directHeaderErr } = targetIds.length
        ? await supabase
            .from('stage_recipe_headers')
            .select('id,fg_item_id,recipe_code,status')
            .eq('status', 'active')
            .in('fg_item_id', targetIds)
        : { data: [], error: null };

      if (directHeaderErr) throw directHeaderErr;

      const { data: targetOutputSteps, error: targetStepErr } = targetIds.length
        ? await supabase
            .from('stage_recipe_steps')
            .select('id,recipe_id,output_item_id,step_no')
            .in('output_item_id', targetIds)
        : { data: [], error: null };

      if (targetStepErr) throw targetStepErr;

      const outputRecipeIds = Array.from(new Set((targetOutputSteps || []).map((x) => x.recipe_id).filter(Boolean)));

      const { data: outputHeaders, error: outputHeaderErr } = outputRecipeIds.length
        ? await supabase
            .from('stage_recipe_headers')
            .select('id,fg_item_id,recipe_code,status')
            .eq('status', 'active')
            .in('id', outputRecipeIds)
        : { data: [], error: null };

      if (outputHeaderErr) throw outputHeaderErr;

      const recipeById = new Map();
      for (const h of directHeaders || []) recipeById.set(h.id, h);
      for (const h of outputHeaders || []) recipeById.set(h.id, h);

      const headerByTargetItemId = new Map();

      for (const h of directHeaders || []) {
        if (!headerByTargetItemId.has(h.fg_item_id)) headerByTargetItemId.set(h.fg_item_id, h);
      }

      for (const st of targetOutputSteps || []) {
        const header = recipeById.get(st.recipe_id);
        if (header && !headerByTargetItemId.has(st.output_item_id)) {
          headerByTargetItemId.set(st.output_item_id, header);
        }
      }

      const recipeIds = Array.from(recipeById.keys());

      let steps = [];
      if (recipeIds.length) {
        const { data, error } = await supabase
          .from('stage_recipe_steps')
          .select('id,recipe_id,output_item_id,step_no')
          .in('recipe_id', recipeIds);

        if (error) throw error;
        steps = data || [];
      }

      const outputIds = Array.from(new Set(steps.map((x) => x.output_item_id).filter(Boolean)));

      let outputItems = [];
      if (outputIds.length) {
        const { data, error } = await supabase
          .from('item_master')
          .select('id,item_code,item_name,stage_type')
          .in('id', outputIds);

        if (error) throw error;
        outputItems = data || [];
      }

      const outputById = new Map(outputItems.map((x) => [x.id, x]));
      const mldByRecipeId = new Map();

      for (const st of steps) {
        const out = outputById.get(st.output_item_id);
        if (String(out?.stage_type || '').toUpperCase() === 'MLD') {
          mldByRecipeId.set(st.recipe_id, out);
        }
      }

      const mldIds = Array.from(new Set(Array.from(mldByRecipeId.values()).map((x) => x.id)));

      let compat = [];
      if (mldIds.length) {
        const { data, error } = await supabase
          .from('die_compatibility')
          .select('item_id,die_id,is_preferred,is_active')
          .eq('is_active', true)
          .in('item_id', mldIds);

        if (error) throw error;
        compat = data || [];
      }

      const dieIds = Array.from(new Set(compat.map((x) => x.die_id).filter(Boolean)));

      let dies = [];
      if (dieIds.length) {
        const { data, error } = await supabase
          .from('die_master')
          .select('id,die_code,die_name,num_impressions,is_active,status')
          .in('id', dieIds);

        if (error) throw error;
        dies = data || [];
      }

      const dieById = new Map(dies.map((x) => [x.id, x]));

      // Real moulding slot cycle times for resolved dies — canonical source (same
      // field the runtime engine reads). No hardcoded 510. Read-only; safe .in() only.
      const slotCycleByDieId = new Map();
      const slotSetupByDieId = new Map(); // PHASEA2: setup/heating + machine_id per die (read-only)
      if (dieIds.length) {
        const addSlotRows = (rows) => {
          for (const s of rows || []) {
            for (const did of [s.slot_a_die_id, s.slot_b_die_id]) {
              if (did && !slotSetupByDieId.has(did)) {
                const _setup = s.setup_time_min == null ? null : Number(s.setup_time_min);
                const _heat = s.heating_time_min == null ? null : Number(s.heating_time_min);
                slotSetupByDieId.set(did, {
                  setup_time_min: Number.isFinite(_setup) ? _setup : null,
                  heating_time_min: Number.isFinite(_heat) ? _heat : null,
                  machine_id: s.machine_id || null,
                });
              }
            }
            const cyc = toNumber(s.cycle_time_sec, 0);
            if (cyc <= 0) continue;
            for (const did of [s.slot_a_die_id, s.slot_b_die_id]) {
              if (did && !slotCycleByDieId.has(did)) slotCycleByDieId.set(did, cyc);
            }
          }
        };
        const { data: slotA, error: slotAErr } = await supabase
          .from('moulding_slot_setups')
          .select('cycle_time_sec, setup_time_min, heating_time_min, machine_id, slot_a_die_id, slot_b_die_id')
          .eq('is_active', true)
          .in('slot_a_die_id', dieIds);
        if (slotAErr) throw slotAErr;
        addSlotRows(slotA);
        const { data: slotB, error: slotBErr } = await supabase
          .from('moulding_slot_setups')
          .select('cycle_time_sec, setup_time_min, heating_time_min, machine_id, slot_a_die_id, slot_b_die_id')
          .eq('is_active', true)
          .in('slot_b_die_id', dieIds);
        if (slotBErr) throw slotBErr;
        addSlotRows(slotB);
      }
      // PHASEA2: machine-master setup default (slot overrides machine). Read-only, safe .in().
      const machineSetupById = new Map();
      const machineIdsForSetup = [...new Set(Array.from(slotSetupByDieId.values()).map(v => v.machine_id).filter(Boolean))];
      if (machineIdsForSetup.length) {
        const { data: machRows, error: machErr } = await supabase
          .from('machine_master')
          .select('id, setup_time_min')
          .in('id', machineIdsForSetup);
        if (machErr) throw machErr;
        for (const m of machRows || []) {
          const mv = m.setup_time_min == null ? null : Number(m.setup_time_min);
          machineSetupById.set(m.id, Number.isFinite(mv) ? mv : null);
        }
      }

      const compatByItemId = new Map();

      for (const c of compat) {
        if (!compatByItemId.has(c.item_id) || c.is_preferred) {
          compatByItemId.set(c.item_id, c);
        }
      }

      const result = requestItems.map((item) => {
        const targetItem = itemByCode.get(item.item_code);
        const header = targetItem ? headerByTargetItemId.get(targetItem.id) : null;
        const mld = header ? mldByRecipeId.get(header.id) : null;
        const dc = mld ? compatByItemId.get(mld.id) : null;
        const die = dc ? dieById.get(dc.die_id) : null;

        const approvedQty = toNumber(item.approved_qty || item.suggested_qty);
        const pcsPerSet = toNumber(item.pcs_per_set || targetItem?.pcs_per_set || 4, 4);
        const uom = String(item.uom_code || '').toUpperCase();
        const productionPcs = uom === 'SET' ? approvedQty * pcsPerSet : approvedQty;

        const cavity = toNumber(die?.num_impressions, 0);
        // Canonical: real moulding slot cycle time. Missing -> no estimate + honest gap.
        const slotCycleSec = die ? toNumber(slotCycleByDieId.get(die.id), 0) : 0;
        // PHASEA2: dynamic setup/heating from master — slot overrides machine default; no hardcoding.
        const rawSlot = die ? (slotSetupByDieId.get(die.id) || null) : null;
        const machineSetup = rawSlot ? (machineSetupById.has(rawSlot.machine_id) ? machineSetupById.get(rawSlot.machine_id) : null) : null;
        const setupTimeMin = (rawSlot && rawSlot.setup_time_min != null) ? rawSlot.setup_time_min : machineSetup;
        const heatingTimeMin = (rawSlot && rawSlot.heating_time_min != null) ? rawSlot.heating_time_min : null;
        const setupTimeSource = (rawSlot && rawSlot.setup_time_min != null) ? 'SLOT' : (machineSetup != null ? 'MACHINE' : 'NONE');
        const heatingTimeSource = (rawSlot && rawSlot.heating_time_min != null) ? 'SLOT' : 'NONE';
        const hasCycle = slotCycleSec > 0;
        const cyclesRequired = cavity > 0 ? Math.ceil(productionPcs / cavity) : null;
        const runtimeHours = (cyclesRequired && hasCycle)
          ? Number(((cyclesRequired * slotCycleSec) / 3600).toFixed(2))
          : null;
        const pressDays = runtimeHours ? Number((runtimeHours / 24).toFixed(2)) : null;
        const cycleSource = hasCycle ? 'MOULDING_SLOT' : (die ? 'MISSING_SLOT_CYCLE' : 'MISSING_DIE');
        const missingStandard = !(die && cavity > 0 && hasCycle);
        const runtimeWarnings = [];
        if (!die) runtimeWarnings.push('No compatible die resolved for moulded item.');
        else if (cavity <= 0) runtimeWarnings.push('Die cavity (num_impressions) missing.');
        else if (!hasCycle) runtimeWarnings.push('Moulding slot cycle time missing for this die.');

        return {
          ...item,
          item_id: item.item_id || item.id || targetItem?.id || null,
          id: item.id || item.item_id || targetItem?.id || null,
          item_code: targetItem?.item_code || item.item_code,
          item_name: item.item_name || targetItem?.item_name || '',
          stage_type: item.stage_type || targetItem?.stage_type || '',
          uom_code: item.uom_code || 'PCS',
          fg_item_id: header?.fg_item_id || null,
          recipe_code: header?.recipe_code || null,
          moulded_item_code: mld?.item_code || null,
          die_code: die?.die_code || null,
          die_name: die?.die_name || null,
          cavity,
          cycle_time_sec: hasCycle ? slotCycleSec : null,
          cycle_time_source: cycleSource,
          pcs_per_set: pcsPerSet,
          production_pcs: productionPcs,
          cycles_required: cyclesRequired,
          runtime_hours: runtimeHours,
          run_runtime_hours: runtimeHours, // PHASEA2: explicit run-only (== runtime_hours)
          setup_time_min: setupTimeMin, // PHASEA2: slot.setup_time_min ?? machine_master.setup_time_min
          heating_time_min: heatingTimeMin, // PHASEA2: slot.heating_time_min only (no machine column yet)
          setup_time_source: setupTimeSource, // PHASEA2: SLOT | MACHINE | NONE
          heating_time_source: heatingTimeSource, // PHASEA2: SLOT | NONE
          press_days: pressDays,
          missing_standard: missingStandard,
          runtime_warnings: runtimeWarnings,
          readiness: (die && cavity > 0 && hasCycle) ? 'OK' : cycleSource
        };
      });

      return sendSuccess(res, { items: result });
    } catch (error) {
      return sendError(
        res,
        ERROR_CODES.INTERNAL_ERROR,
        error.message || 'Failed to resolve press planner items.',
        500
      );
    }
  }
);

router.get('/mounted-dies',
  authenticate,
  roleGuard(ALL_ROLES),
  async (req, res) => {
    try {
      // B0B_MOUNTED_DIES: read-only current mounted die per slot for a press. No writes.
      const press = String(req.query.press || '').trim();
      // Derive machine_code dynamically: PRESS_<N> -> MOULD_PRESS_<N padded to >=2 digits>. No label matching.
      const pressNumMatch = /^PRESS_(\d+)$/.exec(press);
      const machineCode = pressNumMatch ? `MOULD_PRESS_${String(Number(pressNumMatch[1])).padStart(2, '0')}` : null;
      const emptyDies = { A: null, B: null };

      if (!machineCode) {
        return sendSuccess(res, { press, machine_code: null, machine_id: null, setup_id: null, setup_code: null, multiple_active_setups: false, reason: 'machine_not_found', mounted_dies: emptyDies });
      }

      const { data: machRows, error: mErr } = await supabase
        .from('machine_master')
        .select('id, machine_code')
        .eq('machine_code', machineCode);
      if (mErr) throw mErr;
      const machine = (machRows || [])[0] || null;
      if (!machine) {
        return sendSuccess(res, { press, machine_code: machineCode, machine_id: null, setup_id: null, setup_code: null, multiple_active_setups: false, reason: 'machine_not_found', mounted_dies: emptyDies });
      }

      const { data: setupRows, error: sErr } = await supabase
        .from('moulding_slot_setups')
        .select('id, setup_code, slot_a_die_id, slot_b_die_id, updated_at, is_active')
        .eq('machine_id', machine.id)
        .eq('is_active', true);
      if (sErr) throw sErr;

      const activeRows = setupRows || [];
      const multipleActive = activeRows.length > 1;
      const withUpdated = activeRows.filter((r) => r.updated_at != null);

      if (!withUpdated.length) {
        return sendSuccess(res, { press, machine_code: machineCode, machine_id: machine.id, setup_id: null, setup_code: null, multiple_active_setups: multipleActive, reason: 'ambiguous_active_setup', mounted_dies: emptyDies });
      }

      withUpdated.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      const chosen = withUpdated[0];

      const dieIds = [chosen.slot_a_die_id, chosen.slot_b_die_id].filter(Boolean);
      const dieCodeById = new Map();
      if (dieIds.length) {
        const { data: dieRows, error: dErr } = await supabase
          .from('die_master')
          .select('id, die_code')
          .in('id', dieIds);
        if (dErr) throw dErr;
        for (const d of dieRows || []) dieCodeById.set(d.id, d.die_code);
      }
      const toDie = (id) => (id ? { die_id: id, die_code: dieCodeById.get(id) || null } : null);

      return sendSuccess(res, {
        press,
        machine_code: machineCode,
        machine_id: machine.id,
        setup_id: chosen.id,
        setup_code: chosen.setup_code,
        multiple_active_setups: multipleActive,
        reason: null,
        mounted_dies: { A: toDie(chosen.slot_a_die_id), B: toDie(chosen.slot_b_die_id) },
      });
    } catch (error) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to resolve mounted dies.', 500);
    }
  }
);

router.post('/work-orders',
  authenticate,
  roleGuard(ALL_ROLES),
  async (req, res) => {
    return sendError(
      res,
      ERROR_CODES.VALIDATION_ERROR,
      'Direct Press Planner Work Order creation is disabled. Create PPO first, then generate stage WOs from PPO.',
      400
    );
  }
);


export default router;
