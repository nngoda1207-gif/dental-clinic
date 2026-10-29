# Supabase setup for Dental Clinic OS

## Current status

- `001_clinic_membership.sql` is an initial, additive schema for a clinic, staff memberships, branches, and branch assignments.
- `002_operational_tables.sql` adds normalized operational tables for patients, appointments, clinical records, treatment items, invoices/payments, services, suppliers, inventory, lab cases, and audit events.
- `003_supplemental_clinical_tables.sql` adds chairs/rooms, a laboratory directory, lab payments, medical history, tooth-level records, periodontal measurements, prescription items, consents, and appointment events.
- `004_integrity_guards.sql` adds branch-to-parent consistency triggers, appointment duration validation, and append-only appointment event protection.
- `005_ledger_and_parent_guards.sql` adds further parent-branch checks and protects payment, inventory movement, and audit ledgers from edits/deletions.
- `006_atomic_inventory_posting.sql` posts stock movements and updates balances in one transaction.
- `007_stock_privileges_and_appointment_overlap.sql` limits stock metadata updates and prevents overlapping active appointments for the same dentist.
- `008_inventory_rpc_only.sql` revokes direct authenticated inserts into the stock ledger so stock changes must use the atomic RPC.
- `003_app_mapping.md` maps the existing UI/data to the proposed schema; `TEST_PLAN.md` lists required synthetic-data RLS and migration tests.
- `.github/workflows/supabase-schema-test.yml` runs migrations `001`–`008` against a disposable PostgreSQL service and executes synthetic smoke tests. This is a compatibility smoke test, not a substitute for testing on Supabase itself.
- `auth-adapter.js` is an isolated Auth prototype only; it is not imported into the app and does not sync records.
- `connection-check.html` is a standalone diagnostic that checks the project Auth endpoint, signs in a synthetic test user, reads that user's active membership under RLS, and signs out. It performs no clinic-data writes and is not part of the production app.
- The current app in `index.html` still uses local storage for its full `D` state and its custom local login.
- This migration does **not** turn on app sync and does **not** migrate existing local users.
- Do not put a Supabase secret/service-role key in browser or APK code.

## Before running the migration

1. The GitHub Actions PostgreSQL smoke test should pass, then test in a separate Supabase project using synthetic data only.
2. Apply all eight SQL files in numerical order (`001` through `008`) in a separate disposable Supabase project.
3. Follow `TEST_PLAN.md`; do not treat a successful SQL run alone as proof that role/branch security is correct.
4. Confirm the project has a recent backup.
5. Review the SQL and confirm the desired owner/member workflow.
6. Run the migration only after review; it is not automatically executed by GitHub.

## Why the app is not syncing yet

The current app stores patient, visit, finance, inventory, appointment, and other records together in one browser-side JSON object. Sharing that entire object with all signed-in staff would bypass the app's role distinctions. A safe implementation must either:
- move the sensitive data into normalized tables with Row Level Security policies for each role and branch, or
- use a trusted backend that authorizes each operation.

Supabase Auth must also be integrated with the current local login carefully. The app's local role checks alone are not a security boundary.

## Planned implementation order

1. Review and test all five SQL migrations in a separate Supabase project.
2. Audit the policies against the clinic's exact role/branch workflow; these are an initial draft and need security testing.
3. Integrate and test the Auth prototype through a controlled onboarding/invitation flow; do not migrate local password hashes.
4. Add a controlled migration path for existing local accounts.
5. Map the existing `D` object and each current screen/action to normalized records; keep backup/restore available.
6. Implement load/save, validation, and conflict handling in the app.
7. Test with two devices and test every role/branch, including attempts to access another branch.
8. Build and install a new APK only after the web app tests pass.
