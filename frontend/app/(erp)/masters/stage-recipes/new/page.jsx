'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api.js';
import { useToast } from '../../../../../components/ui/Toast.jsx';

const CALC_OPTIONS = [
  ['', 'Not set'], ['WEIGHT_BATCH', 'Weight batch'], ['PCS_TRAY', 'PCS per tray'], ['DIE_CAVITY', 'Die cavity'],
  ['PCS_CYCLE', 'PCS per cycle'], ['PCS_PER_HOUR', 'PCS per hour'], ['PCS_PER_MIN', 'PCS per minute'],
  ['PCS_CRATE', 'PCS per crate'], ['TRAY_BATCH', 'Tray batch'], ['MANUAL', 'Manual'],
];
const POLICY_OPTIONS = [['', 'Not set'], ['MAKE_TO_STOCK', 'Make to stock'], ['MAKE_TO_ORDER', 'Make to order']];
const UNIT_OPTIONS = [['', 'Not set'], ['PCS', 'PCS'], ['SET', 'SET'], ['KG', 'KG'], ['TRAY', 'TRAY'], ['CRATE', 'CRATE']];
const QTY_BASIS = [['PER_BATCH', 'Formula batch'], ['PER_OUTPUT', 'Per output'], ['PER_SET', 'Per set'], ['FIXED', 'Fixed']];

const ctrl = { height: 36, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', fontSize: 13, color: '#111827', background: '#fff', boxSizing: 'border-box', width: '100%' };
const lbl = { display: 'block', fontSize: 12, color: '#374151', fontWeight: 700, marginBottom: 5 };

// 8Y-8A: Ceradrive theme tokens, applied only to new/modified controls + preview.
// RB-COMPACT-STEPS-1: compact two-column recipe step cards; machine remains manual/select.
// RB-DYNAMIC-STEP-HEADER-1: step card header reads process from the live process dropdown.
const TH = { primary: '#004AC6', text: '#0F172A', muted: '#64748B', border: '#E2E8F0', bg: '#F8FAFC', card: '#fff' };
function uomIdByCode(uoms, code) {
  const u = (uoms || []).find((x) => String(x.uom_code || '').toUpperCase() === code);
  return u ? u.id : '';
}
function isFinalSetStep(step, item) {
  // DP5: SET stage = output item is the parent, or stage_type/planning_unit === 'SET'.
  if (!item) return false;
  return String(item.stage_type || '').toUpperCase() === 'SET'
    || String(item.planning_unit || '').toUpperCase() === 'SET';
}
function previewMinutesLabel(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return '0 min';
  if (total < 60) return `${total} min`;
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

// 8Y-8B: three simple Recipe Builder modes (UI-only; not persisted — DP-B1 Option 1).
const RECIPE_TYPES = [
  ['MIX_FORMULA', 'Mix / Formula'],
  ['MTS_PROCESS_CHAIN', 'Process chain to stock'],
  ['MTO_PACKING_SET', 'Packing / Final Set'],
];
function policyForType(type) {
  // DP-B3: type auto-sets make policy (user can still override).
  return type === 'MTO_PACKING_SET' ? 'MAKE_TO_ORDER' : 'MAKE_TO_STOCK';
}
function emptyInput() { return { key: Date.now() + Math.random(), input_item_id: '', qty: '1', uom_id: '', qty_basis: 'PER_BATCH', notes: '' }; }
function emptyStep(n) { return { key: Date.now() + Math.random(), step_no: n, output_item_id: '', output_basis_qty: '1', output_basis_uom_id: '', process_type_id: '', machine_id: '', calculation_basis: '', qc_required: false, fpa_required: false, dependency_step_no: '', notes: '', inputs: [emptyInput()] }; }
function n(v) { return v === '' || v == null ? null : Number(v); }
function optLabel(item) { return item ? `${item.item_code} — ${item.item_name}` : '—'; }
function machineLabel(m) { return m ? `${m.machine_code} — ${m.machine_name}` : '—'; }
function processLabel(p) { return p ? `${p.type_code} — ${p.type_name}` : '—'; }
function processHeaderLabel(processes, processTypeId) {
  const proc = (processes || []).find((p) => String(p.id) === String(processTypeId));
  return proc ? String(proc.type_code || proc.type_name || 'PROCESS').toUpperCase() : 'Select process';
}

function ItemSearchSelect({ items, valueId, valueLabel, placeholder = 'Search input item…', onPick, resetKey }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setOpen(false);
    setQ('');
    setActiveIndex(0);
  }, [resetKey]);


  const results = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (text.length < 2) return [];
    return items
      .filter(i => `${i.item_code || ''} ${i.item_name || ''}`.toLowerCase().includes(text))
      .slice(0, 20);
  }, [items, q]);

  function pick(item) {
    if (!item) return;
    onPick(item);
    setQ('');
    setOpen(false);
    setActiveIndex(0);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={open ? q : (valueLabel || '')}
        onFocus={() => { setOpen(true); setQ(''); setActiveIndex(0); }}
        onChange={e => { setQ(e.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault();
            setOpen(true);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[activeIndex]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        style={ctrl}
      />
      {open && q.trim().length >= 2 && (
        <div style={{
          position: 'absolute',
          zIndex: 300,
          top: 38,
          left: 0,
          right: 0,
          maxHeight: 280,
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid #D1D5DB',
          borderRadius: 6,
          boxShadow: '0 18px 38px rgba(15,23,42,0.18)',
        }}>
          {results.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); pick(item); }}
              onMouseEnter={() => setActiveIndex(idx)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: idx === activeIndex ? '#EEF2FF' : '#fff',
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{item.item_code}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{item.item_name}</div>
            </button>
          ))}
          {!results.length && <div style={{ padding: 10, fontSize: 12, color: '#9CA3AF' }}>{q.trim().length < 2 ? 'Type at least 2 letters to search' : 'No item found'}</div>}
        </div>
      )}
    </div>
  );
}


