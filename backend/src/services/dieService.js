import { supabase } from '../config/supabase.js';
function sanitizeOrSearch(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replace(/[,%_()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function clean(v) { return typeof v === 'string' ? v.trim() : v; }
function nullable(v) { return v === undefined || v === null || v === '' ? null : v; }
function num(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw { code: 'VALIDATION_ERROR', message: 'Cavity count must be greater than 0.' };
  return n;
}

export async function listDies({ search, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const from = (Number(page) - 1) * safeLimit;
  const to = from + safeLimit - 1;

  let q = supabase.from('die_master')
    .select('id, die_code, die_name, status, is_active, num_impressions, die_type, material, notes', { count: 'exact' })
    .order('die_code', { ascending: true })
    .range(from, to);

  const safeSearch = sanitizeOrSearch(search);
  if (safeSearch) q = q.or(`die_code.ilike.%${safeSearch}%,die_name.ilike.%${safeSearch}%`);

  const { data, error, count } = await q;
  return { data: data ?? null, count, error };
}

export async function getDieById(id) {
  const { data, error } = await supabase.from('die_master')
    .select('id, die_code, die_name, status, is_active, num_impressions, die_type, material, notes')
    .eq('id', id).maybeSingle();
  return { data: data ?? null, error };
}

export async function createDie(body, userId) {
  try {
    const payload = {
      die_code: clean(body.die_code || '').toUpperCase(),
      die_name: clean(body.die_name || ''),
      status: clean(body.status || 'active'),
      is_active: body.is_active !== false,
      num_impressions: num(body.num_impressions),
      die_type: nullable(clean(body.die_type || '')),
      material: nullable(clean(body.material || '')),
      notes: nullable(clean(body.notes || '')),
      created_by: userId,
    };
    if (!payload.die_code) throw { code: 'VALIDATION_ERROR', message: 'Die code is required.' };
    if (!payload.die_name) throw { code: 'VALIDATION_ERROR', message: 'Die name is required.' };

    const { data, error } = await supabase.from('die_master').insert(payload).select('*').single();
    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

export async function updateDie(id, body, userId) {
  try {
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const payload = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    if (has('die_name')) {
      payload.die_name = clean(body.die_name || '');
      if (!payload.die_name) throw { code: 'VALIDATION_ERROR', message: 'Die name is required.' };
    }
    if (has('status')) payload.status = clean(body.status || 'active');
    if (has('is_active')) payload.is_active = !(body.is_active === false || body.is_active === 0 || String(body.is_active).toLowerCase() === 'false' || String(body.is_active) === '0');
    if (has('num_impressions')) payload.num_impressions = num(body.num_impressions);
    if (has('die_type')) payload.die_type = nullable(clean(body.die_type || ''));
    if (has('material')) payload.material = nullable(clean(body.material || ''));
    if (has('notes')) payload.notes = nullable(clean(body.notes || ''));

    const { data, error } = await supabase.from('die_master').update(payload).eq('id', id).select('*').single();
    return { data, error };
  } catch (error) {
    return { data: null, error };
  }
}

// ── Die ↔ compatible output items (source for Press Planner cavity) ───────────
// Reads die_compatibility (item_id, die_id, is_preferred, is_active) and joins
// item_master in a second query (no PostgREST embed dependency).
export async function getDieItems(dieId) {
  const { data: compat, error } = await supabase
    .from('die_compatibility')
    .select('item_id, is_preferred, is_active')
    .eq('die_id', dieId)
    .eq('is_active', true);
  if (error) return { data: null, error };

  const ids = [...new Set((compat ?? []).map((c) => c.item_id).filter(Boolean))];
  let itemsById = new Map();
  if (ids.length) {
    const { data: masters, error: mErr } = await supabase
      .from('item_master')
      .select('id, item_code, item_name, stage_type')
      .in('id', ids);
    if (mErr) return { data: null, error: mErr };
    itemsById = new Map((masters ?? []).map((m) => [m.id, m]));
  }

  // De-duplicate by item_id (a die may have one row per machine it is mounted on).
  const seen = new Set();
  const rows = [];
  for (const c of compat ?? []) {
    if (seen.has(c.item_id)) continue;
    seen.add(c.item_id);
    const m = itemsById.get(c.item_id) || {};
    rows.push({
      item_id: c.item_id,
      item_code: m.item_code ?? null,
      item_name: m.item_name ?? null,
      stage_type: m.stage_type ?? null,
    });
  }
  return { data: rows, error: null };
}

// Replace-all sync of a die's compatible output items.
// Business rule: STK output items must NOT be linked to a die (no die/cavity).
export async function syncDieItems(dieId, items) {
  try {
    const list = Array.isArray(items) ? items.filter((x) => x && x.item_id) : [];
    const itemIds = [...new Set(list.map((x) => x.item_id))];

    if (itemIds.length) {
      const { data: masters, error: mErr } = await supabase
        .from('item_master')
        .select('id, item_code, stage_type')
        .in('id', itemIds);
      if (mErr) return { data: null, error: mErr };
      const blocked = (masters ?? []).filter(
        (m) => String(m.stage_type || '').toUpperCase() === 'STK'
      );
      if (blocked.length) {
        return {
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: `STK items cannot be linked to a die: ${blocked.map((b) => b.item_code).join(', ')}`,
          },
        };
      }
    }

    // machine_id is NOT NULL on die_compatibility. A die's machine(s) come from
    // moulding_slot_setups (this die mounted in slot A or slot B of a machine).
    const [slotA, slotB] = await Promise.all([
      supabase.from('moulding_slot_setups').select('machine_id').eq('is_active', true).eq('slot_a_die_id', dieId),
      supabase.from('moulding_slot_setups').select('machine_id').eq('is_active', true).eq('slot_b_die_id', dieId),
    ]);
    if (slotA.error) return { data: null, error: slotA.error };
    if (slotB.error) return { data: null, error: slotB.error };
    const machineIds = [...new Set(
      [...(slotA.data ?? []), ...(slotB.data ?? [])].map((s) => s.machine_id).filter(Boolean)
    )];

    if (itemIds.length && !machineIds.length) {
      return {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'This die is not mounted on any moulding machine slot yet. Configure it in Moulding Slot Setup before linking items.',
        },
      };
    }

    const del = await supabase.from('die_compatibility').delete().eq('die_id', dieId);
    if (del.error) return { data: null, error: del.error };

    if (!itemIds.length) return { data: [], error: null };

    // One compatibility row per (item, machine). Multiple items per die allowed.
    const rows = [];
    for (const itemId of itemIds) {
      for (const machineId of machineIds) {
        rows.push({ die_id: dieId, machine_id: machineId, item_id: itemId, is_preferred: false, is_active: true });
      }
    }

    const { error: insErr } = await supabase.from('die_compatibility').insert(rows);
    if (insErr) return { data: null, error: insErr };

    return await getDieItems(dieId);
  } catch (error) {
    return { data: null, error };
  }
}
