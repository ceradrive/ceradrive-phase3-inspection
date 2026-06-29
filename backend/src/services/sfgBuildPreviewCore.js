/**
 * CERADRIVE ERP — SFG Build Preview Core (P-SFG-2A-1, Path B abstract assembly)
 *
 * PURE module: NO database, NO supabase, NO engine import. Deterministic.
 * Given an authoring body + a resolved context (existing codes / RM codes / mix item),
 * it assembles the read-only generation preview:
 *   items (CREATE / USE_EXISTING) · recipe steps+inputs · projected BOM lines ·
 *   routing flow · FG-SFG links · MTS/MTO split · BLOCK list.
 *
 * Machine/time is added by the orchestrator using the shared engine
 * (recipeCalculationService.calculateStepRuntime) — NOT reinvented here.
 *
 * No write verbs exist in this file by construction.
 */

// ─── Abstract Path-B stage chain (structure only; NO numeric values) ─────────
// MIX and BP are SOURCES (USE_EXISTING), never generated as new per-SKU items.
// MIX is a shared family item; BP is a purchased RM item.
export const STAGE_PREFIX = {
  SBBP: 'SBBP', ACBP: 'ACBP', PF: 'PF', MLD: 'MLD', GRD: 'GRD',
  PWC: 'PWC', CUR: 'CUR', STK: 'STK', PRT: 'PRT', RIV: 'RIV', SHK: 'SHK',
};

