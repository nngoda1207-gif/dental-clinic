# Supabase setup for Dental Clinic OS

## Current status

- `001_clinic_membership.sql` is an initial, additive schema for a clinic, staff memberships, branches, and branch assignments.
- `002_operational_tables.sql` adds separate tables for patients, appointments, clinical records, treatment items, invoices/payments, services, suppliers, inventory, lab cases, and audit events, with initial role/branch RLS policies.
- The current app in `index.html` still uses local storage for its full `D` state and its custom local login.
- This migration does **not** turn on app sync and does **not** migrate existing local users.
- Do not put a Supabase secret/service-role key in browser or APK code.

## Before running the migration

1. Test in a separate Supabase project first.
2. Confirm the project has a recent backup.
3. Review the SQL and confirm the desired owner/member workflow.
4. Run the migration only after review; it is not automatically executed by GitHub.

## Why the app is not syncing yet

The current app stores patient, visit, finance, inventory, appointment, and other records together in one browser-side JSON object. Sharing that entire object with all signed-in staff would bypass the app's role distinctions. A safe implementation must either:
- move the sensitive data into normalized tables with Row Level Security policies for each role and branch, or
- use a trusted backend that authorizes each operation.

Supabase Auth must also be integrated with the current local login carefully. The app's local role checks alone are not a security boundary.

## Planned implementation order

1. Review and test both SQL migrations in a separate Supabase project.
2. Audit the policies against the clinic's exact role/branch workflow; these are an initial draft and need security testing.
3. Add Supabase Auth and a controlled migration path for existing local accounts.
4. Map the existing `D` object and each current screen/action to normalized records; keep backup/restore available.
5. Implement load/save, validation, and conflict handling in the app.
6. Test with two devices and test every role/branch, including attempts to access another branch.
7. Build and install a new APK only after the web app tests pass.
