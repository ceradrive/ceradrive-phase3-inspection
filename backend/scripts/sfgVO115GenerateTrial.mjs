/**
 * CERADRIVE ERP — SFG VO115 FULL GENERATE Trial (controlled backend generate)
 *
 * Calls commitFullGenerate() directly (no auth route, no UI; Generate UI stays disabled).
 * Enables SFG_FULL_GENERATE_ENABLED=true IN-PROCESS only (committed flags stay false).
 * VO115 starts un-generated (only MIX-VO-726, BP115, VO115 exist).
 *  1) server-side previewBuild -> expect CREATE 11, USE_EXISTING 3, BLOCK 0, SR-VO115 / 12 steps.
 *  2) generate run #1 -> creates 11 items + active SR-VO115 + BOM + routing + FG-SFG links.
 *  3) generate run #2 -> every slice USE_EXISTING, counts unchanged (idempotent, no duplicates).
 * No inventory. No schema. No git ops.
 *
 * Counts come from supabase SELECTs (works against the real DB and the offline stub) and the
 * orchestrator response — this script does NOT depend on any in-memory TABLES/INSERTS array.
 *
 * Run:  node backend/scripts/sfgVO115GenerateTrial.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(HERE, '../.env');
async function loadEnv() {
  try { const d = await import('dotenv'); d.config({ path: ENV_PATH }); return; } catch {}
  try {
    for (const l of readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i === -1) continue;
      const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {}
}
function L(s = '') { process.stdout.write(s + '\n'); }

function full(o) { try { return inspect(o, { depth: 8, showHidden: true, colors: false, breakLength: 100 }); } catch (e) { return String(o); } }
// Print EVERY useful field of an error-like value (works for Error instances with non-enumerable
// props, Supabase/PostgREST error objects, and plain objects). Never hides undefined.
function dumpErr(label, e) {
  L(label + ':');
  if (e === undefined) { L('  (value is undefined)'); return; }
  if (e === null) { L('  (value is null)'); return; }
  if (typeof e !== 'object') { L('  (' + typeof e + ') ' + String(e)); return; }
  L('  name:    ' + (e.name ?? '(none)'));
  L('  message: ' + (e.message ?? '(none)'));
  L('  code:    ' + (e.code ?? '(none)'));
  L('  details: ' + (e.details !== undefined ? full(e.details) : '(none)'));
  L('  hint:    ' + (e.hint ?? '(none)'));
  L('  status:  ' + (e.status ?? e.statusCode ?? '(none)'));
  if (e.stack) L('  stack:\n    ' + String(e.stack).split('\n').slice(0, 6).join('\n    '));
  L('  keys:    ' + JSON.stringify(Object.keys(e)));
  L('  raw:     ' + full(e));
}
// Dump a full commitFullGenerate result when a stage fails to commit.
function dumpStop(r) {
  const d = r?.data || {};
  L('  >>> stage did not commit');
  L('  stopped_at: ' + (d.stopped_at ?? '(unknown)'));
  L('  reason:     ' + (d.reason ?? '(none)'));
  dumpErr('  slice error (data.error)', d.error);
  L('  detail (failing slice payload):');
  L('    ' + full(d.detail).split('\n').join('\n    '));
  L('  stages so far: ' + full(d.stages));
  L('  summary:       ' + full(d.summary));
  L('  FULL result.data:');
  L('    ' + full(d).split('\n').join('\n    '));
}

const VO115 = {
  sku_code: 'VO115', sku_name: 'VO SWIFT', product_family: 'VO',
  pcs_per_set: 4, compound_weight_g: 95, mix_formula_code: 'MIX-VO-726',
  bp_mode: 'SAME', bp_variants: [{ variant_code: 'SAME', bp_item_code: 'BP115', qty_per_set: 4, bp_weight_g: 95 }],
  allowed_machine_ids: [process.env.TRIAL_MACHINE_ID || 'preview-machine'],
  preferred_machine_id: process.env.TRIAL_MACHINE_ID || 'preview-machine',
  die_code: 'D-115', die_cavities: 8, moulding_cycle_time_sec: 300, moulding_setup_time_min: 20,
  acbp_pcs_per_tray: 40, acbp_tray_cycle_sec: 60, pwc_pcs_per_tray: 36, pwc_tray_cycle_sec: 90,
  cur_pcs_per_tray: 72, cur_trays_per_batch: 12, cur_cycle_time_min: 40,
  grinding_pcs_per_hour: 480, stacking_pcs_per_hour: 600, pcs_per_crate: 200,
  shot_blast_batch_kg: 50, shot_blast_cycle_sec: 600,
  has_powder_coat: true, has_printing: true, has_riveting: true, has_shrink: true, // PRT/RIV/SHK
};
const RECIPE_CODE = 'SR-VO115';
const PARENT_CODE = 'VO115';
const EXPECT_CREATE = ['VO_PF115','VO_SBBP115','VO_ACBP115','VO_MLD115','VO_GRD115','VO_PWC115','VO_CUR115','VO_STK115','VO_PRT115','VO_RIV115','VO_SHK115'];

async function main() {
  await loadEnv();
  for (const k of ['SFG_COMMIT_ENABLED','SFG_RECIPE_COMMIT_ENABLED','SFG_RECIPE_ACTIVATE_ENABLED','SFG_BOM_COMMIT_ENABLED','SFG_ROUTING_COMMIT_ENABLED','SFG_LINKS_COMMIT_ENABLED','SFG_FULL_GENERATE_ENABLED']) delete process.env[k];

  let supabase, previewBuild, commitFullGenerate, fullGenerateEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ previewBuild, commitFullGenerate, fullGenerateEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { dumpErr('IMPORT ERROR', e); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };

  // ── query helpers (DB-agnostic; no TABLES/INSERTS) ──
  const countIn = async (table, col, vals) => {
    if (!vals || !vals.length) return 0;
    const { data, error } = await supabase.from(table).select('id').in(col, vals);
    if (error) throw error; return (data || []).length;
  };
  const countEq = async (table, col, val) => {
    if (val == null) return 0;
    const { data, error } = await supabase.from(table).select('id').eq(col, val);
    if (error) throw error; return (data || []).length;
  };
  const firstEq = async (table, sel, col, val) => {
    const { data } = await supabase.from(table).select(sel).eq(col, val);
    return (data || [])[0] || null;
  };
  const idOf = async (code) => (await firstEq('item_master', 'id, item_code', 'item_code', code))?.id || null;
  const safeCount = async (table) => { try { const { data, error } = await supabase.from(table).select('id'); if (error) return null; return (data || []).length; } catch { return null; } };

  // scoped snapshot of everything VO115 generate touches
  const snapshot = async () => {
    const recRow = await firstEq('stage_recipe_headers', 'id, status', 'recipe_code', RECIPE_CODE);
    const recId = recRow?.id || null;
    const setId = await idOf(PARENT_CODE);
    return {
      children: await countIn('item_master', 'item_code', EXPECT_CREATE),
      recipe: await countEq('stage_recipe_headers', 'recipe_code', RECIPE_CODE),
      recipe_status: recRow?.status ?? null,
      steps: recId ? await countEq('stage_recipe_steps', 'recipe_id', recId) : 0,
      bom: recId ? await countEq('bom_headers', 'generated_from_recipe_id', recId) : 0,
      routing: setId ? await countEq('routing_headers', 'item_id', setId) : 0,
      links: setId ? await countEq('fg_sfg_item_links', 'fg_item_id', setId) : 0,
    };
  };
  const cmp = (a, b) => ['children','recipe','steps','bom','routing','links'].every((k) => a[k] === b[k]);

  L('=== SFG VO115 FULL GENERATE TRIAL (controlled) ===');
  ok(fullGenerateEnabled() === false, 'fullGenerateEnabled() = false (committed flag false, env cleared)');

  // inventory snapshot (no-write proof; tables may be absent -> null -> skipped)
  const invBefore = { ledger: await safeCount('inventory_ledger'), balance: await safeCount('inventory_balance') };

  // gate proof: disabled -> FEATURE_DISABLED, no writes
  const sGateBefore = await snapshot();
  const rGate = await commitFullGenerate(VO115, null);
  ok(rGate.error?.code === 'FEATURE_DISABLED', 'generate blocked while flag disabled (FEATURE_DISABLED)');
  ok(cmp(await snapshot(), sGateBefore), 'no writes while disabled');

  process.env.SFG_FULL_GENERATE_ENABLED = 'true'; // runtime-only enable
  ok(fullGenerateEnabled() === true, 'fullGenerateEnabled() = true (runtime only)');

  L('\n[1] server-side preview (re-run)');
  const pv = await previewBuild(VO115);
  if (pv.error) { dumpErr('  PREVIEW ERROR', pv.error); process.exit(2); }
  const items = pv.data.generated_items || pv.data.items || [];
  const create = items.filter((i) => i.action === 'CREATE').map((i) => String(i.item_code).toUpperCase());
  const useEx = items.filter((i) => i.action === 'USE_EXISTING').map((i) => String(i.item_code).toUpperCase());
  L('  CREATE(' + create.length + '): ' + create.join(', '));
  L('  USE_EXISTING(' + useEx.length + '): ' + useEx.join(', '));
  ok(create.length === 11 && EXPECT_CREATE.every((c) => create.includes(c)), 'preview CREATE = 11 expected children');
  ok(useEx.length === 3 && ['MIX-VO-726','BP115','VO115'].every((c) => useEx.includes(c)), 'preview USE_EXISTING = MIX-VO-726, BP115, VO115');
  ok((pv.data.blocks || []).length === 0, 'preview BLOCK = 0');
  ok((pv.data.recipe?.recipe_code || pv.data.recipe_code) === RECIPE_CODE, 'preview recipe = SR-VO115');

  const before = await snapshot();
  L('\n[before] ' + JSON.stringify(before));

  L('\n[2] commitFullGenerate run #1 (create)');
  const r1 = await commitFullGenerate(VO115, null);
  if (r1.error) { dumpErr('  ORCHESTRATOR ERROR (r1.error)', r1.error); L('  full r1: ' + full(r1)); process.exit(2); }
  if (r1.data.committed === false) { dumpStop(r1); process.exit(1); }
  ok(r1.data.committed === true, 'committed = true');
  L('  summary: ' + JSON.stringify(r1.data.summary));
  const cre = r1.data.stages?.items?.summary?.created;
  const ue1 = r1.data.stages?.items?.summary?.use_existing;
  L('  items reported: created=' + cre + ', use_existing=' + ue1);
  ok(cre === 11, 'items: 11 CREATED (from response)');

  const after1 = await snapshot();
  L('  [after #1] ' + JSON.stringify(after1));
  ok(after1.children === 11, 'all 11 child items now exist (verified by query)');
  ok(after1.recipe === 1 && String(after1.recipe_status).toLowerCase() === 'active', 'recipe SR-VO115 active');
  ok(after1.steps === 12, 'SR-VO115 has 12 steps (' + after1.steps + ')');
  ok(after1.bom >= 11, 'BOM headers created (' + after1.bom + ')');
  ok(after1.routing === 1, 'routing header created (1)');
  ok(after1.links === 11, 'FG-SFG links created (' + after1.links + ')');
  ok(after1.children === before.children + 11, 'child items grew by exactly 11');

  L('\n[3] commitFullGenerate run #2 (idempotent)');
  const r2 = await commitFullGenerate(VO115, null);
  if (r2.error) { dumpErr('  ORCHESTRATOR ERROR (r2.error)', r2.error); L('  full r2: ' + full(r2)); process.exit(2); }
  if (r2.data.committed === false) { dumpStop(r2); process.exit(1); }
  ok(r2.data.committed === true, 'committed = true on re-run');
  L('  summary: ' + JSON.stringify(r2.data.summary));
  ok(r2.data.stages.items.summary.created === 0, 'items: 0 created on re-run (use_existing=' + r2.data.stages.items.summary.use_existing + ')');
  ok(r2.data.stages.recipe_draft.recipe.action === 'USE_EXISTING', 'recipe: USE_EXISTING');
  ok(r2.data.stages.bom.bom.action === 'USE_EXISTING', 'BOM: USE_EXISTING');
  ok(r2.data.stages.routing.routing.action === 'USE_EXISTING', 'routing: USE_EXISTING');
  ok(r2.data.stages.fg_sfg_links.links.action === 'USE_EXISTING', 'links: USE_EXISTING');
  const after2 = await snapshot();
  ok(cmp(after2, after1), 'all counts unchanged on re-run (no duplicates)');

  L('\n[4] no inventory writes; flags stay false; UI disabled');
  const invAfter = { ledger: await safeCount('inventory_ledger'), balance: await safeCount('inventory_balance') };
  if (invBefore.ledger == null && invBefore.balance == null) {
    L('  (inventory tables not accessible here; orchestrator writes none regardless)');
  } else {
    ok(invBefore.ledger === invAfter.ledger, 'inventory_ledger unchanged (' + invBefore.ledger + ')');
    ok(invBefore.balance === invAfter.balance, 'inventory_balance unchanged (' + invBefore.balance + ')');
  }
  ok(r1.data.not_written.includes('inventory') && r2.data.not_written.includes('inventory'), 'response declares inventory not written');
  delete process.env.SFG_FULL_GENERATE_ENABLED;
  ok(fullGenerateEnabled() === false, 'committed flag still false (runtime env only; cleared)');

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Feature flags remain false in committed files; Generate UI remains disabled.');
  process.exit(fail === 0 ? 0 : 1);
}
main();
