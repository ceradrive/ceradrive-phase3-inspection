import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ROLES, ALL_ROLES } from '../constants/roles.js';
import { sendSuccess, sendError, ERROR_CODES } from '../utils/response.js';
import { createPurchaseOrder } from '../services/purchaseService.js';

const router = Router();

const WRITE_ROLES = [
  ROLES.ADMIN,
  ROLES.STORE_MANAGER,
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function money(n) {
  return Number(Number(n || 0).toFixed(4));
}


router.get('/', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('purchase_requirements')
    .select('id, pr_no, source_type, status, material_status, shortage_count, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return sendError(
      res,
      ERROR_CODES.INTERNAL_ERROR,
      error.message || 'Failed to list purchase requirements.',
      500
    );
  }

  return sendSuccess(res, data || []);
});


router.post('/:id/create-draft-pos', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const selectedLines = Array.isArray(req.body?.lines) ? req.body.lines : [];

  if (!selectedLines.length) {
    return sendError(res, ERROR_CODES.VALIDATION_ERROR, 'Select at least one PR line.', 400);
  }

  const lineIds = selectedLines.map((x) => x.line_id).filter(Boolean);

  const { data: prLines, error: lineErr } = await supabase
    .from('purchase_requirement_lines')
    .select('id, item_id, item_code, item_name, shortage_qty, uom_code, status, generated_po_id, generated_po_number')
    .eq('pr_id', req.params.id)
    .in('id', lineIds);

  if (lineErr) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, lineErr.message || 'Failed to load PR lines.', 500);
  }

  const uomCodes = Array.from(new Set((prLines || []).map((x) => x.uom_code).filter(Boolean)));

  const { data: uoms, error: uomErr } = await supabase
    .from('uom_master')
    .select('id,uom_code')
    .in('uom_code', uomCodes);

  if (uomErr) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, uomErr.message || 'Failed to load UOMs.', 500);
  }

  const uomByCode = new Map((uoms || []).map((x) => [x.uom_code, x]));
  const selectedByLineId = new Map(selectedLines.map((x) => [x.line_id, x]));
  const groups = new Map();

  for (const line of prLines || []) {
    if (line.status === 'po_drafted') continue;

    const selected = selectedByLineId.get(line.id);
    if (!selected?.supplier_id) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, `Supplier missing for ${line.item_code}.`, 400);
    }

    const uom = uomByCode.get(line.uom_code);
    if (!uom?.id) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, `UOM not found for ${line.item_code}: ${line.uom_code}`, 400);
    }

    const unitRate = money(selected.unit_rate || 0);
    // MOQ-OPT1: use the user's final ordered qty when provided; fall back to shortage. Must be > 0.
    if (selected.ordered_qty != null && !(Number(selected.ordered_qty) > 0)) {
      return sendError(res, ERROR_CODES.VALIDATION_ERROR, `Order qty must be greater than 0 for ${line.item_code}.`, 400);
    }
    const qty = (selected.ordered_qty != null && Number(selected.ordered_qty) > 0)
      ? money(selected.ordered_qty)
      : money(line.shortage_qty || 0);
    const lineAmount = money(qty * unitRate);

    const poLine = {
      item_id: line.item_id,
      uom_id: uom.id,
      ordered_qty: qty,
      unit_rate: unitRate,
      line_amount: lineAmount,
      tax_amount: 0,
      line_total: lineAmount,
      tax_id: null,
      tax_name: null,
      tax_percent: null,
      notes: `From PR shortage line ${line.item_code}`,
    };

    if (!groups.has(selected.supplier_id)) groups.set(selected.supplier_id, []);
    groups.get(selected.supplier_id).push({ pr_line_id: line.id, poLine });
  }

  if (groups.size === 0) {
    return sendError(
      res,
      ERROR_CODES.VALIDATION_ERROR,
      'Selected PR lines are already converted to Draft PO.',
      400
    );
  }

  const created = [];
  const originalLineState = new Map(
    (prLines || []).map((line) => [
      line.id,
      {
        status: line.status,
        generated_po_id: line.generated_po_id ?? null,
        generated_po_number: line.generated_po_number ?? null,
      },
    ])
  );

  async function rollbackCreatedDraftPOs(reason) {
    const createdIds = created.map((po) => po.id).filter(Boolean);

    if (createdIds.length) {
      await supabase.from('po_lines').delete().in('po_id', createdIds);
      await supabase.from('purchase_orders').delete().in('id', createdIds);
    }

    for (const [lineId, original] of originalLineState.entries()) {
      await supabase
        .from('purchase_requirement_lines')
        .update({
          status: original.status,
          generated_po_id: original.generated_po_id,
          generated_po_number: original.generated_po_number,
        })
        .eq('id', lineId);
    }

    console.error('Rolled back draft PO creation from Purchase Requirement:', reason);
  }

  for (const [supplierId, rows] of groups.entries()) {
    const body = {
      supplier_id: supplierId,
      po_date: todayISO(),
      expected_delivery: null,
      supplier_ref: null,
      notes: `Draft PO generated from Purchase Requirement ${req.params.id}`,
      lines: rows.map((x) => x.poLine),
    };

    const { data, error } = await createPurchaseOrder(body, req.user?.id);
    if (error) {
      await rollbackCreatedDraftPOs(error.message || 'createPurchaseOrder failed');
      return sendError(res, error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message || 'Failed to create draft PO.', 500);
    }

    const { error: sourceErr } = await supabase
      .from('purchase_orders')
      .update({
        source_type: 'PURCHASE_REQUIREMENT',
        source_ref_id: req.params.id
      })
      .eq('id', data.id);

    if (sourceErr) {
      await rollbackCreatedDraftPOs(sourceErr.message || 'PO source update failed');
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, sourceErr.message || 'Failed to link draft PO to Purchase Requirement.', 500);
    }

    created.push(data);

    const { error: lineUpdateErr } = await supabase
      .from('purchase_requirement_lines')
      .update({
        status: 'po_drafted',
        generated_po_id: data.id,
        generated_po_number: data.po_number
      })
      .in('id', rows.map((x) => x.pr_line_id));

    if (lineUpdateErr) {
      await rollbackCreatedDraftPOs(lineUpdateErr.message || 'PR line update failed');
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, lineUpdateErr.message || 'Failed to update Purchase Requirement lines.', 500);
    }
  }

  if (created.length) {
    const { error: prUpdateErr } = await supabase
      .from('purchase_requirements')
      .update({ status: 'po_drafted' })
      .eq('id', req.params.id);

    if (prUpdateErr) {
      await rollbackCreatedDraftPOs(prUpdateErr.message || 'PR header update failed');
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, prUpdateErr.message || 'Failed to update Purchase Requirement header.', 500);
    }
  }

  return sendSuccess(res, { purchase_orders: created }, 201);
});


