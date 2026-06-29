# v0.8.6 Verification Report

## Package
CFC CashBook App v0.8.6 Role & User Cleanup

## Scope confirmed
- Controlled patch on top of working v0.8.x static PWA.
- No Claude v2 rewrite included.
- No new SQL added.
- Existing reconciliation migration retained only as reference.

## Files changed
- `app.js`
- `index.html`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `config.js`
- `README.md`
- `docs/phase2b-test-checklist.md`
- `docs/v08-release-notes.md`
- `docs/v086-fix-note.md`
- `docs/v086-verification-report.md`

## Functional checks
- Add Ledger click binding remains reliable.
- Add Ledger UI is shown only when active business role is Owner/Admin.
- Deactivate Ledger UI is shown only when active business role is Owner/Admin.
- Main ledger list remains compact and does not render reconciliation checkboxes.
- Reconciliation checkbox renders only inside opened ledger entry list.
- Reconciliation checkbox click handler stops propagation.
- Right arrow opens Entry Details via `data-entry-details`.
- Edit Entry is available only when ledger permission allows it.
- Add Cash In / Cash Out is permission-gated through ledger permission.
- Contra Entry uses ledgers where the user can add entries.
- User & Role Management appears only for Owner/Admin in Settings.
- Add User / Update Role looks up an existing profile by email.
- Non-admin users can receive ledger-specific access rows.
- Cache-busting version is v0.8.6 across app shell files.

## Wording checks
- Party / Purpose label is used for entry forms.
- Cloud Connection Settings label is used for cloud setup/reset.
- Initial Organization Setup label is used for first setup.
- Factory Cash wording is used in starter-ledger notices.
- Casual/Hinglish UI messages were not found.
- Relationship terms are not used in user-facing UI/docs.

## Security checks
- `config.js` contains cloud project URL and publishable-key placeholder only.
- No actual publishable key is included in the package.
- No service role key, database password, JWT secret, or secret value is included.
- User creation remains normal sign-up only; browser app does not use admin/secret APIs.

## Technical checks run
- `node --check app.js` passed.
- Required static PWA files are present.
- ZIP integrity test passed after creation.
