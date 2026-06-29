import { supabase } from '../config/supabase.js';

function cleanSearch(value) {
  return String(value || '').trim().slice(0, 80).replace(/[,%_()."'\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function deriveCoreCode(fgCode) {
  return String(fgCode || '').trim().toUpperCase().replace(/^[A-Z]+/, '');
}

function itemName(fg, stage, variant) {
  const suffix = variant === 'I' ? ' Inner' : variant === 'O' ? ' Outer' : '';
  return `${fg.item_code} ${stage.stage_name}${suffix}`;
}

function variantRows(sameBp, template) {
  if (!template.applies_to_variants) return [{ variant_code: null, qty_per_set: null, label: '' }];
  if (sameBp) return [{ variant_code: null, qty_per_set: template.stage_code === 'BP' ? 4 : null, label: '' }];
  return [
    { variant_code: 'I', qty_per_set: template.stage_code === 'BP' ? 2 : null, label: 'I' },
    { variant_code: 'O', qty_per_set: template.stage_code === 'BP' ? 2 : null, label: 'O' },
  ];
}

function stageItemMeta(stageCode) {
  if (stageCode === 'BP') {
    return {
      item_type_code: 'RM',
      category_code: 'BACK_PLATE',
      is_purchasable: true,
      is_sellable: false,
      is_manufactured: false,
      is_stocked: true,
      make_policy: null,
    };
  }

  return {
    item_type_code: 'SFG',
    category_code: stageCode === 'PF' ? 'PREFORM' : 'SFG',
    is_purchasable: false,
    is_sellable: false,
    is_manufactured: true,
    is_stocked: true,
    make_policy: 'MAKE_TO_STOCK',
  };
}

async function lookupMaps() {
  const [typesRes, catsRes, uomsRes] = await Promise.all([
    supabase.from('item_types').select('id,type_code').eq('is_active', true),
    supabase.from('item_categories').select('id,category_code').eq('is_active', true),
    supabase.from('uom_master').select('id,uom_code').eq('is_active', true),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (catsRes.error) throw catsRes.error;
  if (uomsRes.error) throw uomsRes.error;

  return {
    typeByCode: new Map((typesRes.data || []).map(x => [String(x.type_code).toUpperCase(), x.id])),
    catByCode: new Map((catsRes.data || []).map(x => [String(x.category_code).toUpperCase(), x.id])),
    uomByCode: new Map((uomsRes.data || []).map(x => [String(x.uom_code).toUpperCase(), x.id])),
  };
}

export async function searchFgItems({ search, limit = 20 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 50);
  let q = supabase
    .from('item_master')
    .select('id,item_code,item_name,uom_id,stage_type,is_sellable,is_active')
    .eq('is_active', true)
    .or('stage_type.eq.FG,is_sellable.eq.true')
    .order('item_code', { ascending: true })
    .limit(safeLimit);

  const s = cleanSearch(search);
  if (s) q = q.or(`item_code.ilike.%${s}%,item_name.ilike.%${s}%`);

  const { data, error } = await q;
  return { data: data || [], error };
}

export async function listTemplates() {
  const { data, error } = await supabase
    .from('sfg_stage_templates')
    .select('id,stage_code,stage_name,item_code_prefix,stage_type,default_uom_code,seq_no,creates_sfg,default_enabled,applies_to_variants,is_active')
    .eq('is_active', true)
    .order('seq_no', { ascending: true });

  return { data: data || [], error };
}

async function buildPreview(body) {
  const fgItemId = body?.fg_item_id;
  if (!fgItemId) throw { code: 'VALIDATION_ERROR', message: 'FG item is required.' };

  const sameBp = body.same_bp !== false;
  const selected = Array.isArray(body.stage_codes) ? body.stage_codes.map(x => String(x).toUpperCase()) : [];

  const { data: fg, error: fgErr } = await supabase
    .from('item_master')
    .select('id,item_code,item_name,uom_id,stage_type,is_sellable')
    .eq('id', fgItemId)
    .maybeSingle();

  if (fgErr) throw fgErr;
  if (!fg) throw { code: 'NOT_FOUND', message: 'FG item not found.' };

  const templatesRes = await listTemplates();
  if (templatesRes.error) throw templatesRes.error;

  const templates = (templatesRes.data || []).filter(t => selected.length ? selected.includes(t.stage_code) : t.default_enabled);
  if (!templates.length) throw { code: 'VALIDATION_ERROR', message: 'Select at least one stage.' };

  const core = deriveCoreCode(fg.item_code);
  if (!core) throw { code: 'VALIDATION_ERROR', message: 'FG item code must contain a numeric/model suffix, e.g. VO101S.' };

  const generated = [];
  for (const t of templates) {
    for (const v of variantRows(sameBp, t)) {
      const code = `${t.item_code_prefix}${core}${v.label}`.toUpperCase();
      generated.push({
        item_code: code,
        item_name: itemName(fg, t, v.variant_code),
        fg_item_id: fg.id,
        fg_item_code: fg.item_code,
        stage_template_id: t.id,
        stage_code: t.stage_code,
        stage_name: t.stage_name,
        stage_type: t.stage_type,
        default_uom_code: t.default_uom_code,
        variant_code: v.variant_code,
        qty_per_set: v.qty_per_set,
        ...stageItemMeta(t.stage_code),
      });
    }
  }

  const codes = [...new Set(generated.map(x => x.item_code))];
  const { data: existing, error: exErr } = codes.length
    ? await supabase.from('item_master').select('id,item_code,item_name,stage_type').in('item_code', codes)
    : { data: [], error: null };

  if (exErr) throw exErr;

  const existingByCode = new Map((existing || []).map(x => [x.item_code, x]));
  const rows = generated.map(row => {
    const found = existingByCode.get(row.item_code);
    return {
      ...row,
      exists: Boolean(found),
      existing_item_id: found?.id || null,
      action: found ? 'USE_EXISTING' : 'CREATE',
    };
  });

  return { fg, same_bp: sameBp, rows };
}

export async function previewSfgItems(body) {
  try {
    return { data: await buildPreview(body), error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function createSfgItems(body, userId) {
  try {
    const preview = await buildPreview(body);
    const maps = await lookupMaps();

    const created = [];
    const usedExisting = [];

    for (const row of preview.rows) {
      let itemId = row.existing_item_id;

      if (!itemId) {
        const itemTypeId = maps.typeByCode.get(row.item_type_code);
        const categoryId = maps.catByCode.get(row.category_code);
        const uomId = maps.uomByCode.get(String(row.default_uom_code).toUpperCase());

        if (!itemTypeId) throw { code: 'VALIDATION_ERROR', message: `Item type missing: ${row.item_type_code}` };
        if (!categoryId) throw { code: 'VALIDATION_ERROR', message: `Item category missing: ${row.category_code}` };
        if (!uomId) throw { code: 'VALIDATION_ERROR', message: `UOM missing: ${row.default_uom_code}` };

        const { data: inserted, error: insErr } = await supabase
          .from('item_master')
          .insert({
            item_code: row.item_code,
            item_name: row.item_name,
            item_type_id: itemTypeId,
            category_id: categoryId,
            uom_id: uomId,
            purchase_uom_id: row.is_purchasable ? uomId : null,
            sales_uom_id: null,
            is_active: true,
            is_purchasable: row.is_purchasable,
            is_sellable: row.is_sellable,
            is_manufactured: row.is_manufactured,
            is_stocked: row.is_stocked,
            make_policy: row.make_policy,
            planning_unit: row.default_uom_code,
            stage_type: row.stage_type,
            formulation_code: preview.fg.item_code,
            notes: `Auto-created from SFG Builder for ${preview.fg.item_code}`,
            created_by: userId,
          })
          .select('id,item_code,item_name')
          .single();

        if (insErr) {
          if (insErr.code === '23505') {
            const { data: fallback, error: fbErr } = await supabase
              .from('item_master')
              .select('id,item_code,item_name')
              .eq('item_code', row.item_code)
              .maybeSingle();
            if (fbErr) throw fbErr;
            if (!fallback) throw insErr;
            itemId = fallback.id;
            usedExisting.push({ ...row, existing_item_id: itemId });
          } else {
            throw insErr;
          }
        } else {
          itemId = inserted.id;
          created.push({ ...row, existing_item_id: itemId });
        }
      } else {
        usedExisting.push(row);
      }

      row.final_item_id = itemId;
    }

    const linkRows = preview.rows
      .filter(row => row.final_item_id)
      .map(row => ({
        fg_item_id: preview.fg.id,
        sfg_item_id: row.final_item_id,
        stage_template_id: row.stage_template_id,
        stage_code: row.stage_code,
        variant_code: row.variant_code,
        qty_per_set: row.qty_per_set,
        created_by: userId,
      }));

    if (linkRows.length) {
      const { error: linkErr } = await supabase
        .from('fg_sfg_item_links')
        .upsert(linkRows, { onConflict: 'fg_item_id,sfg_item_id' });

      if (linkErr) throw linkErr;
    }

    return {
      data: {
        fg: preview.fg,
        created_count: created.length,
        existing_count: usedExisting.length,
        linked_count: linkRows.length,
        created,
        existing: usedExisting,
        rows: preview.rows,
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err };
  }
}
