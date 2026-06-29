/**
 * CERADRIVE ERP — Price List Validators (Phase: Price List)
 * Header + lines. Revision = new header row (uniq code+revision). INR default.
 * Discount: discount_percent OR discount_amount, never both.
 */
import { z } from 'zod';

const uuid = z.string().uuid();

const lineSchema = z.object({
  id:               uuid.optional(),        // present = existing line (update)
  item_id:          uuid,
  uom_id:           uuid.nullish(),
  unit_rate:        z.number().min(0),
  discount_percent: z.number().min(0).nullish(),
  discount_amount:  z.number().min(0).nullish(),
}).superRefine((l, ctx) => {
  if (l.discount_percent != null && l.discount_amount != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount_amount'], message: 'Use discount_percent OR discount_amount, not both.' });
  }
});

const headerBase = {
  price_list_code: z.string().min(1).max(50),
  price_list_name: z.string().min(1).max(200),
  revision:        z.number().int().positive().optional(),
  currency:        z.string().max(8).optional(),
  valid_from:      z.string().nullish(),
  valid_to:        z.string().nullish(),
  notes:           z.string().nullish(),
};

export const createPriceListSchema = z.object({
  ...headerBase,
  lines: z.array(lineSchema).min(1),
});

// PATCH: header fields optional; line diffs add/update/remove
export const updatePriceListSchema = z.object({
  price_list_name: headerBase.price_list_name.optional(),
  currency:        headerBase.currency,
  valid_from:      headerBase.valid_from,
  valid_to:        headerBase.valid_to,
  notes:           headerBase.notes,
  lines: z.object({
    add:    z.array(lineSchema).optional(),
    update: z.array(lineSchema.refine(l => !!l.id, 'update line requires id')).optional(),
    remove: z.array(uuid).optional(),
  }).optional(),
});

export const togglePriceListSchema = z.object({ is_active: z.boolean() });
