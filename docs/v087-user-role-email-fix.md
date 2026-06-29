# v0.8.8 User Role Email Fix

## Issue fixed

User & Role Management was searching by `cashbook_profiles.email`, but some live databases did not yet have the `email` column in `cashbook_profiles`.

## Required database step

Run this once in Supabase SQL Editor before using User & Role Management:

`database/003_add_profile_email_for_user_roles.sql`

This adds safe profile email fields and syncs existing signed-up Supabase Auth users into `cashbook_profiles`.

## Notes

- No service role key is used in frontend.
- No financial data is changed.
- New users still need to sign up first.
- Owner/Admin can then assign organization role and ledger access by email.
