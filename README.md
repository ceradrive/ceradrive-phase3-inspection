# Ceradrive Phase 3 Inspection Bundle

This is a **planning + inspection bundle** for Ceradrive ERPNext/Frappe Migration — Phase 3 Material Availability.

Important:

- This bundle does **not** contain the Ceradrive custom app/repo code unless you add it under `app/`.
- It contains the locked Phase 3 rules, implementation checklist, repo-intake instructions, and Claude inspection task.
- Use this as a temporary public GitHub inspection repo template.
- Original production/private repo should remain private.

## Intended GitHub structure

```text
ceradrive-phase3-inspection/
  README.md
  CLAUDE_TASK.md
  .gitignore
  app/
    PUT_CUSTOM_APP_HERE.md
    <custom_app_name>/              # Add sanitized custom app here
  docs/
    phase3/
      00_context.md
      01_locked_rules.md
      02_implementation_checklist.md
      03_repo_intake.md
      04_inspection_report_format.md
      05_handoff_summary.md
  scripts/
    collect_phase3_grep_evidence.sh
```

## Before making the repo public

Do **not** include:

- `.env`
- `site_config.json`
- `common_site_config.json`
- database dumps
- backups
- private keys
- API keys
- tokens
- passwords
- customer data
- production logs

## What Claude should do

Read this repo, inspect the custom app under `app/`, and return a Phase 3 Implementation Surface Report.

Mode:

- No coding.
- No repo edits.
- Read-only inspection only.
- Use actual repo evidence.
- Do not fabricate paths, functions, DocTypes, fields, or behavior.
