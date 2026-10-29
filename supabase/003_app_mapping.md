# Existing app data mapping and integration plan

This document describes the migration plan for the current single-file app. It is a plan, not a claim that the app already syncs.

## Current source of truth

The current `index.html` initializes one global `D` object and persists the entire object under the browser localStorage key `dcos1`. Authentication and staff users are also embedded in `D.users`; the app's current `doLogin()` validates local password hashes. This is not Supabase Auth and does not sync between devices.

The initial `D` object includes:
- `settings`: clinic name and clinic recovery contact
- `branches`: branch definitions
- `users`: local users, roles, active status, branch assignments, local password/recovery/session fields
- `patients`: patient list
- `audit`: audit events

Other modules are initialized or used later in the app, including services/procedures (`procs`), inventory items/suppliers (`items`, `sups`), appointments/chairs (`appts`, `chairs`), lab cases (`labs`), and additional sequences/counters. The complete shape must be mapped by tracing every read/write before any migration is executed.

## Mapping to normalized tables

| Existing data / module | Proposed destination | Notes |
|---|---|---|
| `settings.clinic` | `clinics.name` | Update via owner-authorized server operation |
| `branches` | `clinic_branches` | Keep stable branch IDs or maintain an explicit ID map |
| `users` | `auth.users` + `clinic_members` + `clinic_member_branches` | Never migrate local password hashes, session tokens, or recovery tokens as Supabase credentials |
| `patients` | `clinic_patients` | Map every current patient field; preserve file numbers and branch IDs |
| appointments | `clinic_appointments` | Map chair/appointment fields; schema may need more columns |
| visit notes / diagnoses | `clinic_clinical_records` | Clinical data access must be limited by role and branch |
| planned/completed procedures | `clinic_treatment_items` | Confirm current fields and price/discount semantics |
| invoices / payments | `clinic_invoices` + `clinic_invoice_payments` | Keep a ledger; do not infer payments from invoice totals |
| `procs` | `clinic_services` | Map names, categories, prices, active status |
| `items`, `sups` | `clinic_inventory_items`, `clinic_suppliers`, `clinic_inventory_movements` | Stock quantity should be reconciled against movement history |
| `labs` | `clinic_lab_cases` | Preserve case status and due/received dates |
| `audit` | `clinic_audit_events` | Prefer server-authenticated actor IDs; do not trust client-supplied identity |

## Important gaps before app integration

1. The existing local role names and permissions are not fully aligned with the proposed Supabase roles. The current code defines `owner`, `manager`, `dentist`, `reception`, `accountant`, and `readonly`; the SQL also reserves `invmgr` and `nurse`. Do not enable those extra roles until the UI and permission matrix are reviewed and implemented consistently.
2. The current app has local role checks. These checks can improve the UI but are not security boundaries; database RLS must independently enforce access.
3. Some existing features do not yet have a destination table, including chair/resource scheduling, detailed receipts/refunds, supplier balances, and any other fields discovered during the complete code audit. Add explicit tables/columns before migrating those records.
4. Existing browser data may differ between devices. Do not automatically merge local `dcos1` blobs; make a validated, owner-initiated import with a preview, backup, row counts, and conflict report.
5. Keep local backup/export available until the migration has been verified and two-device tests pass.

## Safe rollout sequence

1. Finish a field-by-field audit of all reads/writes in `index.html`.
2. Complete the schema for every currently supported feature and run SQL lint/security tests in a disposable Supabase project.
3. Add Supabase Auth sign-in and clinic onboarding while retaining a local backup/export path.
4. Build a one-time import preview; import only after validation and explicit confirmation.
5. Implement repository/data-access functions per module; replace direct writes to `D` incrementally.
6. Test owner, manager, dentist, reception, accountant, read-only, and any enabled specialist roles against both allowed and forbidden operations.
7. Test concurrent edits, network loss, session expiry, backups, and two Android devices.
8. Only then build a candidate APK; do not merge into `main` until the candidate passes.

## Security checklist for every new table

- Enable RLS.
- Grant only the SQL privileges required.
- Use server-derived `auth.uid()` for actor identity.
- Check clinic membership and branch access in every policy.
- Enforce role-specific insert/update/delete separately.
- Avoid exposing service-role/secret keys in HTML, APK, or GitHub.
- Test negative cases (unauthorized role, inactive member, other clinic, unassigned branch).
