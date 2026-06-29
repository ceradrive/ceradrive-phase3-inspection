# Phase 3 Implementation Checklist

## 1. Build order

### Step 1 — Confirm Phase 3 field contract

Confirm actual field names in repo for:

- `item_code`
- `stock_uom`
- `required_qty`
- `source_warehouse`
- helper warehouse display fields
- `actual_qty`
- `available_qty`
- `shortfall_qty`
- READY/SHORT status
- row classification flags

### Step 2 — Add shared skip-list handling first

Rows excluded everywhere:

- non-stock
- scrap
- by-product
- process-loss
- secondary-output

This should become one shared helper/check so Phase 3A, 3B, and 3C do not drift apart.

### Step 3 — Build Phase 3A Recipe Rule Resolution

Implement deterministic Recipe Rule selection before warehouse/helper/availability logic.

Resolution chain:

```text
specificity → priority → output_fingerprint → AMBIGUOUS if different
```

### Step 4 — Build Phase 3B Helper Warehouse Logic

Helper warehouse logic comes after Recipe Rule/source warehouse is known.

Rules:

- helper warehouses are display/info only
- helper stock never affects READY/SHORT
- helper warehouse never replaces source warehouse

### Step 5 — Build Phase 3C Material Availability Calculation

Rules:

- use only `Bin.actual_qty`
- clamp negative actual to zero
- group by `item_code + stock_uom + source_warehouse`
- read Bin once per group key
- calculate shortfall at group level
- derive READY/SHORT only from shortfall

### Step 6 — Wire final status output

Document/plan status:

```text
READY only if all included grouped keys have shortfall_qty = 0
SHORT if any included grouped key has shortfall_qty > 0
```

Excluded rows must not affect final status.

## 2. Files / DocTypes / areas to inspect

Core ERPNext/Frappe references:

- Item
- Warehouse
- Bin
- BOM / BOM Item
- Work Order
- Production Plan
- Stock Entry

Custom Ceradrive / RepNext areas:

- Recipe Rule definition
- Recipe Rule candidate matching
- Recipe Rule priority
- Recipe Rule specificity
- output fingerprint logic
- helper warehouse mappings
- source warehouse assignment
- material availability report/API
- material planning report/API
- READY/SHORT status calculation
- row classification/exclusion logic

Query/API areas to inspect:

- `Bin`
- `Stock Ledger Entry`
- `projected_qty`
- `reserved_qty`
- `ordered_qty`
- `planned_qty`
- helper warehouse stock
- warehouse descendants/parents
- warehouse groups

## 3. Data dependencies

Phase 3 needs reliable data for:

- item code
- stock UOM
- required quantity
- authoritative source warehouse
- stock/non-stock classification
- row role/classification
- Recipe Rule specificity
- Recipe Rule priority
- Recipe Rule output fingerprint
- helper warehouse mappings
- Bin record for each included grouped key

## 4. Validation gates

### G1 — Skip-list consistency

Excluded rows must be absent from every downstream count, helper set, grouped required qty, and final status input.

### G2 — Recipe Rule determinism

Same input must always produce the same selected rule, or return AMBIGUOUS when fingerprints diverge.

### G3 — Source warehouse authority

Source warehouse must be exact leaf, same company, active, and not disabled.

### G4 — Bin-only availability

No availability/status path should reference projected/reserved/ordered/planned/SLE/helper stock.

### G5 — Grouping correctness

Bin read count must equal distinct group key count.

### G6 — Status correctness

READY iff `shortfall_qty == 0`; helper columns uninvolved.

## 5. Test cases

Key tests:

- Single matching Recipe Rule
- Specificity wins
- Priority breaks specificity tie
- Same fingerprint tie succeeds
- Different fingerprint tie returns AMBIGUOUS
- Database order independence
- Each skip-list type excluded everywhere
- Valid leaf source warehouse passes
- Missing source warehouse blocks
- Group source warehouse blocks
- Helper stock only still SHORT
- Source stock sufficient still READY even if helper empty
- Missing Bin = actual 0
- Negative Bin actual clamps to 0
- Same item/UOM/source groups together
- Same item/source but different UOM does not silently group
- Same item/UOM but different source creates separate groups
- Bin read once per grouped key
- Final READY only when all included groups have zero shortfall
- Final SHORT when any included group has positive shortfall

## 6. Risks before coding

Risks:

- projected/reserved/planned qty leakage
- helper warehouse overload
- warehouse hierarchy leakage
- inconsistent row classification
- UOM conversion ambiguity
- ambiguous Recipe Rule bypass
- row-level display confusion after grouped calculation
- negative Bin quantities
- missing Bin behavior
- performance regression from per-row Bin reads
