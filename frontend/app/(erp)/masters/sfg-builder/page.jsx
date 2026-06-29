'use client';

/**
 * CERADRIVE ERP — SFG Builder Wizard (P-SFG-2A-1b / SFG-P2C-UI-OWNERSHIP)
 * PREVIEW-ONLY. Calls POST /api/v1/sfg-builder/build-preview (read-only).
 * No create/generate/write call. The previous name-builder generate flow is gone.
 * SFG-UI-COMPACT-1: compact working UI, collapsed details, clean generate result.
 */

import { useState } from 'react';
import { api } from '../../../../lib/api.js';
import { useToast } from '../../../../components/ui/Toast.jsx';

const C = {
  primary: '#004AC6', primarySoft: '#EEF4FF', bg: '#F8FAFC', card: '#FFFFFF',
  border: '#E2E8F0', text: '#0F172A', muted: '#64748B',
  danger: '#B91C1C', dangerSoft: '#FEF2F2', success: '#166534', successSoft: '#DCFCE7',
  warn: '#92400E', warnSoft: '#FEF3C7',
};

function num(v) { return v === '' || v === null || v === undefined ? undefined : Number(v); }

// Families whose standard template marks Powder Coating (PWC) as a mandatory active stage.
// Mirrors backend STAGE_TEMPLATES; PWC is NOT a user toggle for these families.
const PWC_FAMILIES = ['VO', 'HP', 'HE'];

function Field({ label, unit, children }) {
  return (
    <label style={S.field}>
      <span style={S.label}>{label}{unit ? <em style={S.unit}> ({unit})</em> : null}</span>
      {children}
    </label>
  );
}