router.post('/:id/cancel', authenticate, roleGuard(WRITE_ROLES), async (req, res) => {
  const { data: header, error: hErr } = await supabase
    .from('purchase_requirements')
    .select('id, pr_no, status')
    .eq('id', req.params.id)
    .single();

  if (hErr || !header) {
    return sendError(
      res,
      hErr?.code ?? ERROR_CODES.NOT_FOUND,
      hErr?.message ?? 'Purchase requirement not found.',
      404
    );
  }

  if (header.status !== 'draft') {
    return sendError(
      res,
      ERROR_CODES.VALIDATION_ERROR,
      'Only draft Purchase Requirements can be cancelled.',
      400
    );
  }

  const { data: lines, error: lErr } = await supabase
    .from('purchase_requirement_lines')
    .select('id, status, generated_po_id')
    .eq('pr_id', req.params.id);

  if (lErr) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, lErr.message || 'Failed to load Purchase Requirement lines.', 500);
  }

  const linkedLine = (lines || []).find((line) => line.generated_po_id || line.status === 'po_drafted');
  if (linkedLine) {
    return sendError(
      res,
      ERROR_CODES.VALIDATION_ERROR,
      'Purchase Requirement cannot be cancelled after a Draft PO has been generated.',
      400
    );
  }

  const lineIds = (lines || []).map((line) => line.id).filter(Boolean);
  if (lineIds.length) {
    const { error: lineUpdateErr } = await supabase
      .from('purchase_requirement_lines')
      .update({ status: 'cancelled' })
      .in('id', lineIds);

    if (lineUpdateErr) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, lineUpdateErr.message || 'Failed to cancel Purchase Requirement lines.', 500);
    }
  }

  const { data: cancelled, error: updateErr } = await supabase
    .from('purchase_requirements')
    .update({ status: 'cancelled' })
    .eq('id', req.params.id)
    .select('id, pr_no, status')
    .single();

  if (updateErr) {
    return sendError(res, ERROR_CODES.INTERNAL_ERROR, updateErr.message || 'Failed to cancel Purchase Requirement.', 500);
  }

  return sendSuccess(res, { header: cancelled });
});


