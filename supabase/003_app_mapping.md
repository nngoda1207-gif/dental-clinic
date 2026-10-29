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
| appointments (`appts`) | `clinic_appointments` | Preserve duration, status history, source, dentist, branch, patient and chair. **Chair/resource table is still missing.** |
| chairs/rooms (`chairs`) | New `clinic_chairs` table required | Include branch, name, active status and optional resource type; appointment conflict checks must be server-side to avoid simultaneous double-booking |
| visit notes (`patients[].visits`) | `clinic_clinical_records` | Current visit object also includes medication/material use and completed procedure references; map those to child rows rather than one opaque note |
| medical history / odontogram / perio (`mh`, `teeth`, `perio`) | New structured clinical tables or a carefully typed clinical extension | These are sensitive clinical records and must inherit the same branch/role rules; do not flatten away tooth-level history |
| prescriptions / consents (`rx`, `cons`) | `clinic_clinical_records` plus child/detail tables | Preserve signature, signer relationship, issue/void history, and prescription item details |
| planned/completed procedures (`plan`) | `clinic_treatment_items` | Preserve tooth, quantity, price, discount, status, approval and who completed it |
| patient account/payments (`pay`) | `clinic_invoices` + `clinic_invoice_payments` plus a refund/void audit model | Current receipts have sequence numbers and may be voided/refunded; do not mutate away financial history |
| `procs` | `clinic_services` | Map names, categories, units, prices and active status; app currently allows a procedure price to differ from the list price |
| `items` | `clinic_inventory_items` + `clinic_inventory_movements` | Current quantity is calculated from movement history; avoid independently updating quantity without a transaction that adds a movement |
| `sups` | `clinic_suppliers` | Current supplier totals are derived from purchase movements; consider supplier invoices/payments if supplier balances must be retained |
| `labs` (lab organizations) | New `clinic_laboratories` table recommended | Keep the lab directory separate from case snapshots |
| `lab` (lab cases) | `clinic_lab_cases` + new `clinic_lab_payments` table recommended | Preserve case number, remake links, status history, lab identity, cost and partial payments |
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


## Code-audit findings (current `main/index.html`)

- The app uses `localStorage.dcos1` for the full business dataset and keeps the active user/session in browser storage. The UI is not currently backed by Supabase.
- Local role permissions are implemented in JavaScript. They are useful for hiding controls but can be bypassed by a modified client; server RLS and carefully scoped database operations must be the actual security layer.
- The local app has more structured data than the first SQL pass currently models: tooth-level odontogram, periodontal charts, medical history, prescription/consent details, appointment chairs, lab directory, lab partial payments/remakes, receipt sequence/void/refund history, and inventory movement history.
- A safe migration needs a versioned export/backup, field-level transform, preview counts, validation errors, and an explicit import action. It must never merge entire `D` JSON blobs from different devices.
- Before allowing staff to create accounts, the owner must invite/create Supabase Auth identities and assign roles/branches in a trusted flow. A user must not be able to self-assign `owner` or add themselves to another clinic.
- Conflict handling is essential: two devices may update the same patient, inventory item or appointment. Inventory movements and payments should use transactional server operations; appointment overlap must be checked atomically on the server, not only in JavaScript.
- Preserve the current screens during the migration. Introduce a data-access layer behind existing UI functions and migrate module by module, keeping local export/restore until acceptance tests pass.
