/**
 * CERADRIVE ERP — Vehicle Master Validators (10G).
 * vehicle_name required; make optional; no vehicle_code.
 */
import { z } from 'zod';

export const createVehicleSchema = z.object({
  vehicle_name: z.string().min(1).max(120),
  make:         z.string().max(80).nullish(),
  is_active:    z.boolean().optional(),
});

export const updateVehicleSchema = z.object({
  vehicle_name: z.string().min(1).max(120).optional(),
  make:         z.string().max(80).nullish(),
  is_active:    z.boolean().optional(),
});