router.get('/:id', authenticate, roleGuard(ALL_ROLES), async (req, res) => {
  const { data: header, error: hErr } = await supabase
    .from('purchase_requirements')
    .select('id, pr_no, source_type, status, material_status, shortage_count, notes, created_at')
    .eq('id', req.params.id)
    .single();

  if (hErr || !header) {
    return sendError(
      res,
      hErr?.code ?? ERROR_CODES.NOT_FOUND,
      hErr?.message ?? 'Purchase requirement not found.',
      404
    );
  }

  const { data: lines, error: lErr } = await supabase
    .from('purchase_requirement_lines')
    .select('id, item_id, item_code, item_name, stage_type, required_qty, available_qty, shortage_qty, uom_code, status, source_item_codes, generated_po_id, generated_po_number, created_at')
    .eq('pr_id', req.params.id)
    .order('created_at', { ascending: true });

  if (lErr) {
    return sendError(
      res,
      ERROR_CODES.INTERNAL_ERROR,
      lErr.message || 'Failed to load purchase requirement lines.',
      500
    );
  }

  // MOQ-OPT1: enrich each line with item-level min_order_qty + a suggested buy qty.
  // Read-only join on an existing item_master column; no schema change, no write.
  const itemIds = Array.from(new Set((lines || []).map((l) => l.item_id).filter(Boolean)));
  let moqByItemId = new Map();
  if (itemIds.length) {
    const { data: items, error: itemErr } = await supabase
      .from('item_master')
      .select('id, min_order_qty')
      .in('id', itemIds);
    if (itemErr) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, itemErr.message || 'Failed to load item MOQ.', 500);
    }
    moqByItemId = new Map((items || []).map((it) => [it.id, money(it.min_order_qty)]));
  }
  const enrichedLines = (lines || []).map((l) => {
    const minOrderQty = moqByItemId.get(l.item_id) || 0;
    const shortageQty = money(l.shortage_qty);
    const suggestedBuyQty = money(Math.max(shortageQty, minOrderQty));
    return { ...l, min_order_qty: minOrderQty, suggested_buy_qty: suggestedBuyQty };
  });

  // PODRAFT-SHOW-PO: for po_drafted lines, attach the actual generated PO line data
  // (ordered_qty / unit_rate / amount / supplier). Read-only joins; no schema change, no write.
  const poIds = Array.from(new Set(
    enrichedLines.filter((l) => l.status === 'po_drafted' && l.generated_po_id).map((l) => l.generated_po_id)
  ));
  let poLineByKey = new Map();
  let supplierByPoId = new Map();
  if (poIds.length) {
    const { data: poLines, error: polErr } = await supabase
      .from('po_lines')
      .select('po_id, item_id, ordered_qty, unit_rate, line_amount, line_total')
      .in('po_id', poIds);
    if (polErr) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, polErr.message || 'Failed to load PO lines.', 500);
    }
    for (const pl of poLines || []) {
      poLineByKey.set(`${pl.po_id}:${pl.item_id}`, {
        ordered_qty: money(pl.ordered_qty),
        unit_rate: money(pl.unit_rate),
        line_amount: money(pl.line_amount != null ? pl.line_amount : pl.line_total),
      });
    }
    const { data: pos, error: poErr } = await supabase
      .from('purchase_orders')
      .select('id, supplier_id')
      .in('id', poIds);
    if (poErr) {
      return sendError(res, ERROR_CODES.INTERNAL_ERROR, poErr.message || 'Failed to load POs.', 500);
    }
    const supplierIds = Array.from(new Set((pos || []).map((p) => p.supplier_id).filter(Boolean)));
    let supplierById = new Map();
    if (supplierIds.length) {
      const { data: sups, error: supErr } = await supabase
        .from('supplier_master')
        .select('id, supplier_code, supplier_name')
        .in('id', supplierIds);
      if (supErr) {
        return sendError(res, ERROR_CODES.INTERNAL_ERROR, supErr.message || 'Failed to load suppliers.', 500);
      }
      supplierById = new Map((sups || []).map((s) => [s.id, s]));
    }
    for (const p of pos || []) {
      const s = supplierById.get(p.supplier_id);
      supplierByPoId.set(p.id, { supplier_code: s?.supplier_code || null, supplier_name: s?.supplier_name || null });
    }
  }
  const finalLines = enrichedLines.map((l) => {
    if (l.status === 'po_drafted' && l.generated_po_id) {
      const pol = poLineByKey.get(`${l.generated_po_id}:${l.item_id}`) || null;
      const sup = supplierByPoId.get(l.generated_po_id) || null;
      return {
        ...l,
        po_ordered_qty: pol ? pol.ordered_qty : null,
        po_unit_rate: pol ? pol.unit_rate : null,
        po_line_amount: pol ? pol.line_amount : null,
        po_supplier_code: sup ? sup.supplier_code : null,
        po_supplier_name: sup ? sup.supplier_name : null,
      };
    }
    return l;
  });

  return sendSuccess(res, { header, lines: finalLines });
});

export default router;
