/**
 * CERADRIVE ERP — Sales Order Validators (10B). Draft CRUD only.
 * Line discount: percent OR amount (not both). rate_source: price_list|manual.
 */
import { z } from 'zod';

const uuid = z.string().uuid();

const lineSchema = z.object({
  id:               uuid.optional(),
  item_id:          uuid,
  uom_id:           uuid.nullish(),
  qty:              z.number().positive(),
  unit_rate:        z.number().min(0).nullish(),
  discount_percent: z.number().min(0).nullish(),
  discount_amount:  z.number().min(0).nullish(),
  tax_id:           uuid.nullish(),
  tax_percent:      z.number().min(0).nullish(),
  tax_amount:       z.number().min(0).nullish(),
  line_total:       z.number().min(0).nullish(),
  rate_source:      z.enum(['price_list', 'manual']).optional(),
  printable_vehicle_name: z.string().max(150).nullish(),
  notes:            z.string().nullish(),
}).superRefine((l, ctx) => {
  if (l.discount_percent != null && l.discount_amount != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount_amount'], message: 'Use discount_percent OR discount_amount, not both.' });
  }
});

export const createSalesOrderSchema = z.object({
  customer_id:        uuid,
  price_list_id:      uuid.nullish(),
  so_date:            z.string().min(1),
  delivery_date:      z.string().nullish(),
  customer_reference: z.string().max(100).nullish(),
  payment_terms:      z.string().nullish(),
  notes:              z.string().nullish(),
  lines:              z.array(lineSchema).min(0),
});

export const updateSalesOrderSchema = z.object({
  price_list_id:      uuid.nullish(),
  so_date:            z.string().min(1).optional(),
  delivery_date:      z.string().nullish(),
  customer_reference: z.string().max(100).nullish(),
  payment_terms:      z.string().nullish(),
  notes:              z.string().nullish(),
  lines: z.union([
    z.array(lineSchema),
    z.object({
      add:    z.array(lineSchema).optional(),
      update: z.array(lineSchema.refine(l => !!l.id, 'update line requires id')).optional(),
      remove: z.array(uuid).optional(),
    }),
  ]).optional(),
});
