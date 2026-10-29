# Supabase setup for Dental Clinic OS

## Current status

- `001_clinic_membership.sql` is an initial, additive schema for a clinic, staff memberships, branches, and branch assignments.
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

1. Review and test the clinic/member/branch schema.
2. Add normalized tables and policies for the app's records, with least-privilege access.
3. Add Supabase Auth and a controlled migration path for existing local accounts.
4. Implement load/save and conflict handling in the app.
5. Test with two devices and test each role/branch before merging.
6. Build and install a new APK only after the web app tests pass.
