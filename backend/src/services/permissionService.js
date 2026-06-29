/**
 * CERADRIVE ERP — Permission Service (resolver)
 *
 * Resolves whether a role (by role_code from req.user.role) holds a permitted grant
 * for a given module/action, using the live RBAC tables:
 *   roles.role_code -> roles.id -> role_permissions(role_id, module_code, action_code, is_permitted)
 *
 * Returns { allowed: boolean, error }. Allowed iff a role_permissions row exists with
 * is_permitted = true. An is_permitted = false row, or no row, both resolve to deny.
 * Pattern mirrors the other services: returns { ... , error }, never throws for control flow.
 */

import { supabase } from '../config/supabase.js';

export async function hasPermission(roleCode, moduleCode, actionCode) {
  if (!roleCode || !moduleCode || !actionCode) {
    return { allowed: false, error: null };
  }

  // Case-only reconciliation: shared/roles.js (and app_metadata.role) are lowercase,
  // while roles.role_code is canonical UPPERCASE. Normalize the incoming role to match.
  // role_code values are simple A-Z_ codes, so toUpperCase() is exact (no locale edge cases).
  const normalizedRoleCode = String(roleCode).trim().toUpperCase();

  // role_code (from app_metadata.role, normalized) -> roles.id
  const { data: role, error: roleErr } = await supabase
    .from('roles')
    .select('id')
    .eq('role_code', normalizedRoleCode)
    .maybeSingle();

  if (roleErr) return { allowed: false, error: roleErr };
  if (!role)   return { allowed: false, error: null }; // unknown role -> deny

  // (role_id, module_code, action_code) is UNIQUE -> at most one row
  const { data: grant, error: grantErr } = await supabase
    .from('role_permissions')
    .select('is_permitted')
    .eq('role_id', role.id)
    .eq('module_code', moduleCode)
    .eq('action_code', actionCode)
    .eq('is_permitted', true)
    .maybeSingle();

  if (grantErr) return { allowed: false, error: grantErr };
  return { allowed: Boolean(grant), error: null };
}