function calcPreview(step, items, machines) {
  // RB-RUNTIME-HINT-1: display item-specific calculation anchors from the actual
  // recipe input/output items. Machine selection remains manual/blank.
  const output = items.find(i => i.id === step.output_item_id);
  const inputItems = (step.inputs || [])
    .map(input => items.find(i => i.id === input.input_item_id))
    .filter(Boolean);
  const weightedInput = inputItems.find(i => Number(i?.bp_weight_g || i?.weight_g || 0) > 0);
  const machine = machines.find(m => m.id === step.machine_id);
  const basis = step.calculation_basis;
  const lines = [];
  if (!basis) return ['Select calculation basis to see preview hints.'];
  if (basis === 'WEIGHT_BATCH') {
    const itemWeight = weightedInput?.bp_weight_g ?? weightedInput?.weight_g ?? output?.bp_weight_g ?? output?.weight_g;
    lines.push(`Item weight: ${itemWeight ?? 'missing'} g`);
    lines.push(`Machine planning capacity: ${machine?.planning_capacity ?? machine?.batch_capacity_kg ?? 'missing'} ${machine?.capacity_uom ?? 'kg/batch'}`);
    lines.push(`Cycle time: ${machine?.cycle_time_sec ? `${Math.round(machine.cycle_time_sec / 60)} min` : 'missing'}`);
  } else if (basis === 'PCS_TRAY') {
    lines.push(`PCS / tray: ${output?.default_pcs_per_tray ?? 'missing'}`);
    lines.push(`Cycle time: ${machine?.cycle_time_sec ? `${Math.round(machine.cycle_time_sec / 60)} min` : 'missing'}`);
  } else if (basis === 'TRAY_BATCH') {
    lines.push(`PCS / tray: ${output?.default_pcs_per_tray ?? 'missing'}`);
    lines.push(`Machine trays / batch: ${machine?.tray_capacity ?? 'missing'}`);
    lines.push(`Cycle time: ${machine?.cycle_time_sec ? `${Math.round(machine.cycle_time_sec / 60)} min` : 'missing'}`);
  } else if (basis === 'DIE_CAVITY') {
    lines.push(`Cavity: ${output?.cavity_count ?? 'from Die Master later'}`);
    lines.push(`Cycle time: ${machine?.cycle_time_sec ? `${Math.round(machine.cycle_time_sec / 60)} min` : 'missing'}`);
  } else if (basis === 'PCS_CYCLE') {
    lines.push(`PCS / cycle: ${machine?.pcs_per_cycle ?? 'missing'}`);
    lines.push(`Cycle time: ${machine?.cycle_time_sec ? `${machine.cycle_time_sec} sec` : 'missing'}`);
  } else if (basis === 'PCS_PER_HOUR') {
    lines.push(`Machine rate: ${machine?.pcs_per_hour ?? 'missing'} pcs/hour`);
  } else if (basis === 'PCS_CRATE') {
    lines.push(`PCS / crate: ${output?.default_pcs_per_crate ?? 'missing'}`);
  } else {
    lines.push('Manual / future calculation basis.');
  }
  return lines;
}

