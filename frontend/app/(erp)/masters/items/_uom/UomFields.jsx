'use client';

// UomFields.jsx (V1, stage-gated) — the Alternate UOM row appears ONLY for a SET item
// (stage_type === 'SET'). BP/RM/SFG/MIX (even when PCS) show Base UOM only.
// SET item: Base PCS + Alternate SET + "1 SET = X PCS" (pcs_per_set, auto inverse).
// Alternate saves to sales_uom_id only; purchase_uom_id is never touched. Clear resets in place.
// Per-page LookupPicker + style helpers arrive via `ui` so this stays decoupled.

import { uomCodeOf, isSetPair, isSetStage } from './uomLogic.js';

export default function UomFields({ uoms, value, onChange, errors = {}, editing = true, stageType, ui }) {
  const { LookupPicker, ctrl, lbl, hintStyle, fieldWrap, errStyle, roBox, uomLabel, onAddUom } = ui;
  const { baseUomId, altUomId, convFactor } = value;
  const set = (patch) => onChange({ ...value, ...patch });
  const setStage = isSetStage(stageType);
  const setPair = isSetPair(uoms, baseUomId, altUomId);
  const setOptions = (uoms || []).filter((u) => String(u.uom_code ?? u.code ?? '').toUpperCase() === 'SET');
  const labelOf = (id) => { const u = (uoms || []).find((x) => x.id === id); return u ? uomLabel(u) : '—'; };
  const ro = (t) => <div style={roBox}>{t}</div>;
  const inv = Number(convFactor) > 0 ? parseFloat((1 / Number(convFactor)).toFixed(6)) : null;

  // Eligibility is stage-driven. Alternate is shown only for a SET item (editing),
  // or in read-only when an alternate value exists.
  const showAltRow = editing ? setStage : !!altUomId;

  return (
    <>
      <div style={fieldWrap}>
        <label style={lbl}>Base UOM *</label>
        {editing
          ? <LookupPicker options={uoms} value={baseUomId} onChange={(id) => set({ baseUomId: id })}
              getLabel={uomLabel} placeholder="Search UOM…" error={errors.uom_id}
              addLabel="Add UOM" onAdd={onAddUom} />
          : ro(labelOf(baseUomId))}
        {errors.uom_id ? <span style={errStyle}>{errors.uom_id}</span> : null}
        <span style={hintStyle}>{setStage
          ? 'SET item: Base UOM must be PCS (Alternate is SET).'
          : 'Primary unit for stock & production. Example: PCS (brake pad) or KG (powder).'}</span>
      </div>

      {showAltRow ? (
        <div style={fieldWrap}>
          <label style={lbl}>Alternate UOM</label>
          {editing
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <LookupPicker options={setOptions} value={altUomId}
                    onChange={(id) => set({ altUomId: id, convFactor: '' })}
                    getLabel={uomLabel} placeholder="Select SET…" />
                </div>
                {altUomId
                  ? <button type="button" onClick={() => set({ altUomId: '', convFactor: '' })}
                      title="Remove Alternate UOM"
                      style={{ border: '1px solid #FCA5A5', borderRadius: 6, background: '#fff', color: '#DC2626', height: 38, padding: '0 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Clear</button>
                  : null}
              </div>
            : ro(labelOf(altUomId))}
          <span style={hintStyle}>SET items only: Alternate must be SET. Stock &amp; production stay in Base UOM.</span>
        </div>
      ) : null}

      {editing && setStage && setPair ? (
        <div style={fieldWrap}>
          <label style={lbl}>Conversion *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>1 SET =</span>
            <input type="number" step="any" min="0" value={convFactor}
              onChange={(e) => set({ convFactor: e.target.value })}
              placeholder="e.g. 4" style={{ ...ctrl(!!errors.conv_factor), width: 130 }} />
            <span style={{ fontWeight: 600 }}>PCS</span>
          </div>
          {errors.conv_factor ? <span style={errStyle}>{errors.conv_factor}</span> : null}
          <span style={hintStyle}>{inv != null ? `1 PCS = ${inv} SET (auto)` : 'Enter how many PCS make 1 SET.'} Stored as pieces-per-SET.</span>
        </div>
      ) : (!editing && altUomId ? (
        <div style={fieldWrap}>
          <label style={lbl}>Conversion</label>
          {ro(`1 SET = ${convFactor || '—'} PCS`)}
        </div>
      ) : null)}
    </>
  );
}
