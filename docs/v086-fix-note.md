# v0.8.6 Role & User Cleanup

## Scope
Small controlled patch on top of the working v0.8.x app.

## Included
- Removed remaining professional-wording issues from user-facing screens.
- Version/cache bumped so old mobile UI text does not remain stuck from service worker cache.
- Added Owner/Admin-only User & Role Management in Settings.
- Added existing-user role assignment by email.
- Added ledger-specific access assignment for Manager, Staff, Viewer, and Accounts-type users.
- Kept Admin access organization-wide; ledger-specific assignment is not required for Admin.
- Kept Add Ledger and Deactivate Ledger protected for Owner/Admin.
- Kept reconciliation checkbox only inside opened ledger entry list.

## Database
No new SQL required in this package.