export default function StageRecipeNewPage() {
  const router = useRouter();
  const addToast = useToast();
  const [items, setItems] = useState([]);
  const [machines, setMachines] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [previewQty, setPreviewQty] = useState('1000');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [lastPreviewSig, setLastPreviewSig] = useState('');
  const [recipeType, setRecipeType] = useState('MIX_FORMULA');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const [recipeCode, setRecipeCode] = useState('');
  const [recipeName, setRecipeName] = useState('');
  const [fgItemId, setFgItemId] = useState('');
  const [planningUnit, setPlanningUnit] = useState('PCS');
  const [makePolicy, setMakePolicy] = useState('MAKE_TO_STOCK');
  const [status, setStatus] = useState('draft');
  const [notes, setNotes] = useState('');
  const [steps, setSteps] = useState([emptyStep(1)]);

  useEffect(() => {
    api.get('/api/v1/stage-recipes/items', { limit: 500 }).then(({ data }) => setItems(data ?? []));
    api.get('/api/v1/stage-recipes/process-types').then(({ data }) => setProcesses(data ?? []));
    api.get('/api/v1/stage-recipes/machines').then(({ data }) => setMachines(data ?? []));
    api.get('/api/v1/boms/uoms').then(({ data }) => setUoms(data ?? []));
  }, []);

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const parentItem = fgItemId ? itemById.get(fgItemId) : null;
  const setSize = Number(parentItem?.pcs_per_set || 0);

  // 8Y-8B mode flags.
  const showParent = recipeType !== 'MIX_FORMULA';
  const parentRequired = recipeType === 'MTO_PACKING_SET';
  const showApplySetBasis = recipeType === 'MTO_PACKING_SET' && setSize > 0;
  const showSetComposition = recipeType === 'MTO_PACKING_SET';

  const previewSignature = useMemo(() => JSON.stringify({
    q: previewQty,
    s: steps.map(st => ({
      o: st.output_item_id, b: st.output_basis_qty, u: st.output_basis_uom_id,
      m: st.machine_id, p: st.process_type_id, c: st.calculation_basis,
      i: (st.inputs || []).map(x => [x.input_item_id, x.qty, x.uom_id, x.qty_basis]),
    })),
  }), [previewQty, steps]);

  // DP-B4: preview is manual only (no auto-run) — page stays light.
  const previewStale = !!preview && previewSignature !== lastPreviewSig;

  async function runPreview() {
    if (!steps.some(s => s.output_item_id) || !(Number(previewQty) > 0)) {
      setPreviewError('Add an output item and a quantity first.'); return;
    }
    const body = { preview_qty: Number(previewQty), steps: payload().steps };
    setPreviewLoading(true);
    const { data, error } = await api.post('/api/v1/stage-recipes/preview', body);
    setPreviewLoading(false);
    if (error) { setPreviewError(error.message || 'Preview failed.'); setPreview(null); return; }
    setPreviewError('');
    setPreview(data);
    setLastPreviewSig(previewSignature);
  }

  function changeRecipeType(type) {
    setRecipeType(type);
    setMakePolicy(policyForType(type)); // DP-B3
  }

  function applySetBasis() {
    // DP5: parent-as-output / stage_type / planning_unit === 'SET' identifies SET stage.
    if (!(setSize > 0)) return;
    const pcsUom = uomIdByCode(uoms, 'PCS');
    const setUom = uomIdByCode(uoms, 'SET');
    let finalFound = false;
    setSteps(prev => prev.map(s => {
      const item = itemById.get(s.output_item_id);
      const isFinal = (fgItemId && s.output_item_id === fgItemId) || isFinalSetStep(s, item);
      if (isFinal) {
        finalFound = true;
        return { ...s, output_basis_qty: '1', output_basis_uom_id: setUom || s.output_basis_uom_id };
      }
      return { ...s, output_basis_qty: String(setSize), output_basis_uom_id: pcsUom || s.output_basis_uom_id };
    }));
    addToast(finalFound
      ? `Set basis applied: pad stages ${setSize} PCS, final SET stage 1 SET.`
      : `Pad stages set to ${setSize} PCS. Final SET stage not detected — set the SET stage manually.`);
  }

  function finalSetStepKey() {
    const byParent = steps.find(s => fgItemId && s.output_item_id === fgItemId);
    if (byParent) return byParent.key;
    const byType = steps.find(s => isFinalSetStep(s, itemById.get(s.output_item_id)));
    if (byType) return byType.key;
    return steps.length === 1 ? steps[0].key : null;
  }

  function applySetComposition(mode) {
    // DP-B6: composition is stored as recipe input rows; BOM follows inputs exactly.
    const pcsUom = uomIdByCode(uoms, 'PCS');
    const key = finalSetStepKey();
    if (!key) { addToast('Final SET stage not detected — select the parent or SET output first.'); return; }
    if (mode === 'INNER_OUTER' && setSize !== 4) {
      addToast(`Inner/Outer auto-split needs a set size of 4 (current: ${setSize || 'not set'}). Add the two rows manually and confirm.`);
      return;
    }
    setSteps(prev => prev.map(s => {
      if (s.key !== key) return s;
      const rows = mode === 'INNER_OUTER'
        ? [
            { key: Date.now() + Math.random(), input_item_id: '', qty: '2', uom_id: pcsUom || '', qty_basis: 'PER_OUTPUT', notes: 'Inner' },
            { key: Date.now() + Math.random() + 1, input_item_id: '', qty: '2', uom_id: pcsUom || '', qty_basis: 'PER_OUTPUT', notes: 'Outer' },
          ]
        : [
            { key: Date.now() + Math.random(), input_item_id: '', qty: String(setSize || 4), uom_id: pcsUom || '', qty_basis: 'PER_OUTPUT', notes: '' },
          ];
      return { ...s, inputs: rows };
    }));
    addToast(mode === 'INNER_OUTER'
      ? 'Inner/Outer composition added: 2 PCS + 2 PCS. Pick STK-I and STK-O items.'
      : `Same-pad composition added: ${setSize || 4} PCS. Pick the STK item.`);
  }

  function setStep(key, patch) { setSteps(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s)); }
  function addStep() { setSteps(prev => [...prev, emptyStep(prev.length + 1)]); }
  function removeStep(key) { setSteps(prev => prev.length > 1 ? prev.filter(s => s.key !== key).map((s, i) => ({ ...s, step_no: i + 1 })) : prev); }
  function setInput(stepKey, inputKey, patch) { setSteps(prev => prev.map(s => s.key === stepKey ? { ...s, inputs: s.inputs.map(i => i.key === inputKey ? { ...i, ...patch } : i) } : s)); }
  function addInput(stepKey) { setSteps(prev => prev.map(s => s.key === stepKey ? { ...s, inputs: [...s.inputs, emptyInput()] } : s)); }
  function removeInput(stepKey, inputKey) { setSteps(prev => prev.map(s => s.key === stepKey ? { ...s, inputs: s.inputs.length > 1 ? s.inputs.filter(i => i.key !== inputKey) : s.inputs } : s)); }

  function validate() {
    const e = {};
    if (!recipeCode.trim()) e.recipeCode = 'Recipe code is required.';
    if (!recipeName.trim()) e.recipeName = 'Recipe name is required.';
    if (recipeType === 'MTO_PACKING_SET' && !fgItemId) e.fgItem = 'Parent FG/Set is required for a Packing / Final Set recipe.';
    for (const s of steps) {
      if (!s.output_item_id) e.steps = 'Every step needs an output item.';
      if (!s.inputs.some(i => i.input_item_id)) e.steps = 'Every step needs at least one input item.';
    }
    return e;
  }

  function payload() {
    return {
      recipe_code: recipeCode.trim().toUpperCase(), recipe_name: recipeName.trim(), fg_item_id: fgItemId || null,
      planning_unit: planningUnit || null, make_policy: makePolicy || null, status, notes: notes.trim() || null,
      steps: steps.map(s => ({
        step_no: Number(s.step_no), output_item_id: s.output_item_id, output_basis_qty: n(s.output_basis_qty) ?? 1, output_basis_uom_id: s.output_basis_uom_id || null, process_type_id: s.process_type_id || null,
        machine_id: s.machine_id || null, calculation_basis: s.calculation_basis || null,
        qc_required: s.qc_required, fpa_required: s.fpa_required,
        dependency_step_no: s.dependency_step_no === '' ? null : Number(s.dependency_step_no), notes: s.notes.trim() || null,
        inputs: s.inputs.filter(i => i.input_item_id).map(i => ({ input_item_id: i.input_item_id, qty: n(i.qty) ?? 1, uom_id: i.uom_id || null, qty_basis: i.qty_basis, notes: i.notes.trim() || null })),
      })),
    };
  }

  async function save() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    const { data, error } = await api.post('/api/v1/stage-recipes/master', payload());
    setSaving(false);
    if (error) { addToast(error.message ?? 'Failed to create recipe.'); return; }
    addToast('Stage recipe created.');
    router.push(`/masters/stage-recipes/${data.id}`);
  }

  return (
    <div style={{ padding: '14px 18px 80px', maxWidth: 1320, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <button onClick={() => router.push('/masters/stage-recipes')} style={{ border: 'none', background: 'none', color: '#6B7280', cursor: 'pointer', padding: 0, marginBottom: 6, fontSize: 12, fontWeight: 700 }}>← Stage Recipes</button>
      <h1 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>New Manufacturing Recipe</h1>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: TH.muted, fontWeight: 800 }}>Recipe type</div>
        <div style={{ display: 'inline-flex', background: TH.bg, border: `1px solid ${TH.border}`, borderRadius: 9, padding: 3, gap: 3, flexWrap: 'wrap' }}>
          {RECIPE_TYPES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => changeRecipeType(v)}
              style={{ border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: recipeType === v ? TH.primary : 'transparent', color: recipeType === v ? '#fff' : TH.text }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* RB-TOP-COMPACT-1 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, margin: '0 0 8px', background: 'rgba(255,255,255,0.97)', border: `1px solid ${TH.border}`, borderRadius: 10, padding: '8px 10px', boxShadow: '0 4px 12px rgba(15,23,42,0.06)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: TH.text, background: TH.bg, border: `1px solid ${TH.border}`, borderRadius: 999, padding: '4px 8px' }}>{recipeCode || 'New recipe'}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: TH.primary, background: '#fff', border: `1px solid ${TH.border}`, borderRadius: 999, padding: '4px 8px' }}>Draft</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: TH.muted, background: '#fff', border: `1px solid ${TH.border}`, borderRadius: 999, padding: '4px 8px' }}>{RECIPE_TYPES.find(([v]) => v === recipeType)?.[1] || recipeType}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: TH.primary, background: '#EFF6FF', border: `1px solid ${TH.border}`, borderRadius: 999, padding: '4px 8px' }}>BOM on Activate only</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(220px,1fr) minmax(220px,1fr) 140px 160px 120px', gap: 8, marginBottom: 10, alignItems: 'end' }}>
        <div><label style={lbl}>Code *</label><input value={recipeCode} onChange={e => setRecipeCode(e.target.value.toUpperCase())} style={ctrl} /></div>
        <div><label style={lbl}>Recipe name *</label><input value={recipeName} onChange={e => setRecipeName(e.target.value)} style={ctrl} /></div>
        <div style={{ display: showParent ? 'block' : 'none' }}>
          <label style={lbl}>{parentRequired ? 'Parent FG/Set *' : 'Parent FG/Set (optional reference)'}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <ItemSearchSelect
                items={items}
                valueId={fgItemId}
                valueLabel={fgItemId ? optLabel(itemById.get(fgItemId)) : ''}
                placeholder="Search parent FG/Set…"
                resetKey={fgItemId}
                onPick={(it) => setFgItemId(it.id)}
              />
            </div>
            {fgItemId && (
              <button type="button" onClick={() => { setFgItemId(''); }}
                style={{ height: 36, border: `1px solid ${TH.border}`, borderRadius: 6, background: TH.card, color: TH.muted, cursor: 'pointer', padding: '0 10px', fontSize: 12 }}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div><label style={lbl}>Planning unit</label><select value={planningUnit} onChange={e => setPlanningUnit(e.target.value)} style={ctrl}>{UNIT_OPTIONS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label style={lbl}>Make policy</label><select value={makePolicy} onChange={e => setMakePolicy(e.target.value)} style={ctrl}>{POLICY_OPTIONS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label style={lbl}>Status</label><select value={status} onChange={e => setStatus(e.target.value)} style={ctrl}><option value="draft">Draft</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div>
      {showParent && (
        <div style={{ fontSize: 11, color: TH.muted, margin: '-4px 0 8px' }}>
          {parentRequired
            ? 'Packing / Final Set: pick the sellable SET this recipe packs. Set composition (below) decides the STK pads.'
            : 'Optional reference only — a process-chain recipe makes stock and does not need a parent.'}
        </div>
      )}
      {errors.fgItem && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>{errors.fgItem}</div>}

      {showApplySetBasis && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: TH.card, border: `1px solid ${TH.border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 14, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
          <span style={{ fontSize: 13, color: TH.text, fontWeight: 700 }}>Set size: {setSize} PCS</span>
          <span style={{ fontSize: 12, color: TH.muted }}>Pad stages → {setSize} PCS · Final SET stage → 1 SET</span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={applySetBasis}
            style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 8, background: TH.primary, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            Apply Set Basis
          </button>
        </div>
      )}

      {showSetComposition && (
        <div style={{ background: TH.card, border: `1px solid ${TH.border}`, borderRadius: 12, padding: 14, marginBottom: 14, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TH.text, marginBottom: 4 }}>Set composition</div>
          <div style={{ fontSize: 12, color: TH.muted, marginBottom: 10 }}>
            Scaffolds the final SET inputs. Same pad = one STK row × {setSize || 4} PCS. Inner/Outer = STK-I × 2 + STK-O × 2 PCS. Pick the STK items after.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => applySetComposition('SAME')}
              style={{ height: 34, padding: '0 14px', border: `1px solid ${TH.primary}`, borderRadius: 8, background: TH.card, color: TH.primary, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              Same pad ({setSize || 4} PCS)
            </button>
            <button type="button" onClick={() => applySetComposition('INNER_OUTER')}
              style={{ height: 34, padding: '0 14px', border: `1px solid ${TH.primary}`, borderRadius: 8, background: TH.card, color: TH.primary, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              Inner / Outer (2 + 2 PCS)
            </button>
          </div>
        </div>
      )}
      {errors.recipeCode && <div style={{ color: '#DC2626', fontSize: 12 }}>{errors.recipeCode}</div>}
      {errors.recipeName && <div style={{ color: '#DC2626', fontSize: 12 }}>{errors.recipeName}</div>}
      {errors.steps && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>{errors.steps}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 12, alignItems: 'start' }}>
        {steps.map((s) => (
          <div key={s.key} style={{ padding: 0 }}>
            <div style={{ border: `1px solid ${TH.border}`, borderRadius: 10, background: '#fff', overflow: 'visible', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
              <div style={{ minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: TH.bg, borderBottom: `1px solid ${TH.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: TH.text, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Step {String(s.step_no).padStart(2, '0')} · {processHeaderLabel(processes, s.process_type_id)}
                </div>
                <div style={{ fontSize: 10, fontWeight: 900, color: TH.primary, background: '#fff', border: `1px solid ${TH.border}`, borderRadius: 999, padding: '3px 8px', letterSpacing: 0.2, whiteSpace: 'nowrap' }}>Formula flow</div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => removeStep(s.key)} style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Remove</button>
              </div>

              <div style={{ padding: 10, display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) 62px 70px', gap: 6, alignItems: 'center' }}>
                  <div style={{ display: 'none' }}>THIS STAGE PRODUCES</div>
                  <ItemSearchSelect items={items} valueId={s.output_item_id} valueLabel={optLabel(itemById.get(s.output_item_id))} placeholder="Search output item…" onPick={(it) => setStep(s.key, { output_item_id: it.id, output_basis_uom_id: s.output_basis_uom_id || it?.uom_id || '', calculation_basis: it?.calculation_basis ?? s.calculation_basis })} />
                  <input title="These quantities make" placeholder="Qty" type="number" step="any" min="0.0001" value={s.output_basis_qty || ''} onChange={e => setStep(s.key, { output_basis_qty: e.target.value })} style={ctrl} />
                  <select title="Output UOM" value={s.output_basis_uom_id || ''} onChange={e => setStep(s.key, { output_basis_uom_id: e.target.value })} style={ctrl}>
                    <option value="">UOM</option>
                    {uoms.map(u => <option key={u.id} value={u.id}>{u.uom_code}</option>)}
                  </select>
                  <div style={{ display: 'none' }}>{itemById.get(s.output_item_id)?.item_code || 'output item'} · basis</div>
                </div>

                <div style={{ display: 'none' }} />

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(145px,1fr) minmax(145px,1fr) 118px 44px', gap: 6, alignItems: 'center' }}>
                  <div style={{ display: 'none' }}>STAGE / PROCESS</div>
                  <select value={s.process_type_id} onChange={e => setStep(s.key, { process_type_id: e.target.value })} style={ctrl}><option value="">Select</option>{processes.map(p => <option key={p.id} value={p.id}>{processLabel(p)}</option>)}</select>
                  <select value={s.machine_id} onChange={e => { const m = machines.find(x => x.id === e.target.value); setStep(s.key, { machine_id: e.target.value, calculation_basis: s.calculation_basis || m?.capacity_basis || '' }); }} style={ctrl}><option value="">Select</option>{machines.map(m => <option key={m.id} value={m.id}>{machineLabel(m)}</option>)}</select>
                  <select value={s.calculation_basis} onChange={e => setStep(s.key, { calculation_basis: e.target.value })} style={ctrl}>{CALC_OPTIONS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: TH.text, fontWeight: 700 }}><input type="checkbox" checked={s.qc_required} onChange={e => setStep(s.key, { qc_required: e.target.checked })} /> QC</label>
                  <div style={{ gridColumn: '1 / -1', minHeight: 26, display: 'flex', alignItems: 'center', border: `1px solid ${TH.border}`, borderRadius: 6, background: '#EFF6FF', color: TH.primary, fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 8px' }}>
                    {(() => {
                      const proc = processes.find((p) => String(p.id) === String(s.process_type_id));
                      const lines = calcPreview(s, items, machines).slice(0, 2).join(' · ');
                      return proc ? `${processLabel(proc)}${lines ? ` · ${lines}` : ''}` : 'Select process';
                    })()}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) 62px 68px 104px 26px 76px', gap: 6, alignItems: 'center', marginTop: 2 }}>
                  <div style={{ display: 'none' }}>Materials used (formula)</div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: TH.muted }}>Material</div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: TH.muted }}>Qty</div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: TH.muted }}>UOM</div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: TH.muted }}>Basis</div>
                  <div />
                  <div style={{ display: 'none' }}>Action</div>
                </div>

                {s.inputs.map((input, idx) => (
                  <div key={input.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) 62px 68px 104px 26px 76px', gap: 6, alignItems: 'center' }}>
                    <div style={{ display: 'none' }}>{idx === 0 ? 'MATERIAL' : ''}</div>
                    <ItemSearchSelect
                      items={items}
                      valueId={input.input_item_id}
                      valueLabel={optLabel(itemById.get(input.input_item_id))}
                      onPick={(it) => setInput(s.key, input.key, { input_item_id: it.id, uom_id: input.uom_id || it?.uom_id || '' })}
                    />
                    <input title="Quantity based on basis" placeholder="Qty" type="number" step="any" value={input.qty} onChange={e => setInput(s.key, input.key, { qty: e.target.value })} style={ctrl} />
                    <select value={input.uom_id || ''} onChange={e => setInput(s.key, input.key, { uom_id: e.target.value })} style={ctrl}><option value="">UOM</option>{uoms.map(u => <option key={u.id} value={u.id}>{u.uom_code}</option>)}</select>
                    <select value={input.qty_basis} onChange={e => setInput(s.key, input.key, { qty_basis: e.target.value })} style={ctrl}>{QTY_BASIS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
                    <button type="button" onClick={() => removeInput(s.key, input.key)} style={{ height: 32, border: 'none', background: 'transparent', color: TH.muted, cursor: 'pointer', fontSize: 18 }}>×</button>
                    {idx === 0 ? <button type="button" onClick={() => addInput(s.key)} style={{ height: 32, border: `1px solid ${TH.border}`, borderRadius: 6, background: '#fff', color: TH.primary, cursor: 'pointer', fontSize: 11, fontWeight: 800 }}>+ Material</button> : <div />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, background: TH.card, border: `1px solid ${TH.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: TH.text }}>Review / Preview</div>
            <div style={{ fontSize: 12, color: TH.muted }}>Preview only. No inventory posted. BOM is generated only when recipe is Activated.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: TH.text, display: 'flex', alignItems: 'center', gap: 8 }}>
              Output Qty
              <input type="number" value={previewQty} onChange={e => setPreviewQty(e.target.value)}
                style={{ height: 36, width: 120, border: `1px solid ${TH.border}`, borderRadius: 8, padding: '0 10px', fontSize: 13, color: TH.text, background: TH.card, boxSizing: 'border-box' }} />
            </label>
            <button type="button" onClick={runPreview} disabled={previewLoading}
              style={{ height: 36, padding: '0 14px', border: `1px solid ${TH.primary}`, borderRadius: 8, background: previewStale ? TH.primary : TH.card, color: previewStale ? '#fff' : TH.primary, fontWeight: 600, cursor: previewLoading ? 'default' : 'pointer', fontSize: 13, opacity: previewLoading ? 0.6 : 1 }}>
              {previewLoading ? 'Refreshing…' : (previewStale ? 'Refresh (changed)' : 'Refresh')}
            </button>
          </div>
        </div>

        {previewError && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 10 }}>{previewError}</div>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ background: TH.bg, border: `1px solid ${TH.border}`, borderRadius: 10, padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: TH.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Preview Output Qty</div>
            <div style={{ fontSize: 16, color: TH.text, fontWeight: 700 }}>{preview ? Number(preview.preview_qty).toLocaleString() : '—'}</div>
          </div>
          <div style={{ background: TH.bg, border: `1px solid ${TH.border}`, borderRadius: 10, padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: TH.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Total Runtime</div>
            <div style={{ fontSize: 16, color: TH.text, fontWeight: 700 }}>{preview ? previewMinutesLabel(preview.summary.total_runtime_minutes) : '—'}</div>
          </div>
          <div style={{ background: TH.bg, border: `1px solid ${TH.border}`, borderRadius: 10, padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: TH.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Missing Standards</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: preview && preview.summary.missing_runtime_count ? '#B45309' : TH.text }}>{preview ? preview.summary.missing_runtime_count : '—'}</div>
          </div>
        </div>

        {!preview && !previewLoading && <div style={{ fontSize: 13, color: TH.muted, padding: '12px 0' }}>Add what this stage produces and a basis quantity to see the preview.</div>}

        {preview && preview.rows.length > 0 && (
          <div style={{ overflowX: 'auto', border: `1px solid ${TH.border}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: TH.bg, color: TH.muted, textAlign: 'left' }}>
                  <th style={{ padding: '9px 12px', fontWeight: 700, width: 54 }}>Step</th>
                  <th style={{ padding: '9px 12px', fontWeight: 700 }}>Output</th>
                  <th style={{ padding: '9px 12px', fontWeight: 700, width: 150 }}>Basis / Preview Qty</th>
                  <th style={{ padding: '9px 12px', fontWeight: 700 }}>Materials Required</th>
                  <th style={{ padding: '9px 12px', fontWeight: 700, width: 130 }}>Runtime</th>
                  <th style={{ padding: '9px 12px', fontWeight: 700, width: 200 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`prow-${row.step_no}`} style={{ borderTop: `1px solid ${TH.border}`, color: TH.text, verticalAlign: 'top' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700 }}>{row.step_no}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 700 }}>{row.output_item_code || 'Not selected'}</div>
                      {row.output_item_name && <div style={{ fontSize: 11, color: TH.muted }}>{row.output_item_name}</div>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{Number(row.output_qty).toLocaleString()} {row.output_uom_code}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {row.inputs.length === 0 && <span style={{ color: TH.muted }}>—</span>}
                      {row.inputs.map((inp, idx) => (
                        <div key={`pin-${row.step_no}-${idx}`} style={{ padding: '2px 0' }}>
                          <span style={{ fontWeight: 600 }}>{inp.item_code || 'Input'}</span>:{' '}
                          {inp.issue
                            ? <span style={{ color: '#B45309' }}>{inp.issue}</span>
                            : <>{Number(inp.required_qty).toLocaleString(undefined, { maximumFractionDigits: 4 })} {inp.uom_code}
                                {inp.display_uom_code && inp.display_uom_code !== inp.uom_code &&
                                  <span style={{ color: TH.muted }}> · {Number(inp.display_qty).toLocaleString(undefined, { maximumFractionDigits: 4 })} {inp.display_uom_code}</span>}
                              </>}
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: '10px 12px', color: row.runtime.missing_standard ? TH.muted : TH.primary, fontWeight: 600 }}>
                      {row.runtime.missing_standard ? '—' : row.runtime.display_runtime}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {row.runtime.missing_standard
                        ? <span style={{ display: 'inline-block', background: '#FEF3C7', color: '#B45309', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Missing: {row.runtime.missing_reason}</span>
                        : <span style={{ display: 'inline-block', background: '#DCFCE7', color: '#15803D', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, zIndex: 20, marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(255,255,255,0.96)', border: `1px solid ${TH.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: '0 -8px 20px rgba(15,23,42,0.08)', backdropFilter: 'blur(8px)' }}>
        <button onClick={addStep} style={{ height: 38, padding: '0 14px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>+ Add Stage</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => router.push('/masters/stage-recipes')} style={{ height: 32, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 6, background: '#4F46E5', color: '#fff', fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.65 : 1 }}>{saving ? 'Saving…' : 'Save Recipe'}</button>
      </div>
    </div>
  );
}
