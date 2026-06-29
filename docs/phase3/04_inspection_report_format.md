# Required Phase 3 Implementation Surface Report Format

Claude should return this exact report after inspecting the repo.

## 1. Exact files/functions/classes

For each Phase 3 area, provide:

- area
- file
- function/class/method
- DocType
- fields
- current behavior
- locked-rule compatibility
- required later change, if any

Areas:

- Recipe Rule resolution
- Recipe Rule specificity
- Recipe Rule priority
- output_fingerprint or equivalent
- source_warehouse assignment
- source_warehouse validation
- helper warehouse logic
- Material Availability calculation
- Bin stock lookup
- READY/SHORT calculation
- skipped-row detection
- grouped material-row construction

## 2. Evidence for inspection items 1–13

Resolve each with exact repo evidence:

1. Where Recipe Rule resolution currently lives.
2. Where specificity, priority, and output_fingerprint are stored or calculated.
3. Where source_warehouse is assigned.
4. Whether exact leaf source_warehouse validation exists.
5. Where helper warehouse logic lives.
6. Whether helper warehouse stock is used anywhere in readiness or availability.
7. Where Material Availability calculation lives.
8. Whether availability uses Bin.actual_qty or projected/reserved/ordered/planned/SLE-derived quantities.
9. Where READY/SHORT is calculated.
10. Where non-stock, scrap, by-product, process-loss, and secondary-output rows are identified.
11. Whether a shared skip-list helper exists.
12. Where grouped rows are built, if grouping exists.
13. Whether Bin stock is read per row or once per grouped key.

## 3. Conflict report

Flag any current behavior that violates locked Phase 3 rules:

- projected_qty leakage
- reserved_qty leakage
- ordered_qty leakage
- planned_qty leakage
- SLE-derived stock leakage
- group warehouse rollup
- helper warehouse stock affecting READY/SHORT
- per-row Bin reads
- missing exact leaf warehouse validation
- Recipe Rule nondeterminism
- skip-list inconsistency
- READY/SHORT derived from anything other than shortfall_qty

## 4. Data model report

List actual DocTypes and fields currently available for:

- Recipe Rule
- Recipe Rule lines/outputs
- source_warehouse
- helper warehouse policy
- item stock/non-stock status
- scrap rows
- by-product rows
- process-loss rows
- secondary-output rows
- required_qty
- stock_uom
- available_qty
- shortfall_qty
- READY/SHORT status

## 5. Build-readiness verdict

Return one of:

- READY FOR CODING
- BLOCKED — NEED FIELD DECISION
- BLOCKED — LOGIC CONFLICT
- BLOCKED — MISSING DOCTYPE/FIELD
- BLOCKED — REPO SURFACE UNCLEAR

## 6. Proposed implementation sequence after inspection

Keep locked build order:

1. Shared skip-list helper.
2. Deterministic Recipe Rule resolution.
3. Helper warehouse display logic.
4. Bin-only grouped Material Availability.
5. READY/SHORT derivation from shortfall_qty only.