export default function SfgBuilderPage() {
  const toast = useToast();

  const [f, setF] = useState({
    sku_code: '', sku_name: '', product_family: 'VO',
    pcs_per_set: '', compound_weight_g: '', mix_formula_code: '',
    bp_mode: 'SAME',
    bp_same_item: '', bp_same_qty: '', bp_same_wt: '',
    bp_i_item: '', bp_i_qty: '', bp_i_wt: '',
    bp_o_item: '', bp_o_qty: '', bp_o_wt: '',
    die_code: '', die_cavities: '',
    pcs_per_tray_legacy_removed: undefined,
    acbp_pcs_per_tray: '',
    pwc_pcs_per_tray: '',
    cur_pcs_per_tray: '',
    pcs_per_crate: '',
    has_printing: false, has_riveting: false, has_shrink: false,
    preview_qty: 1000,
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loading, setLoading] = useState(false);
  // SFG-GENERATE-ENV-FLAG-1: frontend Generate is controlled by env, not hardcoded.
  // Enable only for testing together with backend SFG_FULL_GENERATE_ENABLED=true.
  // When false/missing, the button stays disabled and no write can happen.
  const FULL_GENERATE_ENABLED = process.env.NEXT_PUBLIC_SFG_FULL_GENERATE_ENABLED === 'true';
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);


  function buildBody() {
    const bp_variants = f.bp_mode === 'INNER_OUTER'
      ? [
          { variant_code: 'I', bp_item_code: f.bp_i_item, qty_per_set: num(f.bp_i_qty), bp_weight_g: num(f.bp_i_wt) },
          { variant_code: 'O', bp_item_code: f.bp_o_item, qty_per_set: num(f.bp_o_qty), bp_weight_g: num(f.bp_o_wt) },
        ]
      : [{ variant_code: 'SAME', bp_item_code: f.bp_same_item, qty_per_set: num(f.bp_same_qty), bp_weight_g: num(f.bp_same_wt) }];

    return {
      sku_code: f.sku_code, sku_name: f.sku_name, product_family: f.product_family,
      pcs_per_set: num(f.pcs_per_set), compound_weight_g: num(f.compound_weight_g),
      mix_formula_code: f.mix_formula_code,
      bp_mode: f.bp_mode, bp_variants,
      die_code: f.die_code, die_cavities: num(f.die_cavities),
      acbp_pcs_per_tray: num(f.acbp_pcs_per_tray),
      pwc_pcs_per_tray: num(f.pwc_pcs_per_tray),
      cur_pcs_per_tray: num(f.cur_pcs_per_tray),
      pcs_per_crate: num(f.pcs_per_crate),
      has_powder_coat: PWC_FAMILIES.includes(f.product_family), has_printing: f.has_printing,
      has_riveting: f.has_riveting, has_shrink: f.has_shrink,
      preview_qty: num(f.preview_qty) || 1000,
    };
  }

  async function runPreview() {
    if (!f.sku_code.trim()) { toast('Enter SKU code first.'); return; }
    setLoading(true); setPreviewError(null);
    const { data, error } = await api.post('/api/v1/sfg-builder/build-preview', buildBody());
    setLoading(false);
    if (error) {
      setPreview(null);
      setPreviewError(error.message || 'Preview failed.');
      toast(error.message || 'Preview failed.');
      return;
    }
    setPreview(data);
    if (data && data.can_generate === false) toast(`Preview has ${data.summary?.block ?? 0} blocking issue(s).`);
  }

  async function handleGenerate() {
    if (!FULL_GENERATE_ENABLED) return; // wired but disabled until the flag is flipped (backend also 503s)
    if (!preview || preview.can_generate === false) { toast('Run a clean preview (no blocks) first.'); return; }
    setGenerating(true); setGenerateResult(null);
    const { data, error } = await api.post('/api/v1/sfg-builder/build-generate', buildBody());
    setGenerating(false);
    if (error) { setGenerateResult({ ok: false, error }); toast(error.message || 'Generate failed.'); return; }
    setGenerateResult({ ok: true, data });
    toast(data?.committed ? 'Generate complete.' : `Stopped at ${data?.stopped_at}: ${data?.reason || 'blocked'}`);
  }

  const showI = f.bp_mode === 'INNER_OUTER';
  const pwcActive = PWC_FAMILIES.includes(f.product_family);

  return (
    <div style={S.page}>
      <div style={S.hero}>
        <div style={S.kicker}>Manufacturing Setup · Preview Only</div>
        <h1 style={S.title}>SFG Builder Wizard</h1>
        <p style={S.sub}>Enter SKU, BP, MIX and SKU standards. Generate stage items, recipes, BOM, routing and links.</p>
      </div>

      <div style={S.formWrap}>
      {/* IDENTITY */}
      <section style={S.card}>
        <h2 style={S.head}>1 · SKU identity</h2>
        <div style={S.grid}>
          <Field label="SKU code"><input style={S.input} value={f.sku_code} onChange={(e) => set('sku_code', e.target.value)} placeholder="VO101S" /></Field>
          <Field label="SKU name"><input style={S.input} value={f.sku_name} onChange={(e) => set('sku_name', e.target.value)} placeholder="VO Front Brake Pad Set" /></Field>
          <Field label="Product family">
            <select style={S.input} value={f.product_family} onChange={(e) => set('product_family', e.target.value)}>
              <option>VO</option><option>HP</option><option>HE</option>
            </select>
          </Field>
          <Field label="Pcs per set"><input style={S.input} type="number" value={f.pcs_per_set} onChange={(e) => set('pcs_per_set', e.target.value)} /></Field>
        </div>
      </section>

      {/* COMPOUND / MIX */}
      <section style={S.card}>
        <h2 style={S.head}>2 · Compound & MIX</h2>
        <div style={S.grid}>
          <Field label="Compound weight" unit="g"><input style={S.input} type="number" value={f.compound_weight_g} onChange={(e) => set('compound_weight_g', e.target.value)} placeholder="95" /></Field>
          <Field label="Shared MIX item code"><input style={S.input} value={f.mix_formula_code} onChange={(e) => set('mix_formula_code', e.target.value)} placeholder="MIX-VO" /></Field>
        </div>
        <div style={S.hint}>PF←MIX consumption is auto-derived: compound_weight_g ÷ 1000 = KG per piece.</div>
      </section>

      {/* BACK PLATE */}
      <section style={S.card}>
        <h2 style={S.head}>3 · Back plate</h2>
        <div style={S.segment}>
          <button type="button" onClick={() => set('bp_mode', 'SAME')} style={f.bp_mode === 'SAME' ? S.segActive : S.segBtn}>SAME (4)</button>
          <button type="button" onClick={() => set('bp_mode', 'INNER_OUTER')} style={showI ? S.segActive : S.segBtn}>Inner / Outer</button>
        </div>
        {!showI && (
          <div style={S.grid}>
            <Field label="BP item (RM)"><input style={S.input} value={f.bp_same_item} onChange={(e) => set('bp_same_item', e.target.value)} placeholder="BP-RAW-77" /></Field>
            <Field label="Qty per set"><input style={S.input} type="number" value={f.bp_same_qty} onChange={(e) => set('bp_same_qty', e.target.value)} placeholder="4" /></Field>
            <Field label="BP weight" unit="g"><input style={S.input} type="number" value={f.bp_same_wt} onChange={(e) => set('bp_same_wt', e.target.value)} /></Field>
          </div>
        )}
        {showI && (
          <>
            <div style={S.subhead}>Inner</div>
            <div style={S.grid}>
              <Field label="Inner BP item (RM)"><input style={S.input} value={f.bp_i_item} onChange={(e) => set('bp_i_item', e.target.value)} placeholder="BP-IN-88" /></Field>
              <Field label="Qty per set"><input style={S.input} type="number" value={f.bp_i_qty} onChange={(e) => set('bp_i_qty', e.target.value)} placeholder="2" /></Field>
              <Field label="BP weight" unit="g"><input style={S.input} type="number" value={f.bp_i_wt} onChange={(e) => set('bp_i_wt', e.target.value)} /></Field>
            </div>
            <div style={S.subhead}>Outer</div>
            <div style={S.grid}>
              <Field label="Outer BP item (RM)"><input style={S.input} value={f.bp_o_item} onChange={(e) => set('bp_o_item', e.target.value)} placeholder="BP-OUT-89" /></Field>
              <Field label="Qty per set"><input style={S.input} type="number" value={f.bp_o_qty} onChange={(e) => set('bp_o_qty', e.target.value)} placeholder="2" /></Field>
              <Field label="BP weight" unit="g"><input style={S.input} type="number" value={f.bp_o_wt} onChange={(e) => set('bp_o_wt', e.target.value)} /></Field>
            </div>
          </>
        )}
        <div style={S.hint}>Σ qty per set must equal pcs per set. BP must be an existing purchasable RM item.</div>
      </section>

      {/* MOULDING */}
      <section style={S.card}>
        <h2 style={S.head}>4 · Moulding SKU references</h2>
        <div style={S.grid}>
          <Field label="Die code"><input style={S.input} value={f.die_code} onChange={(e) => set('die_code', e.target.value)} placeholder="D-101" /></Field>
          <Field label="Die cavities"><input style={S.input} type="number" value={f.die_cavities} onChange={(e) => set('die_cavities', e.target.value)} placeholder="8" /></Field>
        </div>
        <div style={S.hint}>Machine selection and machine cycle/setup/heating are owned by Recipe Builder / Routing / Work Order and Machine Master. SFG stores only SKU fit references.</div>
      </section>

      {/* DOWNSTREAM */}
      <section style={S.card}>
        <h2 style={S.head}>5 · Downstream SKU standards</h2>
        <div style={S.grid}>
          <Field label="Adhesive coating pcs/tray"><input style={S.input} type="number" value={f.acbp_pcs_per_tray} onChange={(e) => set('acbp_pcs_per_tray', e.target.value)} placeholder="40" /></Field>
          {pwcActive && (
            <Field label="Powder coating pcs/tray"><input style={S.input} type="number" value={f.pwc_pcs_per_tray} onChange={(e) => set('pwc_pcs_per_tray', e.target.value)} placeholder="36" /></Field>
          )}
          <Field label="Curing oven pcs/tray"><input style={S.input} type="number" value={f.cur_pcs_per_tray} onChange={(e) => set('cur_pcs_per_tray', e.target.value)} placeholder="40" /></Field>
          <Field label="Crate capacity" unit="pcs/crate"><input style={S.input} type="number" value={f.pcs_per_crate} onChange={(e) => set('pcs_per_crate', e.target.value)} placeholder="200" /></Field>
          <Field label="Preview qty" unit="pcs"><input style={S.input} type="number" value={f.preview_qty} onChange={(e) => set('preview_qty', e.target.value)} /></Field>
        </div>
        <div style={S.hint}>Cycle times, batch capacity, pcs/hour, tray capacity and oven cycle values are maintained in Machine Master / Moulding Slot. SFG seeds only SKU fit standards.</div>
      </section>

      {/* OPTIONAL */}
      <section style={S.card}>
        <h2 style={S.head}>6 · Optional finishing (MTO)</h2>
        <div style={S.hint}>Powder Coating is set by the family template (active for {f.product_family}), not a toggle.</div>
        <div style={S.toggleRow}>
          {[['has_printing', 'Printing (PRT)'], ['has_riveting', 'Riveting (RIV)'], ['has_shrink', 'Shrink Wrap (SHK)']].map(([k, lbl]) => (
            <label key={k} style={f[k] ? S.toggleOn : S.toggleOff}>
              <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {lbl}
            </label>
          ))}
        </div>
      </section>
      </div>

      {/* ACTIONS */}
      <div style={S.actions}>
        <button type="button" onClick={runPreview} disabled={loading} style={S.primaryBtn}>{loading ? 'Previewing…' : 'Preview'}</button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!FULL_GENERATE_ENABLED || generating || !preview || preview?.can_generate === false}
          title={FULL_GENERATE_ENABLED ? 'Generate items, recipe, BOM, routing and links' : 'Generate is disabled (sfg_full_generate_enabled=false)'}
          style={(!FULL_GENERATE_ENABLED || !preview || preview?.can_generate === false) ? S.disabledBtn : S.primaryBtn}
        >
          {generating ? 'Generating…' : FULL_GENERATE_ENABLED ? 'Generate' : 'Generate (disabled)'}
        </button>
        {generateResult && (
          <div style={generateResult.ok ? S.genSuccess : S.genError}>
            {generateResult.ok ? (generateResult.data?.committed ? (
              <>
                <b>Generated successfully</b>
                <div style={S.genLine}>
                  Items: {generateResult.data?.summary?.items?.created ?? 0} created ·
                  Recipe: {generateResult.data?.summary?.recipe_draft || '—'} + {generateResult.data?.summary?.recipe_activate || '—'} ·
                  BOM: {generateResult.data?.summary?.bom || '—'} ·
                  Routing: {generateResult.data?.summary?.routing || '—'} ·
                  Links: {generateResult.data?.summary?.fg_sfg_links || '—'}
                </div>
              </>
            ) : (
              <>Stopped at {generateResult.data?.stopped_at}: {generateResult.data?.reason || 'blocked'}</>
            )) : (
              <>Error: {generateResult.error?.message || 'failed'}</>
            )}
          </div>
        )}
      </div>

      {previewError && <section style={{ ...S.card, ...S.errCard }}><b>Preview error:</b> {previewError}</section>}

      {/* PREVIEW OUTPUT */}
      {preview && !generateResult?.data?.committed && (
        <section style={S.card}>
          <div style={S.sectionHead}>
            <h2 style={S.head}>Preview — {preview.sku_code}</h2>
            <div style={S.metaRow}>
              <span style={S.metaPill}>Parent SKU: <b>{preview.parent_sku || preview.sku_code}</b></span>
              <span style={S.metaPill}>Family: <b>{preview.product_family || '—'}</b></span>
              <span style={S.metaPill}>Formulation: <b>{preview.formulation_code || '—'}</b></span>
            </div>
            <div style={S.chips}>
              <span style={S.chipGreen}>CREATE {preview.summary?.create ?? 0}</span>
              <span style={S.chipAmber}>USE_EXISTING {preview.summary?.use_existing ?? 0}</span>
              <span style={S.chipRed}>BLOCK {preview.summary?.block ?? 0}</span>
            </div>
          </div>
          <div style={preview.can_generate ? S.bannerOk : S.bannerBlock}>
            {preview.can_generate ? 'Ready to generate.' : 'Blocked — resolve the issues below before generation.'}
          </div>

          {preview.blocks?.length > 0 && (
            <Block title="Blocks">
              <table style={S.table}><thead><tr>{['Field', 'Stage', 'Reason'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{preview.blocks.map((b, i) => (
                  <tr key={i}><td style={S.tdRed}>{b.field}</td><td style={S.td}>{b.stage}</td><td style={S.td}>{b.reason}</td></tr>
                ))}</tbody></table>
            </Block>
          )}

          {preview.warnings?.length > 0 && (
            <Block title="Warnings"><ul style={S.ul}>{preview.warnings.map((w, i) => <li key={i} style={S.warnLi}>{w}</li>)}</ul></Block>
          )}

          <Block title="Stage items">
            <table style={S.table}><thead><tr>{['Action', 'Item Code', 'Stage', 'Process', 'Policy'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{preview.items?.map((it, i) => (
                <tr key={i}>
                  <td style={S.td}><span style={it.action === 'CREATE' ? S.tagGreen : it.action === 'BLOCK' ? S.tagRed : S.tagAmber}>{it.action}</span></td>
                  <td style={S.td}><b>{it.item_code}</b></td>
                  <td style={S.td}>{it.stage_code}</td>
                  <td style={S.td}>{it.process_code || '—'}</td>
                  <td style={S.td}>{it.make_policy || '—'}</td>
                </tr>
              ))}</tbody></table>
          </Block>

          <Block title="Recipe draft (MTS + MTO)">
            {preview.recipe?.steps?.map((s) => (
              <div key={s.step_no} style={S.stepBox}>
                <b>{s.step_no}. {s.output_item_code}</b> · {s.process_code} · {s.calculation_basis} · {s.make_policy}
                <div style={S.inputs}>{s.inputs.map((inp, j) => (
                  <span key={j} style={S.inputPill}>{inp.input_item_code} · {inp.qty} {inp.uom} · {inp.qty_basis}</span>
                ))}</div>
              </div>
            ))}
          </Block>

          <Block title="Projected BOMs">
            {preview.boms?.map((b, i) => (
              <div key={i} style={S.stepBox}><b>{b.output_item_code}</b>
                <div style={S.inputs}>{b.lines.map((l, j) => <span key={j} style={S.inputPill}>{l.component_item_code} · {l.qty} {l.uom}</span>)}</div>
              </div>
            ))}
          </Block>

          <Block title="Routing flow">
            {preview.routing_branches ? (
              <div style={S.branches}>
                <div style={S.branchLine}><span style={S.branchTag}>Compound</span>{preview.routing_branches.mix_branch?.map((s, i) => <span key={s} style={S.flowNode}>{s}{i < preview.routing_branches.mix_branch.length - 1 ? ' →' : ''}</span>)}</div>
                <div style={S.branchLine}><span style={S.branchTag}>Back plate</span>{preview.routing_branches.bp_branch?.map((s, i) => <span key={s} style={S.flowNode}>{s}{i < preview.routing_branches.bp_branch.length - 1 ? ' →' : ''}</span>)}</div>
                <div style={S.branchLine}><span style={S.branchTag}>Assembly</span><span style={S.mergeTag}>PF + ACBP →</span>{preview.routing_branches.merge?.map((s, i) => <span key={s} style={S.flowNode}>{s}{i < preview.routing_branches.merge.length - 1 ? ' →' : ''}</span>)}</div>
              </div>
            ) : (
              <div style={S.flow}>{preview.routing_flow?.map((r, i) => (
                <span key={i} style={S.flowNode}>{r.stage_code}{i < preview.routing_flow.length - 1 ? ' →' : ''}</span>
              ))}</div>
            )}
          </Block>

          <div style={S.compactNote}>Runtime preview is finalized in Recipe Builder after machine selection.</div>

          <Block title="FG–SFG links">
            <table style={S.table}><thead><tr>{['SFG', 'Stage', 'Variant', 'Qty/Set'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{preview.links?.map((l, i) => (
                <tr key={i}><td style={S.td}><b>{l.sfg_item_code}</b></td><td style={S.td}>{l.stage_code}</td><td style={S.td}>{l.variant_code || '—'}</td><td style={S.td}>{l.qty_per_set ?? '—'}</td></tr>
              ))}</tbody></table>
          </Block>

          <div style={S.policyRow}>
            <span style={S.policyMts}>MTS (≤STK): {preview.policy_split?.mts?.length ?? 0}</span>
            <span style={S.policyMto}>MTO (&gt;STK): {preview.policy_split?.mto?.length ?? 0}</span>
          </div>
        </section>
      )}
    </div>
  );
}

function Block({ title, children }) {
  const open = title === 'Blocks';
  return (
    <details style={S.block} open={open}>
      <summary style={S.blockTitle}>{title}</summary>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>{children}</div>
    </details>
  );
}

const S = {
  page: { padding: '16px 22px', background: C.bg, minHeight: '100vh', color: C.text },
  hero: { background: `linear-gradient(135deg, ${C.primary}, #0F172A)`, color: '#fff', borderRadius: 14, padding: '14px 18px', marginBottom: 12 },
  kicker: { fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1 },
  title: { margin: '2px 0', fontSize: 22, fontWeight: 800 },
  sub: { margin: 0, opacity: 0.86, fontSize: 12, maxWidth: 760 },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 10, boxShadow: '0 6px 16px rgba(15,23,42,0.05)' },
  errCard: { background: C.dangerSoft, borderColor: '#FECACA', color: C.danger },
  head: { margin: '0 0 8px', fontSize: 15, fontWeight: 800 },
  subhead: { fontSize: 12, fontWeight: 800, color: C.muted, margin: '6px 0', textTransform: 'uppercase', letterSpacing: 0.5 },
  formWrap: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'start' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: 700, color: C.text },
  unit: { color: C.muted, fontWeight: 600, fontStyle: 'normal' },
  input: { width: '100%', height: 32, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 9px', fontSize: 13, boxSizing: 'border-box', background: '#fff' },
  hint: { color: C.muted, fontSize: 11, marginTop: 6 },
  segment: { display: 'flex', gap: 8, marginBottom: 12 },
  segBtn: { border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 },
  segActive: { border: `1px solid ${C.primary}`, background: C.primarySoft, color: C.primary, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontWeight: 800 },
  toggleRow: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  toggleOn: { display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${C.primary}`, background: C.primarySoft, color: C.primary, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontWeight: 700 },
  toggleOff: { display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontWeight: 600 },
  actions: { display: 'flex', gap: 10, margin: '10px 0 12px', alignItems: 'center', flexWrap: 'wrap' },
  primaryBtn: { background: C.primary, color: '#fff', border: 'none', borderRadius: 10, height: 42, padding: '0 22px', fontWeight: 800, cursor: 'pointer' },
  genResult: { marginTop: 10, padding: '8px 12px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text },
  genSuccess: { padding: '8px 12px', background: C.successSoft, border: `1px solid #BBF7D0`, borderRadius: 8, fontSize: 13, color: C.success },
  genError: { padding: '8px 12px', background: C.dangerSoft, border: `1px solid #FECACA`, borderRadius: 8, fontSize: 13, color: C.danger },
  genLine: { marginTop: 3, color: C.text, fontSize: 12 },
  primaryBtn: { background: C.primary, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  disabledBtn: { background: '#E2E8F0', color: '#94A3B8', border: 'none', borderRadius: 10, height: 42, padding: '0 18px', fontWeight: 800, cursor: 'not-allowed' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  chips: { display: 'flex', gap: 8 },
  chipGreen: { background: C.successSoft, color: C.success, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 800 },
  chipAmber: { background: C.warnSoft, color: C.warn, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 800 },
  chipRed: { background: C.dangerSoft, color: C.danger, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 800 },
  bannerOk: { background: C.successSoft, color: C.success, borderRadius: 10, padding: '10px 12px', fontWeight: 700, marginBottom: 12 },
  bannerBlock: { background: C.dangerSoft, color: C.danger, borderRadius: 10, padding: '10px 12px', fontWeight: 700, marginBottom: 12 },
  block: { borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 },
  blockTitle: { fontSize: 13, fontWeight: 800, color: C.text, cursor: 'pointer', listStyle: 'none' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 11 },
  td: { padding: '6px 8px', borderBottom: `1px solid ${C.border}` },
  tdRed: { padding: 8, borderBottom: `1px solid ${C.border}`, color: C.danger, fontWeight: 700 },
  tagGreen: { background: C.successSoft, color: C.success, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800 },
  tagAmber: { background: C.warnSoft, color: C.warn, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800 },
  tagRed: { background: C.dangerSoft, color: C.danger, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800 },
  stepBox: { border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 8, fontSize: 13 },
  inputs: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  inputPill: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '3px 8px', fontSize: 12 },
  flow: { display: 'flex', flexWrap: 'wrap', gap: 8, fontWeight: 700 },
  branches: { display: 'flex', flexDirection: 'column', gap: 8 },
  branchLine: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  branchTag: { background: C.text, color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800, minWidth: 78, textAlign: 'center' },
  mergeTag: { color: C.muted, fontWeight: 700, fontSize: 12 },
  flowNode: { background: C.primarySoft, color: C.primary, borderRadius: 8, padding: '4px 10px', fontSize: 13 },
  ul: { margin: 0, paddingLeft: 18 },
  warnLi: { color: C.warn, fontSize: 13 },
  compactNote: { color: C.muted, fontSize: 12, borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 },
  policyRow: { display: 'flex', gap: 8, marginTop: 10 },
  policyMts: { background: C.successSoft, color: C.success, borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 13 },
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  metaPill: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 999, padding: '3px 10px', fontSize: 12 },
  policyMto: { background: C.primarySoft, color: C.primary, borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 13 },
};
