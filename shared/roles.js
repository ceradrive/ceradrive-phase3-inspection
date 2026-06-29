/**
 * CERADRIVE ERP — Role Constants
 * Single source of truth for all role strings used in app_metadata.role (Supabase Auth)
 *
 * These strings must exactly match the values set in Supabase Auth app_metadata.role
 * for each user. Any mismatch causes silent access failures.
 *
 * Approved: Batch 10 Step 8 — OBD role decisions locked.
 * DO NOT add or rename roles without a governance decision.
 */

export const ROLES = {
  ADMIN:              'admin',
  STORE_MANAGER:      'store_manager',
  WAREHOUSE_OPERATOR: 'warehouse_operator',
  PURCHASE_OFFICER:   'purchase_officer',
  SUPERVISOR:         'supervisor',
  PLANNER:            'planner',
};

/**
 * Role display names for UI rendering.
 * Keys match ROLES values exactly.
 */
export const ROLE_LABELS = {
  admin:              'Administrator',
  store_manager:      'Store Manager',
  warehouse_operator: 'Warehouse Operator',
  purchase_officer:   'Purchase Officer',
  supervisor:         'Supervisor',
  planner:            'Planner',
};

/**
 * All valid role strings as an array.
 * Used for validation: confirms a role value is one of the approved set.
 */
export const ALL_ROLES = Object.values(ROLES);
