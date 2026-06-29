/**
 * CERADRIVE ERP — PO Header Validator
 * Phase 9B: Zod schemas for PO create, update, approve, close, cancel.
 *
 * Rules:
 *   ALR-17:  Approved PO — only notes, supplier_ref, expected_delivery editable
 *   ALR-17B: Reopen to draft — not permitted (OBD-06)
 *   ALR-18:  Cancel — cancellation_reason >= 5 chars (OBD-05)
 *   ALR-19:  po_number never in request body — server-generated
 *   ALR-20:  po_date from operator — required, not overwritten
 */

import { z } from 'zod';
import { poLineSchema, poLineBaseSchema } from './poLineValidator.js';

// ─── Create Draft PO ──────────────────────────────────────────────────────────

export const createPOSchema = z.object({
  supplier_id:       z.string().uuid({ message: 'supplier_id must be a valid UUID.' }),
  po_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
                       message: 'po_date must be YYYY-MM-DD format.',
                     }),
  expected_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  supplier_ref:      z.string().max(100).nullable().optional(),
  notes:             z.string().nullable().optional(),
  lines:             z.array(poLineSchema).min(0),  // 0 allowed on draft save
});

// ─── Update Draft PO ──────────────────────────────────────────────────────────
// Full edit — only valid when status = 'draft' (enforced by purchaseStatusGuard)

export const updateDraftPOSchema = z.object({
  supplier_id:       z.string().uuid().optional(),
  po_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  supplier_ref:      z.string().max(100).nullable().optional(),
  notes:             z.string().nullable().optional(),
  lines: z.object({
    add:    z.array(poLineSchema).optional(),
    update: z.array(poLineBaseSchema.extend({
               id: z.string().uuid(),
             })).optional(),
    remove: z.array(z.string().uuid()).optional(),
  }).optional(),
}).refine(
  (body) => {
    // ALR-17B: Reject any attempt to set status = 'draft' via update
    if ('status' in body) return false;
    return true;
  },
  { message: 'status cannot be set via update. Use the approve/close/cancel endpoints.' }
);

// ─── Update Approved PO (OBD-02) ──────────────────────────────────────────────
// Only three fields permitted. All others rejected at route level.

export const updateApprovedPOSchema = z.object({
  notes:             z.string().nullable().optional(),
  supplier_ref:      z.string().max(100).nullable().optional(),
  expected_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict({         // .strict() rejects any extra keys not listed above
  message: 'Only notes, supplier_ref, and expected_delivery may be edited on an approved Purchase Order.',
});

// ─── Approve PO ───────────────────────────────────────────────────────────────
// No body required — approved_by and approved_at set server-side

export const approvePOSchema = z.object({}).optional();

// ─── Close PO (ALR-05) ────────────────────────────────────────────────────────

export const closePOSchema = z.object({
  confirm_short_close: z.boolean({
    required_error: 'confirm_short_close is required.',
    invalid_type_error: 'confirm_short_close must be a boolean.',
  }),
  // POSHORTCLOSE: reason required when short-closing (confirm_short_close = true).
  reason: z.string().trim().min(5, { message: 'Reason must be at least 5 characters.' }).nullable().optional(),
}).superRefine((val, ctx) => {
  if (val.confirm_short_close === true && (!val.reason || val.reason.trim().length < 5)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'],
      message: 'A reason (min 5 characters) is required to short-close a Purchase Order.' });
  }
});

// ─── Cancel PO (ALR-18, OBD-05) ──────────────────────────────────────────────

export const cancelPOSchema = z.object({
  cancellation_reason: z.string()
    .min(5, { message: 'Cancellation reason must be at least 5 characters.' }),
});
