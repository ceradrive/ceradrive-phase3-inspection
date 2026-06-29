# CFC CashBook App v0.9.3

Mobile-first standalone CashBook / Ledger PWA for CFC/Ceradrive.

## Current version
v0.9.3 Secure Ledger Create

## Main features
- Cloud login and cloud-backed storage
- Login Remember me
- Offline Cash In / Cash Out / Contra Entry local queue
- Ledger-to-ledger Contra Entry
- Compact mobile ledger list
- Add Ledger for Owner/Admin
- Deactivate Ledger for Owner/Admin without hard-deleting historical data
- User & Role Management for Owner/Admin
- Ledger-specific access for Manager, Staff, Viewer, and Accounts users
- Reconciliation checkbox inside opened ledger entry list only
- Entry details through the right arrow; edit requires permission and reason
- CSV export with reconciled status

## Required database migrations for User & Role Management
Run these once in Supabase SQL Editor if not already applied:

1. `database/003_add_profile_email_for_user_roles.sql`
2. `database/004_secure_profile_email_lookup.sql`
3. `database/005_add_manager_business_role.sql`

## v0.9.3 controlled fix
- Keeps UI label `Manager`.
- Saves business role as lowercase `manager`.
- Adds database migration to allow `manager` in `cashbook_business_members.business_role`.
- Improves the error message when the Manager role database constraint is missing.
- Retains v0.9.1 Remember me and offline save guard.

## Config
`config.js` must contain only:
- Supabase project URL
- Supabase publishable key starting with `sb_publishable_`

Never use `sb_secret_`, service role key, database password, JWT secret, or any secret key in the browser app.


## v0.9.3 Secure Ledger Create

Adds `cashbook_create_ledger` RPC for Owner/Admin ledger creation so Add Ledger does not depend on fragile direct table insert RLS from the browser. Run `database/006_secure_ledger_create.sql` before deploying this version.
