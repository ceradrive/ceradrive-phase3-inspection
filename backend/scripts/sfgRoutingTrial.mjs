/**
 * CERADRIVE ERP — 2A-2-zeta ROUTING-only Trial (local validation)
 *
 * Calls commitRouting() directly (no auth route, no UI).
 * Enables SFG_ROUTING_COMMIT_ENABLED=true in-process only (committed flag stays false).
 * Creates routing_headers/routing_steps only. No items/recipe/BOM changes, no links/inventory.
 * No schema. No git ops.
 *
 * Run:  node backend/scripts/sfgRoutingTrial.mjs
 * Pre-req: alpha items + gamma draft + delta active recipe + epsilon BOM exist.
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
  process.env.SFG_ROUTING_COMMIT_ENABLED = 'true'; // runtime-only enable

  let supabase, commitRouting, routingCommitEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ commitRouting, routingCommitEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const len = async (table, col, val) => { const { data } = await supabase.from(table).select('id').eq(col, val); return (data || []).length; };
  const imCount = async () => { const { data } = await supabase.from('item_master').select('id').eq('formulation_code', 'VO101S'); return (data || []).length; };

  L('=== 2A-2-zeta ROUTING-only TRIAL (VO101S) ===');
  L('routing flag (runtime): ' + routingCommitEnabled());

  const { data: recRows } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', RECIPE_CODE);
  const rec = recRows?.[0];
  if (!rec || rec.status !== 'active') { L('  PRE-REQ: SR-VO101S not active. Run gamma+delta first.'); process.exit(2); }
  const recipeId = rec.id;
  const bomBefore = await len('bom_headers', 'generated_from_recipe_id', recipeId);
  if (bomBefore < 1) { L('  PRE-REQ: BOM missing. Run epsilon first.'); process.exit(2); }

  const { data: setRows } = await supabase.from('item_master').select('id').eq('item_code', 'VO101S');
  const setId = setRows?.[0]?.id || null;

  const imBefore = await imCount();
  const stepsBefore = await len('stage_recipe_steps', 'recipe_id', recipeId);
  const rtBefore = setId ? await len('routing_headers', 'item_id', setId) : 0;
  L('\n[before] recipe steps=' + stepsBefore + ' bom_headers=' + bomBefore + ' routing_headers=' + rtBefore + ' item_master(formulation)=' + imBefore);

  L('\n[1] commitRouting run #1');
  const r1 = await commitRouting(VO101S, null);
  if (r1.error) { L('  ERROR ' + JSON.stringify(r1.error)); process.exit(2); }
  L('  ' + JSON.stringify(r1.data.routing));
  ok(r1.data.committed === true, 'committed = true');
  ok(['CREATED', 'USE_EXISTING'].includes(r1.data.routing.action), 'routing CREATED or USE_EXISTING');
  const rtAfter = setId ? await len('routing_headers', 'item_id', setId) : 0;
  ok(rtAfter >= 1, 'routing header present for VO101S');

  L('\n[2] re-run (idempotent)');
  const r2 = await commitRouting(VO101S, null);
  if (r2.error) { L('  ERROR ' + JSON.stringify(r2.error)); process.exit(2); }
  L('  ' + JSON.stringify(r2.data.routing));
  ok(r2.data.routing.action === 'USE_EXISTING', 're-run -> USE_EXISTING');
  ok((setId ? await len('routing_headers', 'item_id', setId) : 0) === rtAfter, 'no duplicate routing header');

  L('\n[3] item / recipe / BOM counts unchanged');
  ok((await imCount()) === imBefore, 'item_master unchanged');
  ok((await len('stage_recipe_steps', 'recipe_id', recipeId)) === stepsBefore, 'recipe steps unchanged');
  ok((await len('bom_headers', 'generated_from_recipe_id', recipeId)) === bomBefore, 'bom_headers unchanged');

  L('\n[4] no FG-SFG links');
  const linkLen = setId ? await len('fg_sfg_item_links', 'fg_item_id', setId) : 0;
  ok(linkLen === 0, 'no fg_sfg_item_links for VO101S');
  ok(r2.data.not_written.includes('fg_sfg_links') && r2.data.not_written.includes('inventory') && r2.data.not_written.includes('items') && r2.data.not_written.includes('bom') && r2.data.not_written.includes('recipe'), 'not_written declares items/recipe/bom/links/inventory');

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Generate button remains DISABLED (frontend not wired).');
  L('Rollback (manual, review first): DELETE FROM routing_steps WHERE routing_header_id IN (SELECT id FROM routing_headers WHERE item_id=(SELECT id FROM item_master WHERE item_code=\'VO101S\')); ' +
    'DELETE FROM routing_headers WHERE item_id=(SELECT id FROM item_master WHERE item_code=\'VO101S\');');
  process.exit(fail === 0 ? 0 : 1);
}

main();
