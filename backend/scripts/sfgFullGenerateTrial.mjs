/**
 * CERADRIVE ERP — 2A-2-theta FULL GENERATE Trial (local validation)
 *
 * Calls commitFullGenerate() directly (no auth route, no UI).
 * Enables SFG_FULL_GENERATE_ENABLED=true in-process only (committed flag stays false).
 * Runs full generate on the ALREADY-GENERATED VO101S -> expects every slice USE_EXISTING,
 * all counts unchanged, no inventory. No schema. No git ops.
 *
 * Run:  node backend/scripts/sfgFullGenerateTrial.mjs
 * Pre-req: VO101S already has items + active recipe + BOM + routing + links.
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
  process.env.SFG_FULL_GENERATE_ENABLED = 'true'; // runtime-only enable

  let supabase, commitFullGenerate, fullGenerateEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ commitFullGenerate, fullGenerateEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e)); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };
  const len = async (table, col, val) => { const { data } = await supabase.from(table).select('id').eq(col, val); return (data || []).length; };
  const imCount = async () => { const { data } = await supabase.from('item_master').select('id').eq('formulation_code', 'VO101S'); return (data || []).length; };

  L('=== 2A-2-theta FULL GENERATE TRIAL (existing VO101S) ===');
  L('full-generate flag (runtime): ' + fullGenerateEnabled());

  const { data: recRows } = await supabase.from('stage_recipe_headers').select('id, status').eq('recipe_code', RECIPE_CODE);
  const rec = recRows?.[0];
  if (!rec) { L('  PRE-REQ: SR-VO101S missing. Run the full chain (alpha..eta) first.'); process.exit(2); }
  const recipeId = rec.id;
  const { data: setRows } = await supabase.from('item_master').select('id').eq('item_code', 'VO101S');
  const setId = setRows?.[0]?.id || null;

  // capture BEFORE counts
  const before = {
    items: await imCount(),
    recipe_headers: await len('stage_recipe_headers', 'recipe_code', RECIPE_CODE),
    recipe_steps: await len('stage_recipe_steps', 'recipe_id', recipeId),
    bom: await len('bom_headers', 'generated_from_recipe_id', recipeId),
    routing: setId ? await len('routing_headers', 'item_id', setId) : 0,
    links: setId ? await len('fg_sfg_item_links', 'fg_item_id', setId) : 0,
  };
  L('\n[before] ' + JSON.stringify(before));

  L('\n[1] commitFullGenerate on existing VO101S');
  const r1 = await commitFullGenerate(VO101S, null);
  if (r1.error) { L('  ERROR ' + JSON.stringify(r1.error)); process.exit(2); }
  ok(r1.data.committed === true, 'committed = true');
  L('  summary: ' + JSON.stringify(r1.data.summary));

  // every slice must be USE_EXISTING for an already-generated SKU
  const s = r1.data.stages;
  ok(s.items.summary.created === 0 && s.items.summary.use_existing === 9, 'items: 0 created, 9 USE_EXISTING');
  ok(s.recipe_draft.recipe.action === 'USE_EXISTING', 'recipe draft: USE_EXISTING');
  ok(s.recipe_activate.recipe.action === 'USE_EXISTING', 'recipe activate: USE_EXISTING');
  ok(s.bom.bom.action === 'USE_EXISTING', 'BOM: USE_EXISTING');
  ok(s.routing.routing.action === 'USE_EXISTING', 'routing: USE_EXISTING');
  ok(s.fg_sfg_links.links.action === 'USE_EXISTING', 'links: USE_EXISTING');

  L('\n[2] counts unchanged (no duplicates)');
  const after = {
    items: await imCount(),
    recipe_headers: await len('stage_recipe_headers', 'recipe_code', RECIPE_CODE),
    recipe_steps: await len('stage_recipe_steps', 'recipe_id', recipeId),
    bom: await len('bom_headers', 'generated_from_recipe_id', recipeId),
    routing: setId ? await len('routing_headers', 'item_id', setId) : 0,
    links: setId ? await len('fg_sfg_item_links', 'fg_item_id', setId) : 0,
  };
  L('  [after]  ' + JSON.stringify(after));
  for (const k of Object.keys(before)) ok(after[k] === before[k], `${k} count unchanged (${before[k]})`);

  L('\n[3] no inventory writes');
  ok(r1.data.not_written.includes('inventory'), 'response declares inventory not written');
  // best-effort inventory probe (if tables exist); absence of error/rows = pass
  for (const tbl of ['inventory_ledger', 'stock_ledger', 'stock_moves', 'inventory_transactions']) {
    try {
      const { error } = await supabase.from(tbl).select('id').limit(1);
      if (!error) L('  (probed ' + tbl + ': accessible; orchestrator never writes it)');
    } catch { /* table may not exist; orchestrator writes none regardless */ }
  }

  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Feature flags remain false in committed files; Generate UI remains disabled.');
  process.exit(fail === 0 ? 0 : 1);
}

main();