// edge.inputs reference upstream stage_code(s) or the source tokens 'MIX' | 'BP'.
export const ABSTRACT_STAGE_EDGES = [
  { stage_code: 'PF',   stage_type: 'PF',   process_code: 'PREFORMING',       basis: 'PCS_CYCLE',    make_policy: 'MAKE_TO_STOCK', variant: false, optional: null,            inputs: [{ from: 'MIX', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'SBBP', stage_type: 'SBBP', process_code: 'SHOT_BLASTING',    basis: 'WEIGHT_BATCH', make_policy: 'MAKE_TO_STOCK', variant: true,  optional: null,            inputs: [{ from: 'BP',  qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'ACBP', stage_type: 'ACBP', process_code: 'ADHESIVE_COATING', basis: 'PCS_TRAY',     make_policy: 'MAKE_TO_STOCK', variant: true,  optional: null,            inputs: [{ from: 'SBBP', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'MLD',  stage_type: 'MLD',  process_code: 'MOULDING',         basis: 'DIE_CAVITY',   make_policy: 'MAKE_TO_STOCK', variant: true,  optional: null,            inputs: [{ from: 'PF', qty_basis: 'PER_OUTPUT' }, { from: 'ACBP', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'GRD',  stage_type: 'GRD',  process_code: 'GRINDING',         basis: 'PCS_PER_HOUR', make_policy: 'MAKE_TO_STOCK', variant: true,  optional: null,            inputs: [{ from: 'MLD', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'PWC',  stage_type: 'PWC',  process_code: 'POWDER_COATING',   basis: 'PCS_TRAY',     make_policy: 'MAKE_TO_STOCK', variant: true,  optional: 'has_powder_coat', inputs: [{ from: 'GRD', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'CUR',  stage_type: 'CUR',  process_code: 'CURING',           basis: 'TRAY_BATCH',   make_policy: 'MAKE_TO_STOCK', variant: true,  optional: null,            inputs: [{ from: 'PWC|GRD', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'STK',  stage_type: 'STK',  process_code: 'STACKING',         basis: 'PCS_CRATE',    make_policy: 'MAKE_TO_STOCK', variant: true,  optional: null,            inputs: [{ from: 'CUR', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'PRT',  stage_type: 'PRT',  process_code: 'PRINTING',         basis: 'MANUAL',       make_policy: 'MAKE_TO_ORDER', variant: true,  optional: 'has_printing',  inputs: [{ from: 'STK', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'RIV',  stage_type: 'RIV',  process_code: 'RIVETING',         basis: 'MANUAL',       make_policy: 'MAKE_TO_ORDER', variant: true,  optional: 'has_riveting',  inputs: [{ from: 'PRT|STK', qty_basis: 'PER_OUTPUT' }] },
  { stage_code: 'SHK',  stage_type: 'SHK',  process_code: 'SHRINK_WRAP',      basis: 'MANUAL',       make_policy: 'MAKE_TO_ORDER', variant: true,  optional: null,            inputs: [{ from: 'RIV|PRT|STK', qty_basis: 'PER_OUTPUT' }] },
  // SET combines variant STK (or last finishing stage) via qty_per_set.
  { stage_code: 'SET',  stage_type: 'SET',  process_code: 'PACKING',          basis: 'MANUAL',       make_policy: 'MAKE_TO_ORDER', variant: false, optional: null,            inputs: [{ from: 'SHK', qty_basis: 'PER_SET' }] },
];

const BP_SIDE_VARIANT_STAGES = new Set(['SBBP', 'ACBP', 'MLD', 'GRD', 'PWC', 'CUR', 'STK', 'PRT', 'RIV', 'SHK']);

// Process-wise item names (deterministic). SET uses the entered SKU name.
export const STAGE_NAME = {
  PF: 'Preforming', SBBP: 'Shot Blasted Back Plate', ACBP: 'Adhesive Coated BP',
  MLD: 'Moulded Pad', GRD: 'Ground Pad', PWC: 'Powder Coated Pad', CUR: 'Cured Pad',
  STK: 'Stacked Pad', PRT: 'Printed Pad', RIV: 'Riveted Pad', SHK: 'Shrink Wrapped Set',
};

// Template/config-driven active-stage policy (NOT hardcoded per build).
// `active` = always generated for that family. `optional` = generated only if its flag is set.
// VO standard => PWC is MANDATORY (in active). A future family can move PWC to `optional` or omit it.
// SFG-SEQ-BP-SEED-1: SHRINK_WRAP is mandatory after STK; printing/riveting remain optional.
// BOX/PACKING-as-optional is deferred until a table-driven MTO optional-process config exists.
const OPTIONAL_FLAG = { PWC: 'has_powder_coat', PRT: 'has_printing', RIV: 'has_riveting' };
export const STAGE_TEMPLATES = {
  VO: { active: ['PF', 'SBBP', 'ACBP', 'MLD', 'GRD', 'PWC', 'CUR', 'STK', 'SHK', 'SET'], optional: ['PRT', 'RIV'] },
  HP: { active: ['PF', 'SBBP', 'ACBP', 'MLD', 'GRD', 'PWC', 'CUR', 'STK', 'SHK', 'SET'], optional: ['PRT', 'RIV'] },
  HE: { active: ['PF', 'SBBP', 'ACBP', 'MLD', 'GRD', 'PWC', 'CUR', 'STK', 'SHK', 'SET'], optional: ['PRT', 'RIV'] },
  // fallback: PWC optional (toggle-driven) for any unconfigured family; shrink remains mandatory.
  DEFAULT: { active: ['PF', 'SBBP', 'ACBP', 'MLD', 'GRD', 'CUR', 'STK', 'SHK', 'SET'], optional: ['PWC', 'PRT', 'RIV'] },
};

export function templateFor(family) {
  return STAGE_TEMPLATES[up(family)] || STAGE_TEMPLATES.DEFAULT;
}

// ─── small pure helpers ──────────────────────────────────────────────────────
function up(v) { return String(v ?? '').trim().toUpperCase(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function pos(v) { const n = num(v); return n != null && n > 0 ? n : null; }
function deriveCore(skuCode) { return up(skuCode).replace(/^[A-Z]+/, ''); }

// Active stages for this build = template.active + template.optional whose flag is set.
export function activeStageEdges(body) {
  const tpl = templateFor(body.product_family);
  const act = new Set(tpl.active);
  const opt = new Set(tpl.optional);
  return ABSTRACT_STAGE_EDGES.filter((e) => {
    if (act.has(e.stage_code)) return true;
    if (opt.has(e.stage_code)) return Boolean(body[OPTIONAL_FLAG[e.stage_code]]);
    return false;
  });
}
function activeStages(body) { return activeStageEdges(body); }

// Resolve an edge input token to the actual upstream stage_code present in this build.
function resolveUpstream(token, presentSet) {
  for (const opt of String(token).split('|')) {
    if (opt === 'MIX' || opt === 'BP') return opt;
    if (presentSet.has(opt)) return opt;
  }
  return null;
}

function variantList(body) {
  const mode = up(body.bp_mode) || 'SAME';
  const rows = Array.isArray(body.bp_variants) ? body.bp_variants : [];
  if (mode === 'INNER_OUTER') {
    return rows
      .filter((r) => ['I', 'O'].includes(up(r.variant_code)))
      .map((r) => ({ code: up(r.variant_code), suffix: up(r.variant_code), bp_item_code: up(r.bp_item_code), qty: pos(r.qty_per_set), bp_weight_g: num(r.bp_weight_g) }));
  }
  const r = rows[0] || {};
  return [{ code: 'SAME', suffix: '', bp_item_code: up(r.bp_item_code), qty: pos(r.qty_per_set), bp_weight_g: num(r.bp_weight_g) }];
}

function stageItemCode(family, stageCode, core, suffix) {
  if (stageCode === 'SET') return null; // SET = sku_code itself (no family prefix)
  const fam = up(family);
  const famPrefix = fam ? `${fam}_` : ''; // family/formulation identity on manufactured WIP
  return `${famPrefix}${STAGE_PREFIX[stageCode]}${core}${suffix}`;
}

// ─── main pure assembly ──────────────────────────────────────────────────────
// ctx = {
//   existingItemCodes: Set<UPPER>,   // probed in item_master
//   rmPurchasableCodes: Set<UPPER>,  // codes that are purchasable RM (BP validity)
//   mixItem: { item_code } | null,   // resolved shared MIX item
// }
export function assemblePreview(body = {}, ctx = {}) {
  const existing = ctx.existingItemCodes instanceof Set ? ctx.existingItemCodes : new Set();
  const existingStage = ctx.existingItemStage instanceof Map ? ctx.existingItemStage : new Map();
  const rmCodes = ctx.rmPurchasableCodes instanceof Set ? ctx.rmPurchasableCodes : new Set();
  const mixItem = ctx.mixItem || null;

  const skuCode = up(body.sku_code);
  const core = deriveCore(skuCode);
  const fam = up(body.product_family);
  // family/formulation-wise code + name (any future family, not only VO/HP/HE)
  const mkCode = (stage, suffix) => stageItemCode(fam, stage, core, suffix);
  const mkName = (stage, vlabel) => `${skuCode}${fam ? ' ' + fam : ''} ${STAGE_NAME[stage] || stage}${vlabel ? ' ' + vlabel : ''}`;
  const blocks = [];
  const block = (field, stage, reason) => blocks.push({ field, stage, reason });
  const warnings = [];

  // ── identity blocks ──
  if (!skuCode) block('sku_code', 'IDENTITY', 'SKU code is required.');
  if (!core) block('sku_code', 'IDENTITY', 'SKU code must contain a numeric/model suffix, e.g. VO101S.');
  if (!String(body.sku_name || '').trim()) block('sku_name', 'IDENTITY', 'SKU name is required.');
  if (!up(body.product_family)) block('product_family', 'IDENTITY', 'Product family is required.');
  const pcsPerSet = pos(body.pcs_per_set);
  if (!pcsPerSet) block('pcs_per_set', 'SET', 'Pcs per set must be greater than 0.');

  // ── compound / MIX blocks ──
  const compoundG = pos(body.compound_weight_g);
  if (!compoundG) block('compound_weight_g', 'PF', 'Compound weight (g) must be greater than 0.');
  else if (compoundG < 10 || compoundG > 2000) warnings.push(`compound_weight_g=${compoundG} looks unusual (expected ~10–2000 g) — check grams vs KG.`);
  if (!mixItem) block('mix_formula_code', 'MIX', 'Shared MIX item not found / inactive for this family.');

  // ── BP variant blocks ──
  const mode = up(body.bp_mode) || 'SAME';
  const variants = variantList(body);
  if (mode === 'SAME' && variants.length !== 1) block('bp_variants', 'BP', 'SAME mode requires exactly one BP row.');
  if (mode === 'INNER_OUTER') {
    const codes = new Set(variants.map((v) => v.code));
    if (!(codes.has('I') && codes.has('O') && variants.length === 2)) block('bp_variants', 'BP', 'INNER_OUTER requires exactly one I and one O row.');
  }
  for (const v of variants) {
    if (!v.bp_item_code) block('bp_item_code', `BP/${v.code}`, 'Back plate item code is required.');
    else if (!rmCodes.has(v.bp_item_code)) block('bp_item_code', `BP/${v.code}`, `BP "${v.bp_item_code}" is not an existing purchasable RM item.`);
    if (!v.qty) block('qty_per_set', `BP/${v.code}`, 'BP qty per set must be greater than 0.');
  }
  const sumQty = variants.reduce((s, v) => s + (v.qty || 0), 0);
  if (pcsPerSet && sumQty !== pcsPerSet) block('qty_per_set', 'BP', `Sum of BP qty_per_set (${sumQty}) must equal pcs_per_set (${pcsPerSet}).`);

  // ── machine / stage-standard blocks (only for ACTIVE stages) ──
  const stages = activeStages(body);
  const present = new Set(stages.map((s) => s.stage_code));
  const hasStage = (c) => present.has(c);

  // SFG-P2D-NO-MACHINE-IN-SFG: SFG Builder no longer asks for or requires machines.
  if (hasStage('MLD')) {
    if (!pos(body.die_cavities)) block('die_cavities', 'MLD', 'Die cavities must be greater than 0.');
    if (!up(body.die_code)) block('die_code', 'MLD', 'Die code is required.');
    // SFG-P2C-BACKEND-GATE: moulding_cycle_time_sec owned by Moulding Slot/Machine Master, not SFG — not required here.
  }
  if (hasStage('ACBP') && !pos(body.acbp_pcs_per_tray)) block('acbp_pcs_per_tray', 'ACBP', 'Adhesive coating pcs/tray is required.');
  if (hasStage('PWC') && !pos(body.pwc_pcs_per_tray)) block('pwc_pcs_per_tray', 'PWC', 'Powder coating pcs/tray is required.');
  if (hasStage('CUR')) {
    if (!pos(body.cur_pcs_per_tray)) block('cur_pcs_per_tray', 'CUR', 'Curing oven pcs/tray is required.');
    // SFG-P2C-BACKEND-GATE: cur_trays_per_batch + cur_cycle_time_min owned by Machine Master, not SFG — not required here.
  }
  // SFG-P2C-BACKEND-GATE: grinding_pcs_per_hour owned by Machine Master, not SFG — not required here.
  if (hasStage('STK')) {
    // SFG-P2C-BACKEND-GATE: stacking_pcs_per_hour owned by Machine Master, not SFG — not required here.
    if (!pos(body.pcs_per_crate)) block('pcs_per_crate', 'STK', 'Crate capacity (pcs/crate) is required.');
  }

  // ── ITEMS preview ──
  const items = [];
  const seenCodes = new Set();
  const action = (code, expectedType) => {
    const c = up(code);
    if (!existing.has(c) && !existingStage.has(c)) return 'CREATE';
    const exType = existingStage.get(c);
    if (exType == null || up(exType) === up(expectedType)) return 'USE_EXISTING';
    block('item_code', expectedType, `Code ${c} already exists as stage_type ${exType}, expected ${expectedType} — naming collision.`);
    return 'BLOCK';
  };
  const pushItem = (it) => {
    const key = up(it.item_code);
    if (seenCodes.has(key)) return;
    seenCodes.add(key);
    items.push(it);
  };

  // sources (USE_EXISTING)
  if (mixItem) pushItem({ item_code: mixItem.item_code, item_name: `${mixItem.item_code} (shared MIX)`, stage_code: 'MIX', stage_type: 'MIX', variant_code: null, action: 'USE_EXISTING', make_policy: 'MAKE_TO_STOCK', source: 'SHARED_FAMILY' });
  for (const v of variants) if (v.bp_item_code) pushItem({ item_code: v.bp_item_code, item_name: `${v.bp_item_code} (purchased BP)`, stage_code: 'BP', stage_type: 'BP', variant_code: v.code === 'SAME' ? null : v.code, action: 'USE_EXISTING', make_policy: null, source: 'RM' });

  // PF (shared per family, no variant)
  if (hasStage('PF')) {
    const code = mkCode('PF', '');
    pushItem({ item_code: code, item_name: mkName('PF', ''), stage_code: 'PF', stage_type: 'PF', process_code: 'PREFORMING', variant_code: null, action: action(code, 'PF'), make_policy: 'MAKE_TO_STOCK', source: 'GENERATED', product_family: fam, parent_sku: skuCode });
  }
  // BP-side variant stages
  for (const v of variants) {
    for (const e of stages) {
      if (e.stage_code === 'PF' || e.stage_code === 'SET') continue;
      if (!BP_SIDE_VARIANT_STAGES.has(e.stage_code)) continue;
      const code = mkCode(e.stage_code, v.suffix);
      pushItem({ item_code: code, item_name: mkName(e.stage_code, v.code === 'SAME' ? '' : v.code), stage_code: e.stage_code, stage_type: e.stage_type, process_code: e.process_code, variant_code: v.code === 'SAME' ? null : v.code, action: action(code, e.stage_type), make_policy: e.make_policy, source: 'GENERATED', product_family: fam, parent_sku: skuCode });
    }
  }
  // SET = sku_code (entered), no family prefix
  pushItem({ item_code: skuCode, item_name: String(body.sku_name || skuCode), stage_code: 'SET', stage_type: 'SET', process_code: 'PACKING', variant_code: null, action: action(skuCode, 'SET'), make_policy: 'MAKE_TO_ORDER', source: 'FG', product_family: fam, parent_sku: skuCode });

  // ── RECIPE steps + inputs ──
  const recipeCode = skuCode ? `SR-${skuCode}` : null;
  const steps = [];
  let stepNo = 0;
  const addStep = (outCode, edge, inputs) => { steps.push({ step_no: ++stepNo, output_item_code: outCode, stage_code: edge.stage_code, process_code: edge.process_code, calculation_basis: edge.basis, make_policy: edge.make_policy, inputs }); };

  // PF step first
  if (hasStage('PF')) {
    const pfQtyKg = compoundG != null ? Number((compoundG / 1000).toFixed(6)) : null; // grams -> KG
    addStep(mkCode('PF', ''), ABSTRACT_STAGE_EDGES.find((e) => e.stage_code === 'PF'),
      [{ input_item_code: mixItem ? mixItem.item_code : '(MIX?)', qty: pfQtyKg, uom: 'KG', qty_basis: 'PER_OUTPUT' }]);
  }
  // per-variant BP-side chain
  for (const v of variants) {
    for (const e of stages) {
      if (e.stage_code === 'PF' || e.stage_code === 'SET') continue;
      if (!BP_SIDE_VARIANT_STAGES.has(e.stage_code)) continue;
      const outCode = mkCode(e.stage_code, v.suffix);
      const inputs = e.inputs.map((inp) => {
        const u = resolveUpstream(inp.from, present);
        let inCode;
        if (u === 'BP') inCode = v.bp_item_code || '(BP?)';      // common purchased RM, no family prefix
        else if (u === 'MIX') inCode = mixItem ? mixItem.item_code : '(MIX?)'; // family-wise shared MIX
        else if (u === 'PF') inCode = mkCode('PF', '');          // shared PF (family-prefixed), no variant suffix
        else inCode = mkCode(u, v.suffix);
        return { input_item_code: inCode, qty: 1, uom: 'PCS', qty_basis: inp.qty_basis };
      });
      addStep(outCode, e, inputs);
    }
  }
  // SET step (combine variant STK via qty_per_set)
  if (pcsPerSet) {
    const setEdge = ABSTRACT_STAGE_EDGES.find((e) => e.stage_code === 'SET');
    const lastBpStage = 'SHK'; // SFG-SEQ-BP-SEED-1: shrink is mandatory before final SET.
    const setInputs = variants.map((v) => ({ input_item_code: mkCode(lastBpStage, v.suffix), qty: v.qty, uom: 'PCS', qty_basis: 'PER_SET' }));
    addStep(skuCode, setEdge, setInputs);
  }

  // ── projected BOMs (one per produced step output; lines = step inputs) ──
  const boms = steps.map((s) => ({ output_item_code: s.output_item_code, lines: s.inputs.map((i) => ({ component_item_code: i.input_item_code, qty: i.qty, uom: i.uom, qty_basis: i.qty_basis })) }));

  // ── routing flow (active stage order) ──
  const routing_flow = [{ stage_code: 'MIX', process_code: 'MIXING' }, { stage_code: 'BP', process_code: 'PURCHASE' }]
    .concat(stages.map((e) => ({ stage_code: e.stage_code, process_code: e.process_code })))
    .map((r, i) => ({ seq: i + 1, ...r }));

  // parallel-branch routing display (BP is NOT downstream of MIX)
  const actSet = new Set(stages.map((e) => e.stage_code));
  const routing_branches = {
    mix_branch: ['MIX', ...(actSet.has('PF') ? ['PF'] : [])],                 // MIX -> PF
    bp_branch: ['BP', ...['SBBP', 'ACBP'].filter((s) => actSet.has(s))],      // BP -> SBBP -> ACBP
    merge_from: ['PF', 'ACBP'],                                               // PF + ACBP feed MLD
    merge: ['MLD', 'GRD', 'PWC', 'CUR', 'STK', 'PRT', 'RIV', 'SHK', 'SET'].filter((s) => actSet.has(s) || s === 'SET'),
  };

  // ── FG-SFG links ──
  const links = [];
  for (const it of items) {
    if (it.source !== 'GENERATED') continue;
    const isStk = it.stage_code === 'STK';
    const v = variants.find((x) => (x.code === 'SAME' ? null : x.code) === it.variant_code);
    links.push({ fg_item_code: skuCode, sfg_item_code: it.item_code, stage_code: it.stage_code, variant_code: it.variant_code, qty_per_set: isStk && v ? v.qty : null });
  }

  // ── MTS / MTO split (boundary at STK) ──
  const policy_split = {
    mts: items.filter((i) => i.make_policy === 'MAKE_TO_STOCK').map((i) => i.item_code),
    mto: items.filter((i) => i.make_policy === 'MAKE_TO_ORDER').map((i) => i.item_code),
    boundary: 'STK',
  };

  const summary = {
    create: items.filter((i) => i.action === 'CREATE').length,
    use_existing: items.filter((i) => i.action === 'USE_EXISTING').length,
    block: blocks.length,
  };

  return {
    sku_code: skuCode,
    parent_sku: skuCode,
    product_family: fam,
    formulation_code: mixItem ? mixItem.item_code : null,
    can_generate: blocks.length === 0,
    summary,
    items,
    recipe: { recipe_code: recipeCode, steps },
    boms,
    routing_flow,
    routing_branches,
    links,
    policy_split,
    blocks,
    warnings,
    // machine_time is appended by the orchestrator via the shared engine.
    machine_time: [],
  };
}
