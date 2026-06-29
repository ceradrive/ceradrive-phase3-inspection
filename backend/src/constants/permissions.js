/**
 * CERADRIVE ERP — Permission Catalog (module/action codes)
 *
 * Central source for module + action codes used with requirePermission(module, action).
 * Codes mirror live role_permissions.module_code / action_code values exactly — never
 * inline literals in routes. WO reopen uses the existing live action code 'REOPEN_WO'.
 */

export const MODULES = {
  WORK_ORDER: 'WORK_ORDER',
};

export const WORK_ORDER_ACTIONS = {
  VIEW:         'VIEW',
  ADD:          'ADD',
  EDIT:         'EDIT',
  RELEASE:      'RELEASE',
  CANCEL:       'CANCEL',
  COMPLETE:     'COMPLETE',
  REOPEN:       'REOPEN_WO',
  LOG_ENTRY:    'LOG_ENTRY',
  LOG_REVERSAL: 'LOG_REVERSAL',
};
