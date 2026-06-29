# Phase 3 Context

Project: Ceradrive ERPNext/Frappe Migration

Phase: Phase 3 — Material Availability Build Planning

Current mode:

- Planning/checklist/inspection only.
- No coding yet.
- No repo edits yet.

Locked sections:

- Phase 3A Recipe Rule Resolution
- Phase 3B Helper Warehouse Logic
- Phase 3C Material Availability Calculation
- Shared skip-list

Purpose:

Phase 3 decides material readiness:

```text
Is material available?
Should the plan/document show READY or SHORT?
```

This is false-READY-sensitive. Wrong recipe selection, wrong warehouse, helper stock leakage, skipped row leakage, or non-Bin stock source can produce incorrect READY/SHORT results.

Therefore the correct flow is:

```text
Rules locked
→ implementation checklist
→ repo inspection
→ exact implementation map
→ coding later
```
