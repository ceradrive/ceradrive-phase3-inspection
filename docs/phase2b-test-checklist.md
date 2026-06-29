# v0.8.6 Test Checklist

## 1. App setup
- Open the live app after Cloudflare deploy.
- Confirm the version shows v0.8.6.
- Confirm Cloud Connection Settings uses Project URL + publishable key only.
- Sign in as Owner/Admin.
- Use Settings → Reload Latest App if the browser still shows old cached text.

## 2. Initial Organization Setup
- Run Initial Organization Setup only if no organization exists.
- Confirm starter ledgers such as Owner Cash, Factory Cash, Factory Expense, and Axis Bank are visible.

## 3. Ledger permissions
- Confirm Add Ledger is visible to Owner/Admin only.
- Create a test ledger.
- Open a ledger and confirm Deactivate is visible to Owner/Admin only.

## 4. User and role management
- Open Settings as Owner/Admin.
- Confirm User & Role Management is visible.
- Add an existing signed-up user by email.
- Set organization role: Admin, Accounts, Manager, Staff, or Viewer.
- For non-admin roles, assign ledger-specific access.
- Sign in as that user and confirm only assigned ledgers are visible.

## 5. Entry tests
- Open Factory Cash or any assigned ledger.
- Add Cash In.
- Add Cash Out.
- Confirm Cash In amount is green and Cash Out amount is red.
- Confirm balance updates after refresh.

## 6. Reconciliation test
- Confirm there is no checkbox on the main ledger list.
- Confirm checkbox appears only inside an opened ledger's entry list.
- Click checkbox and confirm it does not open details or edit.

## 7. Details/edit test
- Click the right arrow on an entry.
- Confirm Entry Details opens.
- Confirm Edit Entry is available only when the user has edit permission.
- Edit one entry with a reason and confirm Edited badge appears.

## 8. Contra test
- Create a Contra Entry from Owner Cash to Factory Cash.
- Confirm Owner Cash shows OUT.
- Confirm Factory Cash shows IN.
- Confirm both entries share Contra behavior.

## 9. Export and sync
- Export CSV for one ledger and confirm Reconciled column is present.
- Test offline entry queue and sync when online.
