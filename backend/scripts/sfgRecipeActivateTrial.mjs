/**
 * CERADRIVE ERP — 2A-2-delta ACTIVATE RECIPE Trial (local validation)
 *
 * Calls commitRecipeActivate() directly (no auth route, no UI).
 * Enables SFG_RECIPE_ACTIVATE_ENABLED=true in-process only (committed flag stays false).
 * Header-only activation of SR-VO101S. NO BOM/routing/link/inventory/item writes. No schema. No git ops.
 *
 * Run:  node backend/scripts/sfgRecipeActivateTrial.mjs
 * Pre-req: 2A-2-alpha items + 2A-2-gamma draft recipe SR-VO101S already exist.
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
  process.env.SFG_RECIPE_ACTIVATE_ENABLED = 'true'; // runtime-only enable

  let supabase, commitRecipeActivate, recipeActivateEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ commitRecipeActivate, recipeActivateEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const recRow = async () => {
    const { data } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', RECIPE_CODE);
    return data?.[0] || null;
  };
  const len = async (table, col, val) => { const { data } = await supabase.from(table).select('id').eq(col, val); return (data || []).length; };
  const imCount = async () => { const { data } = await supabase.from('item_master').select('id').eq('formulation_code', 'VO101S'); return (data || []).length; };

  L('=== 2A-2-delta ACTIVATE RECIPE TRIAL (VO101S) ===');
  L('activate flag (runtime): ' + recipeActivateEnabled());

  const r0 = await recRow();
  if (!r0) { L('  PRE-REQ MISSING: SR-VO101S draft not found. Run 2A-2-gamma first.'); process.exit(2); }
  const recipeId = r0.id;
  const imBefore = await imCount();
  const stepsBefore = await len('stage_recipe_steps', 'recipe_id', recipeId);
  const { data: setRows } = await supabase.from('item_master').select('id').eq('item_code', 'VO101S');
  const setId = setRows?.[0]?.id || null;
  L('\n[before] SR-VO101S status=' + r0.status + ' steps=' + stepsBefore + ' item_master(formulation)=' + imBefore);

  L('\n[1] commitRecipeActivate run #1');
  const a1 = await commitRecipeActivate(VO101S, null);
  if (a1.error) { L('  ERROR ' + JSON.stringify(a1.error)); process.exit(2); }
  L('  ' + JSON.stringify(a1.data.recipe) + (a1.data.superseded?.length ? ' superseded=' + a1.data.superseded.length : ''));
  ok(a1.data.committed === true, 'committed = true');
  ok(['ACTIVATED', 'USE_EXISTING'].includes(a1.data.recipe.action), 'ACTIVATED or USE_EXISTING');
  const after1 = await recRow();
  ok(after1.status === 'active', 'SR-VO101S status = active');

  L('\n[2] re-run (idempotent)');
  const a2 = await commitRecipeActivate(VO101S, null);
  if (a2.error) { L('  ERROR ' + JSON.stringify(a2.error)); process.exit(2); }
  L('  ' + JSON.stringify(a2.data.recipe));
  ok(a2.data.recipe.action === 'USE_EXISTING', 're-run -> USE_EXISTING (already active)');
  ok((await len('stage_recipe_headers', 'recipe_code', RECIPE_CODE)) === 1, 'still 1 header (no duplicate)');

  L('\n[3] item & step counts unchanged');
  ok((await imCount()) === imBefore, 'item_master count unchanged');
  ok((await len('stage_recipe_steps', 'recipe_id', recipeId)) === stepsBefore, 'recipe steps unchanged');

  L('\n[4] no BOM/routing/link rows');
  let bomLen = 0, routeLen = 0, linkLen = 0;
  const b = await supabase.from('bom_headers').select('id').eq('generated_from_recipe_id', recipeId);
  bomLen = (b.data || []).length;
  if (setId) {
    const rt = await supabase.from('routing_headers').select('id').eq('item_id', setId); routeLen = (rt.data || []).length;
    const lk = await supabase.from('fg_sfg_item_links').select('id').eq('fg_item_id', setId); linkLen = (lk.data || []).length;
  }
  ok(bomLen === 0, 'no BOM generated from this recipe (activation did NOT sync BOM)');
  ok(routeLen === 0, 'no routing_headers for VO101S');
  ok(linkLen === 0, 'no fg_sfg_item_links for VO101S');
  ok(a2.data.not_written.includes('bom') && a2.data.not_written.includes('routing') && a2.data.not_written.includes('fg_sfg_links') && a2.data.not_written.includes('inventory') && a2.data.not_written.includes('items'), 'not_written declares items/bom/routing/links/inventory');

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Generate button remains DISABLED (frontend not wired).');
  L('Rollback (manual, review first): UPDATE stage_recipe_headers SET status=\'draft\', activated_at=NULL, activated_by=NULL WHERE recipe_code=\'SR-VO101S\';');
  process.exit(fail === 0 ? 0 : 1);
}

main();
