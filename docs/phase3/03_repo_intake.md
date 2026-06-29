# Repo Intake Instructions

To unblock exact Phase 3 inspection, add the sanitized custom app to `app/`.

Minimum required bundle:

1. Custom app folder containing:
   - all custom DocTypes under `*/doctype/`
   - Recipe Rule DocType `.json/.py/.js`
   - Recipe Rule child table DocTypes
   - helper warehouse / warehouse_helper_policy DocType files
   - material availability report/API files
   - manufacturing planning report/API files
   - overrides/hooks related to Production Plan, Work Order, BOM, Bin, Warehouse, or stock utils

2. Also include if present:
   - `hooks.py`
   - overrides
   - fixtures/custom fields
   - patches touching Recipe Rule, warehouse, material availability, or stock logic
   - report `.py/.js` files related to material availability
   - server scripts/client scripts/custom fields if exported

3. Search terms for local inspection:

```text
recipe_rule
Recipe Rule
resolve_recipe
output_fingerprint
fingerprint
specificity
priority
source_warehouse
s_warehouse
helper
warehouse_helper_policy
material_availability
shortfall
READY
SHORT
actual_qty
projected_qty
reserved_qty
ordered_qty
planned_qty
get_stock_balance
get_latest_stock_qty
Stock Ledger Entry
is_scrap
by_product
process_loss
secondary_output
is_stock_item
```

## Public repo safety

Before publishing, remove:

- secrets
- `.env`
- site configs
- database dumps
- backups
- private keys
- API keys
- tokens
- passwords
- customer data
- logs
