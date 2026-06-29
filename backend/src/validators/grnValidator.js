/**
 * CERADRIVE ERP — GRN Validators (Phase 9G)
 * Draft create only. Both Direct and PO-based GRNs.
 *
 * GRN1-DRAFT-EDIT: added updateGRNSchema for draft-only line edits
 * (received_qty + unit_rate only). No header fields, no new lines, no deletes.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

const lineSchema = z.object({
  item_id:      uuid,
  uom_id:       uuid,
  received_qty: z.number().positive(),
  unit_rate:    z.number().min(0),
  po_line_id:   uuid.nullish(),
  tax_id:       uuid.nullish(),
  tax_name:     z.string().nullish(),
  tax_percent:  z.number().min(0).nullish(),
  tax_amount:   z.number().min(0).nullish(),
  notes:        z.string().nullish(),
});

export const createGRNSchema = z.object({
  supplier_id:      uuid,
  warehouse_id:     uuid,
  grn_date:         z.string().min(1),
  is_direct_grn:    z.boolean(),
  po_id:            uuid.nullish(),
  supplier_challan: z.string().nullish(),
  supplier_invoice: z.string().nullish(),
  notes:            z.string().nullish(),
  lines:            z.array(lineSchema).min(1),
}).superRefine((val, ctx) => {
  if (val.is_direct_grn === false) {
    if (!val.po_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['po_id'], message: 'po_id is required for a PO-based GRN.' });
    val.lines.forEach((l, i) => {
      if (!l.po_line_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lines', i, 'po_line_id'], message: 'po_line_id is required for each PO-based GRN line.' });
    });
  } else {
    if (val.po_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['po_id'], message: 'po_id must be empty for a Direct GRN.' });
    val.lines.forEach((l, i) => {
      if (l.po_line_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lines', i, 'po_line_id'], message: 'po_line_id must be empty for a Direct GRN line.' });
    });
  }
});

// ─── GRN1-DRAFT-EDIT — Draft Update (received_qty + unit_rate only) ───────────
// Draft-only line edits. Each line is identified by its existing grn_lines.id.
// Only received_qty and unit_rate may change; amounts are recalculated server-side.
// Header fields, adding lines, and removing lines are intentionally NOT allowed.
const updateLineSchema = z.object({
  id:           uuid,
  received_qty: z.number().positive(),
  unit_rate:    z.number().min(0),
});

export const updateGRNSchema = z.object({
  lines: z.array(updateLineSchema).min(1),
});
