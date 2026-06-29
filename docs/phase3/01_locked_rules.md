# Phase 3 Locked Rules

## Recipe Rule Resolution

Recipe Rule selection is deterministic.

Resolution chain:

```text
specificity → priority → output_fingerprint → AMBIGUOUS if different
```

Required behavior:

- Same input must always produce same selected rule.
- Database row order must not affect result.
- If final competing rules have the same output fingerprint, deterministic success is allowed.
- If final competing rules have different output fingerprints, result must be `AMBIGUOUS`.

## Source Warehouse

```text
source_warehouse is authoritative.
```

Rules:

- `source_warehouse` must be present for every included material row.
- `source_warehouse` must be an exact leaf warehouse.
- Parent/group warehouse must be rejected.
- No child warehouse aggregation.
- No helper warehouse substitution.
- No fallback warehouse.

## Helper Warehouse

```text
helper warehouse = display/info only
```

Rules:

- Helper warehouses are display/info only.
- Helper warehouses must never override `source_warehouse`.
- Helper stock must never affect availability.
- Helper stock must never affect READY/SHORT.

## Material Availability

Availability uses only:

```text
Bin.actual_qty
```

Do not use:

- `projected_qty`
- `reserved_qty`
- `ordered_qty`
- `planned_qty`
- Stock Ledger Entry derived quantities
- helper warehouse stock

Negative actual quantity clamps to zero:

```text
actual_qty_clamped = max(Bin.actual_qty, 0)
```

Grouped key:

```text
item_code + stock_uom + source_warehouse
```

Grouped Bin stock is read once per grouped key.

Shortfall:

```text
shortfall_qty = max(required_qty - actual_qty_clamped, 0)
```

READY/SHORT:

```text
READY = shortfall_qty == 0
SHORT = shortfall_qty > 0
```

READY is derived only from `shortfall_qty`.

## Shared skip-list

Rows excluded everywhere:

- non-stock rows
- scrap rows
- by-product rows
- process-loss rows
- secondary-output rows

Excluded rows must not participate in:

- Recipe Rule resolution
- Helper Warehouse logic
- Material Availability grouping
- READY/SHORT calculation
