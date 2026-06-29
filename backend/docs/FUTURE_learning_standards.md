# P-SFG Future Design Note — Learning Standards from Actual Production
**Status:** DESIGN DIRECTION ONLY. Not implemented. No schema, no code, no production-log change in P-SFG-2A. Current preview-only work is unchanged.

## Premise
Wizard / SKU-planning / machine-standard values are **tentative standards** at first. As real production runs, the ERP compares **planned (estimated) time vs actual time**, computes variance, and **suggests** standard improvements. It never auto-overwrites master data.

## Flow (future)
1. **Initial standard** — from SFG Builder wizard → `sku_planning_steps` / `sku_machine_standard` (e.g. ACBP `pcs_per_tray=36`, `acbp_tray_cycle_sec=120`). Estimate computed by the existing engine `calculateStepRuntime` (single source, unchanged).
2. **Actual capture** — from `production_logs` (`entry_type='ENTRY'`, `posted_at`): actual start/end or duration, actual output qty, actual machine/stage. (Read-only consumption; logs are never modified.)
3. **Variance** — per stage: `variance% = (actual_time − estimated_time) / estimated_time`. Example: est ACBP 56 min vs actual 70 min → **+25%**.
4. **Learning suggestion** — after N runs (configurable, e.g. ≥5): *"Last 5 runs avg = 145 sec/tray; current standard = 120 sec/tray. Update?"* Options: **Keep old · Update this SKU standard · Update this SKU + machine standard · Ignore**.
5. **Approval required** — Manager/Admin approves before any change. Production logs **never** directly overwrite master. Every approved change is **versioned + audited**.
6. **Versioning** — reuses the P-SFG-1 contract on `sku_machine_standard` / `sku_planning_steps` (`version_number`, `effective_from`, `effective_to`, `is_active`, supersede): insert new version, close old (`is_active=false`). Old WOs keep their snapshot; new standard applies to **future planning after `effective_from`**; **posted production logs remain unchanged**.

## How it plugs into what already exists
- **Estimator:** `recipeCalculationService.calculateStepRuntime` already produces per-stage `expected_minutes` (the "planned").
- **WO snapshot lifecycle (locked):** each WO freezes its resolved standard + `std_source/std_id/std_version` + `estimated_minutes` at machine assignment; immutable after first posted ENTRY. The learning engine compares **snapshot estimate vs actual log** — never live master vs actual.
- **Versioned standards (locked):** the suggestion, once approved, creates the next standard version; resolver already picks the active-effective version at plan time.
- **Boundary:** wrong-machine-after-post / correction stays in the existing controlled CORRECTION flow; learning suggestions are a separate, additive queue.

## Future modules (later phases, not now)
- **Estimated-vs-Actual stage variance report** — per SKU / stage / machine, rolling average + variance%.
- **Standard-update suggestion queue** — accumulates per (sku, process, machine) once sample size met; surfaces the 4 options above.
- **Approval flow for standard updates** — Manager/Admin gate; on approve → new versioned standard (effective-dated) + audit row (who/when/old→new/source-run-ids).
- **Versioned SKU-machine / process standards** — already specced in P-SFG-1; the learning engine is a writer into that versioning, behind approval.

## Acceptance direction (for when built)
- A standard change is **never** automatic; always Manager/Admin-approved.
- Suggestions require a minimum sample size and show the evidence (last-N actuals, average, current standard, variance%).
- Approved change = new version with `effective_from`; old WO snapshots and posted logs are untouched.
- Every change is auditable: old value, new value, source run ids, approver, timestamp.
- The variance report reads snapshots + logs only; it performs no writes to master or logs.

## Explicitly out of scope now
No learning engine, no variance tables, no suggestion queue, no approval UI, no schema, no production-log changes, no master writes. P-SFG-2A remains preview-only.

---

## FUTURE-STANDARDS-0 inactive foundation (this phase)
Added (inactive, unwired):
- `backend/src/config/featureFlags.js` — `learning_standards_enabled = false`.
- `backend/src/services/learningStandardsService.js` — placeholder signatures; all throw FEATURE_DISABLED; no DB, no calc.
- `backend/src/routes/learningStandards.js` — placeholder router, NOT mounted in routes/index.js; returns 503 while flag false.
- this doc.

TODO (later phases, in order):
- [ ] Variance report (read snapshots + posted production_logs; no writes).
- [ ] Suggestion queue (min sample size; per sku/process/machine).
- [ ] Proposal + manager/admin approval flow.
- [ ] Versioned standard writer (effective-dated) behind approval + audit.
- [ ] Mount route + flip flag only after review.

Acceptance (when built): no auto-overwrite; approval-gated; evidence-backed suggestions;
approved change = new version with effective_from; old WO snapshots + posted logs untouched;
fully audited (old→new, source runs, approver, timestamp).
