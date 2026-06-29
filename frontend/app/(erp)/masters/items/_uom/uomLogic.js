// uomLogic.js (V1, stage-gated) — Final SET item is decided by stage_type === 'SET' ONLY,
// never by Base UOM (BP/RM/SFG/MIX are also PCS, so a PCS check would wrongly qualify them).
//
//  - SET item: Base UOM = PCS, Alternate UOM = SET, pcs_per_set > 0; Alternate -> sales_uom_id only.
//  - Any other stage: Base UOM only — no Alternate, no sales_uom_id, no SET conversion written.
//  - purchase_uom_id is NEVER emitted (never modified).
//  - Manufacturing pcs_per_set is left to its owners: omitted for non-SET so update preserves it.

const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export const uomCodeOf = (uoms, id) => {
  const u = (uoms || []).find((x) => x.id === id);
  return u ? String(u.uom_code ?? u.code ?? '').toUpperCase() : '';
};

export const isSetStage = (stageType) => String(stageType ?? '').toUpperCase() === 'SET';

// The only supported conversion: Base PCS + Alternate SET.
export const isSetPair = (uoms, baseUomId, altUomId) =>
  uomCodeOf(uoms, baseUomId) === 'PCS' && uomCodeOf(uoms, altUomId) === 'SET';

// Initial UOM state from a loaded item. Alternate/conversion are surfaced ONLY for a SET item;
// for any other stage the item is Base-UOM-only (a stale sales_uom_id is not shown).
export function deriveUomState(item) {
  const setStage = isSetStage(item.stage_type);
  return {
    baseUomId: item.uom_id ?? '',
    altUomId: setStage ? (item.sales_uom_id || '') : '',
    convFactor: setStage && item.pcs_per_set != null ? String(item.pcs_per_set) : '',
    legacyPcsPerSet: item.pcs_per_set ?? null,
  };
}

export function validateUom({ uoms, baseUomId, altUomId, convFactor, stageType }) {
  const e = {};
  if (!baseUomId) { e.uom_id = 'Base UOM is required.'; return e; }
  if (isSetStage(stageType)) {
    // Final SET item: Base must be PCS, Alternate must be SET, pcs_per_set > 0.
    if (!isSetPair(uoms, baseUomId, altUomId)) {
      e.uom_id = 'SET item needs Base UOM = PCS and Alternate UOM = SET.';
    } else if (!(Number(convFactor) > 0)) {
      e.conv_factor = 'Enter how many PCS are in 1 SET (greater than 0).';
    }
  } else if (altUomId) {
    // Non-SET stage cannot carry an Alternate UOM.
    e.uom_id = 'Alternate UOM is only for SET items (stage type = SET).';
  }
  return e;
}

// SET item -> { uom_id, sales_uom_id, pcs_per_set }. Any other stage -> { uom_id, sales_uom_id: null, pcs_per_set: null }
// so that a SET->non-SET change CLEARS the stale sales_uom_id and pcs_per_set in the DB.
// purchase_uom_id is never emitted (so update preserves it; it is never modified).
export function buildUomPayload({ uoms, baseUomId, altUomId, convFactor, stageType }) {
  if (isSetStage(stageType) && isSetPair(uoms, baseUomId, altUomId)) {
    return { uom_id: baseUomId || null, sales_uom_id: altUomId, pcs_per_set: n(convFactor) };
  }
  return { uom_id: baseUomId || null, sales_uom_id: null, pcs_per_set: null };
}

export default { uomCodeOf, isSetStage, isSetPair, deriveUomState, validateUom, buildUomPayload };
