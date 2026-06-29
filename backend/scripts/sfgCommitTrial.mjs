/**
 * CERADRIVE ERP — 2A-2 ITEMS-only Commit Trial (local validation)
 *
 * Calls commitBuild() DIRECTLY against the existing backend service/config.
 * Bypasses the auth-protected HTTP route and the frontend UI.
 *
 * Enables the commit flag ONLY at runtime (sets SFG_COMMIT_ENABLED=true in-process),
 * so the committed featureFlags.sfg_commit_enabled stays false.
 *
 * Writes: item_master rows only (via commitBuild). Verifies NO recipe/BOM/routing/link rows.
 * No schema. No git ops.
 *
 * Run:  node backend/scripts/sfgCommitTrial.mjs
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

// VO101S authoring payload (matches preview contract). Machine id is a placeholder:
// items-only commit does not require a real machine (machine only affects time display).
const VO101S = {
  sku_code: 'VO101S', sku_name: 'VO Front Brake Pad Set', product_family: 'VO',
  pcs_per_set: 4, compound_weight_g: 95, mix_formula_code: 'MIX-VO-726',
  bp_mode: 'SAME', bp_variants: [{ variant_code: 'SAME', bp_item_code: 'BP101', qty_per_set: 4, bp_weight_g: 95 }],
  allowed_machine_ids: [process.env.TRIAL_MACHINE_ID || 'preview-machine'],
  preferred_machine_id: process.env.TRIAL_MACHINE_ID || 'preview-machine',
  die_code: 'D-101', die_cavities: 8, moulding_cycle_time_sec: 300, moulding_setup_time_min: 20,
  acbp_pcs_per_tray: 40, acbp_tray_cycle_sec: 60,
  pwc_pcs_per_tray: 36, pwc_tray_cycle_sec: 90,
  cur_pcs_per_tray: 72, cur_trays_per_batch: 12, cur_cycle_time_min: 40,
  grinding_pcs_per_hour: 480, stacking_pcs_per_hour: 600, pcs_per_crate: 200,
  shot_blast_batch_kg: 50, shot_blast_cycle_sec: 600,
};

const CODES = ['VO101S', 'VO_PF101S', 'VO_SBBP101S', 'VO_ACBP101S', 'VO_MLD101S', 'VO_GRD101S', 'VO_PWC101S', 'VO_CUR101S', 'VO_STK101S'];

function L(s = '') { process.stdout.write(s + '\n'); }

async function main() {
  await loadEnv();
  // runtime-only enable (NOT the committed flag)
  process.env.SFG_COMMIT_ENABLED = 'true';

  let supabase, commitBuild, commitEnabled;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
    ({ commitBuild, commitEnabled } = await import('../src/services/sfgBuildOrchestratorService.js'));
  } catch (e) { L('IMPORT ERROR: ' + (e?.message || e) + ` (env: ${ENV_PATH})`); process.exit(2); }

  let fail = 0; const ok = (c, m) => { L((c ? '  OK  ' : '  FAIL') + ' ' + m); if (!c) fail++; };

  async function countCodes() {
    const { data, error } = await supabase.from('item_master').select('id, item_code, stage_type, is_sellable, is_active').in('item_code', CODES);
    if (error) throw error;
    return new Map((data || []).map((r) => [String(r.item_code).toUpperCase(), r]));
  }

  L('=== 2A-2 ITEMS-only COMMIT TRIAL (VO101S) ===');
  L('commit flag (runtime): ' + commitEnabled());

  // 1) BEFORE counts
  const before = await countCodes();
  L('\n[1] BEFORE item_master present:');
  for (const c of CODES) L(`  ${c}: ${before.has(c.toUpperCase()) ? 'EXISTS' : 'absent'}`);

  // 2) commit
  L('\n[2] commitBuild run #1');
  const r1 = await commitBuild(VO101S, null);
  if (r1.error) { L('  ERROR ' + JSON.stringify(r1.error)); process.exit(2); }
  L('  summary: ' + JSON.stringify(r1.data.summary) + ' committed=' + r1.data.committed);
  for (const it of r1.data.items) L(`    ${it.action.padEnd(12)} ${it.item_code}${it.reason ? '  (' + it.reason + ')' : ''}`);

  // 3) AFTER counts — created only in item_master
  const after = await countCodes();
  L('\n[3] AFTER item_master present:');
  for (const c of CODES) L(`  ${c}: ${after.has(c.toUpperCase()) ? 'EXISTS' : 'absent'}`);
  ok(CODES.every((c) => after.has(c.toUpperCase())), 'all 9 codes exist in item_master after commit');
  const setRow = after.get('VO101S');
  ok(setRow && setRow.is_sellable === true, 'VO101S is FG/sellable');

  // 4) re-run
  L('\n[4] commitBuild run #2 (same payload)');
  const r2 = await commitBuild(VO101S, null);
  if (r2.error) { L('  ERROR ' + JSON.stringify(r2.error)); process.exit(2); }
  L('  summary: ' + JSON.stringify(r2.data.summary));

  // 5) no duplicates; statuses use-existing
  const after2 = await countCodes();
  ok(r2.data.summary.created === 0, 're-run created = 0');
  ok(r2.data.summary.use_existing === 9, 're-run use_existing = 9');
  ok(after2.size === after.size && after2.size === 9, 'no duplicate item_master rows (still 9 by code)');

  // 6) no recipe / BOM / routing / link rows for VO101S
  L('\n[6] verify NO recipe/BOM/routing/link rows');
  const setId = setRow?.id;
  const noRecipe = await supabase.from('stage_recipe_headers').select('id').eq('recipe_code', 'SR-VO101S');
  ok(!noRecipe.error && (noRecipe.data || []).length === 0, 'no stage_recipe_headers SR-VO101S');
  let routingLen = 0, linkLen = 0;
  if (setId) {
    const rt = await supabase.from('routing_headers').select('id').eq('item_id', setId);
    routingLen = (rt.data || []).length;
    const lk = await supabase.from('fg_sfg_item_links').select('id').eq('fg_item_id', setId);
    linkLen = (lk.data || []).length;
  }
  ok(routingLen === 0, 'no routing_headers for VO101S');
  ok(linkLen === 0, 'no fg_sfg_item_links for VO101S');
  ok(r2.data.not_written.includes('stage_recipe') && r2.data.not_written.includes('routing') && r2.data.not_written.includes('fg_sfg_links') && r2.data.not_written.includes('bom') && r2.data.not_written.includes('inventory'), 'response declares recipe/bom/routing/links/inventory not written');

  L('\n[counts] item_master rows matching the 9 codes: before=' + before.size + ' afterRun1=' + after.size + ' afterRun2=' + after2.size);
  L('\nVERDICT: ' + (fail === 0 ? 'PASS' : 'FAIL (' + fail + ')'));
  L('Generate button remains DISABLED (frontend not wired to /build).');
  L('Cleanup (if needed, run manually): UPDATE item_master SET is_active=false WHERE formulation_code=\'VO101S\' AND stage_type<>\'SET\'; -- review before running');
  process.exit(fail === 0 ? 0 : 1);
}

main();
