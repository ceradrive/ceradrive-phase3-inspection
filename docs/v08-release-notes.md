# CFC CashBook v0.8.6

## Controlled fixes
- Professional UI wording standardization completed.
- Entry labels use Party / Purpose.
- Connection setup uses Cloud Connection Settings.
- Compact ledger list preserved.
- Reconciliation checkbox remains only inside opened ledger entry list.
- Checkbox click is isolated from details/edit actions.
- Right arrow opens Entry Details first; edit requires permission.
- Owner/Admin-only Add Ledger and Deactivate Ledger actions retained.
- User & Role Management added in Settings for Owner/Admin.
- Owner/Admin can add an existing signed-up user, set organization role, and assign ledger access.
- Cash In amounts are green and Cash Out amounts are red.
- Cache version bumped to v0.8.6 to clear old mobile wording.

## Database
No new SQL is required for v0.8.6 if the existing CashBook schema and v0.8 reconciliation fields already exist.

## Security
- `config.js` must contain only the cloud project URL and publishable key.
- Never place `sb_secret_`, service role keys, database passwords, JWT secrets, or any secret key in the frontend.
