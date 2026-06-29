# Claude Task — Ceradrive Phase 3 Repo Inspection

The sanitized public Phase 3 inspection repo is ready.

Mode:

- No coding.
- No repo edits.
- Read-only inspection only.
- Use actual repo evidence.
- Do not fabricate paths, functions, DocTypes, fields, or behavior.

## Task

Inspect this repo and return the Phase 3 Implementation Surface Report.

Inspect:

1. `hooks.py`
2. custom app `*/doctype/` folders
3. Recipe Rule DocType `.json/.py/.js`
4. Recipe Rule child table DocTypes
5. helper warehouse / warehouse_helper_policy DocType files
6. material availability report/API files
7. manufacturing planning report/API files
8. overrides for Production Plan, Work Order, BOM, Bin, Warehouse, stock utils
9. fixtures/custom fields, if exported
10. patches touching Recipe Rule, warehouse, material availability, or stock logic
11. server scripts/client scripts/custom fields, if present in repo

Search terms:

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

## Required output

Return:

1. exact files/functions/classes
2. evidence for inspection items 1–13
3. conflict report
4. data model report
5. build-readiness verdict
6. proposed implementation sequence

## Locked Phase 3 rules

- shared skip-list first
- deterministic Recipe Rule resolution second
- helper warehouse display logic third
- Bin-only grouped Material Availability fourth
- Recipe Rule chain: specificity → priority → output_fingerprint → AMBIGUOUS if different
- source_warehouse is authoritative and must be an exact leaf warehouse
- helper warehouses are display/info only
- helper stock never affects READY/SHORT
- availability uses only Bin.actual_qty
- negative actual_qty clamps to zero
- grouped key is item_code + stock_uom + source_warehouse
- Bin stock is read once per grouped key
- READY derives only from shortfall_qty
- non-stock, scrap, by-product, process-loss, and secondary-output rows are excluded everywhere

## If app code is missing

Return:

```text
BLOCKED — REPO SURFACE UNCLEAR
```

Do not invent paths or fields.
