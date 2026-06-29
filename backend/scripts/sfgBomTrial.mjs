/**
 * CERADRIVE ERP — 2A-2-epsilon BOM-only Trial (local validation)
 *
 * Calls commitRecipeBom() directly (no auth route, no UI).
 * Enables SFG_BOM_COMMIT_ENABLED=true in-process only (committed flag stays false).
 * Generates bom_headers/bom_lines from the ACTIVE recipe only. No items/recipe/routing/link/inventory.
 * No schema. No git ops.
 *
 * Run:  node backend/scripts/sfgBomTrial.mjs
 * Pre-req: 2A-2-alpha items + gamma draft + delta activation (SR-VO101S active) exist.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const VO101S = {
  sku_code: 'VO101S', sku_name: 'VO Front Brake Pad Set', product_family: 'VO',
  pcs_per_set: 4, compound_weight_g: 95, mix_formula_code: 'MIX-VO-726',
  bp_mode: 'SAME', bp_variants: [{ variant_code: 'SAME', bp_item_code: 'BP101', qty_per_set: 4, bp_weight_g: 95 }],
  allowed_machine_ids: [process.env.TRIAL_MACHINE_ID || 'preview-machine'],
  preferred_machine_id: process.env.TRIAL_MACHINE_ID || 'preview-machine',
  die_code: 'D-101', die_cavities: 8, moulding_cycle_time_sec: 300, moulding_setup_time_min: 20,
  acbp_pcs_per_tray: 40, acbp_tray_cycle_sec: 60, pwc_pcs_per_tray: 36, pwc_tray_cycle_sec: 90,
  cur_pcs_per_tray: 72, cur_trays_per_batch: 12, cur_cycle_time_min: 40,
  grinding_pcs_per_hour: 480, stacking_pcs_per_hour: 600, pcs_per_crate: 200,
  shot_blast_batch_kg: 50, shot_blast_cycle_sec: 600,
};
const RECIPE_CODE = 'SR-VO101S';
function L(s = '') { process.stdout.write(s + '\n'); }

async function main() {
  await loadEnv();
  process.env.SFG_BOM_COMMIT_ENABLED = 'true'; // runtime-only enable

  let supabase, commitRecipeBom, bomCommitEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ commitRecipeBom, bomCommitEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const len = async (table, col, val) => { const { data } = await supabase.from(table).select('id').eq(col, val); return (data || []).length; };
  const imCount = async () => { const { data } = await supabase.from('item_master').select('id').eq('formulation_code', 'VO101S'); return (data || []).length; };

  L('=== 2A-2-epsilon BOM-only TRIAL (VO101S) ===');
  L('bom flag (runtime): ' + bomCommitEnabled());

  const { data: recRows } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', RECIPE_CODE);
  const rec = recRows?.[0];
  if (!rec) { L('  PRE-REQ MISSING: SR-VO101S not found. Run gamma+delta first.'); process.exit(2); }
  if (rec.status !== 'active') { L('  PRE-REQ: SR-VO101S not active (status=' + rec.status + '). Run 2A-2-delta first.'); process.exit(2); }
  const recipeId = rec.id;

  const imBefore = await imCount();
  const stepsBefore = await len('stage_recipe_steps', 'recipe_id', recipeId);
  const inputsBefore = (await (async () => { const { data: st } = await supabase.from('stage_recipe_steps').select('id').eq('recipe_id', recipeId); const ids = (st || []).map((r) => r.id); if (!ids.length) return 0; const { data: ins } = await supabase.from('stage_recipe_inputs').select('id').in('step_id', ids); return (ins || []).length; })());
  const bomBefore = await len('bom_headers', 'generated_from_recipe_id', recipeId);
  L('\n[before] active recipe steps=' + stepsBefore + ' inputs=' + inputsBefore + ' bom_headers=' + bomBefore + ' item_master(formulation)=' + imBefore);

  // SET id for routing/link checks
  const { data: setRows } = await supabase.from('item_master').select('id').eq('item_code', 'VO101S');
  const setId = setRows?.[0]?.id || null;

  L('\n[1] commitRecipeBom run #1');
  const r1 = await commitRecipeBom(VO101S, null);
  if (r1.error) { L('  ERROR ' + JSON.stringify(r1.error)); process.exit(2); }
  L('  ' + JSON.stringify(r1.data.bom));
  ok(r1.data.committed === true, 'committed = true');
  ok(['GENERATED', 'USE_EXISTING'].includes(r1.data.bom.action), 'BOM GENERATED or USE_EXISTING');
  ok(r1.data.bom.headers >= 1, 'bom_headers >= 1');
  ok(r1.data.bom.lines >= 1, 'bom_lines >= 1');
  const h1 = await len('bom_headers', 'generated_from_recipe_id', recipeId);

  L('\n[2] re-run (idempotent)');
  const r2 = await commitRecipeBom(VO101S, null);
  if (r2.error) { L('  ERROR ' + JSON.stringify(r2.error)); process.exit(2); }
  L('  ' + JSON.stringify(r2.data.bom));
  ok(r2.data.bom.action === 'USE_EXISTING', 're-run -> USE_EXISTING');
  ok((await len('bom_headers', 'generated_from_recipe_id', recipeId)) === h1, 'bom_headers count unchanged (no duplicates)');

  L('\n[3] item / recipe / step counts unchanged');
  ok((await imCount()) === imBefore, 'item_master count unchanged');
  ok((await len('stage_recipe_steps', 'recipe_id', recipeId)) === stepsBefore, 'recipe steps unchanged');

  L('\n[4] no routing / link rows');
  let routeLen = 0, linkLen = 0;
  if (setId) {
    const rt = await supabase.from('routing_headers').select('id').eq('item_id', setId); routeLen = (rt.data || []).length;
    const lk = await supabase.from('fg_sfg_item_links').select('id').eq('fg_item_id', setId); linkLen = (lk.data || []).length;
  }
  ok(routeLen === 0, 'no routing_headers for VO101S');
  ok(linkLen === 0, 'no fg_sfg_item_links for VO101S');
  ok(r2.data.not_written.includes('routing') && r2.data.not_written.includes('fg_sfg_links') && r2.data.not_written.includes('inventory') && r2.data.not_written.includes('items') && r2.data.not_written.includes('recipe_activate'), 'not_written declares items/recipe/routing/links/inventory');

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Generate button remains DISABLED (frontend not wired).');
  L('Rollback (manual, review first): DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM bom_headers WHERE generated_from_recipe_id=(SELECT id FROM stage_recipe_headers WHERE recipe_code=\'SR-VO101S\')); ' +
    'DELETE FROM bom_headers WHERE generated_from_recipe_id=(SELECT id FROM stage_recipe_headers WHERE recipe_code=\'SR-VO101S\');');
  process.exit(fail === 0 ? 0 : 1);
}

main();
