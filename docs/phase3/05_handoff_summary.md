# Phase 3 Handoff Summary

Phase 3 is planning-only for now.

Build order:

```text
shared skip-list
→ deterministic Recipe Rule resolution
→ helper warehouse display logic
→ Bin-only grouped material availability
```

Why this order:

- Skip-list comes first because every later phase references it.
- Recipe Rule resolution comes before availability because it determines the material list and source warehouse.
- Helper logic comes after source warehouse is known, but stays display-only.
- Availability comes last and uses only grouped `Bin.actual_qty`.

Critical risk:

False READY/SHORT must be avoided.

Examples of unsafe behavior:

- wrong Recipe Rule selected
- helper stock counted in status
- parent warehouse stock included
- projected/reserved/planned quantity used
- scrap/by-product/non-stock rows counted
- Bin read per row instead of once per group key
- READY derived from anything except shortfall

Current repo-access status:

- If actual custom app code is not added under `app/`, Claude can only read the planning docs.
- Exact implementation mapping requires actual repo evidence.
- No file paths/functions/DocTypes/fields should be fabricated.
