/**
 * CERADRIVE ERP — Purchase Bill Validators (PB-1)
 * Create draft from a posted GRN. Body carries only grn_id; everything else
 * (qty, rate, amounts, supplier, totals) is snapshotted server-side from the GRN.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

export const createBillSchema = z.object({
  grn_id: uuid,
});
