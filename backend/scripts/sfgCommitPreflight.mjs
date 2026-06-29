/**
 * CERADRIVE ERP — P-SFG-2A-2 Commit Preflight (READ-ONLY)
 *
 * Loads backend/.env explicitly BEFORE importing the Supabase config, so it works
 * when run from the repo root (node backend/scripts/sfgCommitPreflight.mjs).
 *
 * SELECT-only. No insert/update/delete/upsert/rpc. No schema. No route. No git ops.
 * Run:  node backend/scripts/sfgCommitPreflight.mjs
 * Exit: 0 = PASS, 1 = FAIL, 2 = query/config error.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // backend/scripts
const ENV_PATH = resolve(HERE, '../.env');            // backend/.env (cwd-independent)

// Load backend/.env: prefer dotenv; fall back to a tiny parser if dotenv is absent.
async function loadEnv() {
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: ENV_PATH });
    return;
  } catch {
    // dotenv not installed -> minimal manual parse (read-only file read)
  }
  try {
    const raw = readFileSync(ENV_PATH, 'utf8');
    for (const lineRaw of raw.split('\n')) {
      const line = lineRaw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // no .env file (e.g. offline sample harness with a stub client) -> continue
  }
}

const REQUIRED_PROCESS_CODES = [
  'PREFORMING', 'SHOT_BLASTING', 'ADHESIVE_COATING', 'MOULDING', 'GRINDING',
  'POWDER_COATING', 'CURING', 'STACKING', 'PRINTING', 'RIVETING', 'SHRINK_WRAP', 'PACKING',
];
const REQUIRED_UOM = ['KG', 'PCS'];
const REQUIRED_ITEM_TYPES = ['SFG', 'FG', 'RM'];
const REQUIRED_CATEGORIES = ['SFG', 'PREFORM'];
const VO_GEN_CODES = [
  ['VO_PF101S', 'PF'], ['VO_SBBP101S', 'SBBP'], ['VO_ACBP101S', 'ACBP'], ['VO_MLD101S', 'MLD'],
  ['VO_GRD101S', 'GRD'], ['VO_PWC101S', 'PWC'], ['VO_CUR101S', 'CUR'], ['VO_STK101S', 'STK'],
];

const up = (v) => String(v ?? '').trim().toUpperCase();

function makeSel(supabase) {
  return async function sel(table, cols, filter) {
    let q = supabase.from(table).select(cols);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw { where: table, error };
    return data || [];
  };
}

export async function runPreflight(supabase) {
  const sel = makeSel(supabase);
  const report = { ok: true, sections: {}, missing: [], resolved: {}, collisions: [] };
  const fail = (msg) => { report.ok = false; report.missing.push(msg); };

  // 1) process_types
  const pts = await sel('process_types', 'id, type_code, type_name, seq_no, is_active', (q) => q.eq('is_active', true));
  const ptByCode = new Map(pts.map((r) => [up(r.type_code), r]));
  const ptResult = REQUIRED_PROCESS_CODES.map((c) => ({ code: c, present: ptByCode.has(c), id: ptByCode.get(c)?.id ?? null }));
  report.sections.process_types = ptResult;
  for (const r of ptResult) if (!r.present) fail(`process_types missing: ${r.code}`);
  report.resolved.process_type_ids = Object.fromEntries(ptResult.filter((r) => r.present).map((r) => [r.code, r.id]));

  // 2) routing_types
  const rts = await sel('routing_types', 'id, type_code, type_name, is_active', (q) => q.eq('is_active', true));
  report.sections.routing_types = rts.map((r) => ({ id: r.id, code: r.type_code, name: r.type_name }));
  const prefer = /FINAL|PAD|SFG|FG|MANUF|PROD/i;
  const recommended = rts.find((r) => prefer.test(`${r.type_code} ${r.type_name}`)) || rts[0] || null;
  report.resolved.recommended_routing_type = recommended ? { id: recommended.id, code: recommended.type_code } : null;
  if (!recommended) fail('routing_types: no active routing type available');

  // 3) uom_master
  const uoms = await sel('uom_master', 'id, uom_code, is_active', (q) => q.eq('is_active', true));
  const uomByCode = new Map(uoms.map((r) => [up(r.uom_code), r.id]));
  report.sections.uom = REQUIRED_UOM.map((c) => ({ code: c, present: uomByCode.has(c), id: uomByCode.get(c) ?? null }));
  for (const c of REQUIRED_UOM) if (!uomByCode.has(c)) fail(`uom_master missing: ${c}`);
  report.resolved.uom_ids = Object.fromEntries(REQUIRED_UOM.filter((c) => uomByCode.has(c)).map((c) => [c, uomByCode.get(c)]));

  // 4) item_types + item_categories
  const its = await sel('item_types', 'id, type_code, is_active', (q) => q.eq('is_active', true));
  const itByCode = new Map(its.map((r) => [up(r.type_code), r.id]));
  report.sections.item_types = REQUIRED_ITEM_TYPES.map((c) => ({ code: c, present: itByCode.has(c), id: itByCode.get(c) ?? null }));
  for (const c of REQUIRED_ITEM_TYPES) if (!itByCode.has(c)) fail(`item_types missing: ${c}`);
  report.resolved.item_type_ids = Object.fromEntries(REQUIRED_ITEM_TYPES.filter((c) => itByCode.has(c)).map((c) => [c, itByCode.get(c)]));

  const cats = await sel('item_categories', 'id, category_code, is_active', (q) => q.eq('is_active', true));
  const catByCode = new Map(cats.map((r) => [up(r.category_code), r.id]));
  report.sections.item_categories = REQUIRED_CATEGORIES.map((c) => ({ code: c, present: catByCode.has(c), id: catByCode.get(c) ?? null }));
  for (const c of REQUIRED_CATEGORIES) if (!catByCode.has(c)) fail(`item_categories missing: ${c}`);
  const fgCat = ['FG', 'FINISHED_GOOD', 'FINISHED'].find((c) => catByCode.has(c)) || null;
  report.sections.item_categories_fg_optional = fgCat ? { code: fgCat, id: catByCode.get(fgCat) } : null;
  report.resolved.category_ids = Object.fromEntries(REQUIRED_CATEGORIES.filter((c) => catByCode.has(c)).map((c) => [c, catByCode.get(c)]));

  // 5) VO101S readiness
  const probe = ['MIX-VO-726', 'BP101', 'VO101S', ...VO_GEN_CODES.map(([c]) => c)];
  const rows = await sel('item_master', 'id, item_code, item_name, stage_type, item_type_id, is_purchasable, is_active', (q) => q.in('item_code', probe));
  const byCode = new Map(rows.map((r) => [up(r.item_code), r]));

  const mix = byCode.get('MIX-VO-726');
  const bp = byCode.get('BP101');
  const setItem = byCode.get('VO101S');
  const fgTypeId = itByCode.get('FG');

  const vo = { mix: null, bp: null, set: null, generated: [] };
  vo.mix = mix && mix.is_active !== false ? { present: true, id: mix.id } : { present: false };
  if (!vo.mix.present) fail('item_master missing/inactive: MIX-VO-726');

  vo.bp = bp && bp.is_active !== false ? { present: true, id: bp.id, purchasable: bp.is_purchasable === true } : { present: false };
  if (!vo.bp.present) fail('item_master missing/inactive: BP101');
  else if (!vo.bp.purchasable) fail('BP101 exists but is NOT purchasable (must be purchasable RM/BP)');

  if (setItem) {
    const okType = fgTypeId ? setItem.item_type_id === fgTypeId : true;
    const okStage = !setItem.stage_type || up(setItem.stage_type) === 'SET' || up(setItem.stage_type) === 'FG';
    vo.set = { present: true, id: setItem.id, type_ok: okType, stage_ok: okStage };
    if (!(okType && okStage)) { report.collisions.push(`VO101S exists with wrong type/stage (stage_type=${setItem.stage_type})`); report.ok = false; }
  } else {
    vo.set = { present: false, note: 'will be created as FG' };
  }

  for (const [code, expectStage] of VO_GEN_CODES) {
    const r = byCode.get(up(code));
    if (!r) { vo.generated.push({ code, action: 'CREATE' }); continue; }
    const okStage = up(r.stage_type) === expectStage;
    vo.generated.push({ code, action: okStage ? 'USE_EXISTING' : 'BLOCK', stage_type: r.stage_type, expected: expectStage });
    if (!okStage) { report.collisions.push(`${code} exists with wrong stage_type=${r.stage_type} (expected ${expectStage})`); report.ok = false; }
  }
  report.sections.vo101s = vo;

  report.items_alpha_safe = Boolean(
    itByCode.has('SFG') && itByCode.has('FG') &&
    catByCode.has('SFG') && catByCode.has('PREFORM') &&
    vo.bp.present && vo.bp.purchasable && vo.mix.present &&
    report.collisions.length === 0,
  );

  return report;
}

function line(s = '') { process.stdout.write(s + '\n'); }

async function main() {
  await loadEnv();

  let supabase;
  try {
    ({ supabase } = await import('../src/config/supabase.js'));
  } catch (e) {
    line('PREFLIGHT CONFIG ERROR: ' + (e?.message || String(e)));
    line(`(Checked env file: ${ENV_PATH}. Ensure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set there.)`);
    process.exit(2);
  }

  let report;
  try { report = await runPreflight(supabase); }
  catch (e) { line('PREFLIGHT QUERY ERROR: ' + JSON.stringify(e?.error || e)); process.exit(2); }

  line('=== P-SFG-2A-2 COMMIT PREFLIGHT (read-only) ===');
  line('\n[1] process_types');
  for (const r of report.sections.process_types) line(`  ${r.present ? 'OK ' : 'MISSING'} ${r.code}${r.id ? '  ' + r.id : ''}`);
  line('\n[2] routing_types (active)');
  for (const r of report.sections.routing_types) line(`  - ${r.code}  ${r.name}  ${r.id}`);
  line(`  RECOMMENDED routing_type_code: ${report.resolved.recommended_routing_type?.code ?? '(none)'}`);
  line('\n[3] uom_master');
  for (const r of report.sections.uom) line(`  ${r.present ? 'OK ' : 'MISSING'} ${r.code}${r.id ? '  ' + r.id : ''}`);
  line('\n[4] item_types');
  for (const r of report.sections.item_types) line(`  ${r.present ? 'OK ' : 'MISSING'} ${r.code}${r.id ? '  ' + r.id : ''}`);
  line('    item_categories');
  for (const r of report.sections.item_categories) line(`    ${r.present ? 'OK ' : 'MISSING'} ${r.code}${r.id ? '  ' + r.id : ''}`);
  line(`    FG category (optional): ${report.sections.item_categories_fg_optional?.code ?? '(none found)'}`);
  line('\n[5] VO101S readiness');
  line(`  MIX-VO-726: ${report.sections.vo101s.mix.present ? 'OK ' + report.sections.vo101s.mix.id : 'MISSING'}`);
  line(`  BP101: ${report.sections.vo101s.bp.present ? (report.sections.vo101s.bp.purchasable ? 'OK purchasable ' + report.sections.vo101s.bp.id : 'EXISTS but NOT purchasable') : 'MISSING'}`);
  line(`  VO101S (SET): ${report.sections.vo101s.set.present ? (report.sections.vo101s.set.type_ok && report.sections.vo101s.set.stage_ok ? 'OK ' + report.sections.vo101s.set.id : 'COLLISION wrong type/stage') : 'absent -> will create FG'}`);
  for (const g of report.sections.vo101s.generated) line(`  ${g.code}: ${g.action}${g.stage_type ? ' (has ' + g.stage_type + ', expected ' + g.expected + ')' : ''}`);

  if (report.missing.length) { line('\nMISSING MASTERS:'); for (const m of report.missing) line('  - ' + m); }
  if (report.collisions.length) { line('\nCOLLISIONS:'); for (const c of report.collisions) line('  - ' + c); }

  line(`\nVERDICT: ${report.ok ? 'PASS' : 'FAIL'}`);
  line(`2A-2-α ITEMS-only patch safe to build: ${report.items_alpha_safe ? 'YES' : 'NO'}`);
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
