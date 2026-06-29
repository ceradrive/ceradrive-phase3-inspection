/**
 * CERADRIVE ERP — 2A-2-gamma DRAFT RECIPE commit Trial (local validation)
 *
 * Calls commitRecipeDraft() directly (no auth route, no UI).
 * Enables SFG_RECIPE_COMMIT_ENABLED=true in-process only (committed flag stays false).
 * Writes stage_recipe_headers/steps/inputs as DRAFT only. Verifies no BOM/routing/link rows
 * and item_master unchanged. No schema. No git ops.
 *
 * Run:  node backend/scripts/sfgRecipeDraftTrial.mjs
 * Pre-req: 2A-2-alpha ITEMS commit already ran (VO101S + VO_* exist).
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
  process.env.SFG_RECIPE_COMMIT_ENABLED = 'true'; // runtime-only enable

  let supabase, commitRecipeDraft, recipeCommitEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ commitRecipeDraft, recipeCommitEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const count = async (table, col, val) => {
    const { data, error } = await supabase.from(table).select('id').eq(col, val);
    if (error) throw error; return (data || []).length;
  };
  const imCount = async () => {
    const { data } = await supabase.from('item_master').select('id').eq('formulation_code', 'VO101S');
    return (data || []).length;
  };

  L('=== 2A-2-gamma DRAFT RECIPE TRIAL (VO101S) ===');
  L('recipe flag (runtime): ' + recipeCommitEnabled());

  // resolve SET id for routing/link checks
  const { data: setRows } = await supabase.from('item_master').select('id').eq('item_code', 'VO101S');
  const setId = setRows?.[0]?.id || null;

  const headerBefore = await count('stage_recipe_headers', 'recipe_code', RECIPE_CODE);
  const imBefore = await imCount();
  L('\n[before] stage_recipe_headers(SR-VO101S)=' + headerBefore + ' item_master(formulation VO101S)=' + imBefore);

  L('\n[1] commitRecipeDraft run #1');
  const r1 = await commitRecipeDraft(VO101S, null);
  if (r1.error) { L('  ERROR ' + JSON.stringify(r1.error)); process.exit(2); }
  L('  ' + JSON.stringify(r1.data.recipe) + ' steps=' + r1.data.steps_count);
  ok(r1.data.committed === true, 'committed = true');
  ok(['CREATED', 'USE_EXISTING'].includes(r1.data.recipe.action), 'recipe CREATED or USE_EXISTING');
  ok(r1.data.recipe.recipe_code === RECIPE_CODE, 'recipe_code = SR-VO101S');
  ok(r1.data.recipe.status === 'draft', 'status = draft (not activated)');

  const headerAfter = await count('stage_recipe_headers', 'recipe_code', RECIPE_CODE);
  ok(headerAfter === 1, 'exactly 1 draft recipe header for SR-VO101S');

  L('\n[2] re-run (idempotent)');
  const r2 = await commitRecipeDraft(VO101S, null);
  if (r2.error) { L('  ERROR ' + JSON.stringify(r2.error)); process.exit(2); }
  L('  ' + JSON.stringify(r2.data.recipe));
  ok(r2.data.recipe.action === 'USE_EXISTING', 're-run -> USE_EXISTING');
  ok((await count('stage_recipe_headers', 'recipe_code', RECIPE_CODE)) === 1, 'still 1 header (no duplicate)');

  L('\n[3] item_master unchanged');
  ok((await imCount()) === imBefore, 'item_master count unchanged');

  L('\n[4] no BOM/routing/link rows');
  // recipe steps for this recipe
  const { data: hrow } = await supabase.from('stage_recipe_headers').select('id').eq('recipe_code', RECIPE_CODE);
  const recipeId = hrow?.[0]?.id;
  let bomLen = 0, routeLen = 0, linkLen = 0;
  if (recipeId) {
    const b = await supabase.from('bom_headers').select('id').eq('generated_from_recipe_id', recipeId);
    bomLen = (b.data || []).length;
  }
  if (setId) {
    const rt = await supabase.from('routing_headers').select('id').eq('item_id', setId);
    routeLen = (rt.data || []).length;
    const lk = await supabase.from('fg_sfg_item_links').select('id').eq('fg_item_id', setId);
    linkLen = (lk.data || []).length;
  }
  ok(bomLen === 0, 'no BOM generated from this recipe (not activated)');
  ok(routeLen === 0, 'no routing_headers for VO101S');
  ok(linkLen === 0, 'no fg_sfg_item_links for VO101S');
  ok(r2.data.not_written.includes('recipe_activation') && r2.data.not_written.includes('bom') && r2.data.not_written.includes('routing') && r2.data.not_written.includes('fg_sfg_links') && r2.data.not_written.includes('inventory'), 'response declares activation/bom/routing/links/inventory not written');

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Generate button remains DISABLED (frontend not wired).');
  L('Cleanup (manual, review first): DELETE FROM stage_recipe_inputs WHERE step_id IN (SELECT id FROM stage_recipe_steps WHERE recipe_id=(SELECT id FROM stage_recipe_headers WHERE recipe_code=\'SR-VO101S\')); ' +
    'DELETE FROM stage_recipe_steps WHERE recipe_id=(SELECT id FROM stage_recipe_headers WHERE recipe_code=\'SR-VO101S\'); ' +
    'DELETE FROM stage_recipe_headers WHERE recipe_code=\'SR-VO101S\';');
  process.exit(fail === 0 ? 0 : 1);
}

main();
