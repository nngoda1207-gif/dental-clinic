# Auth adapter integration notes

## Prototype status
`auth-adapter.js` is a small ES-module prototype for Supabase Auth only. It is not imported by the current app and does not sync clinic data. It does not create users, assign roles, or upload local records.

## First data-access slice: patients

`patient-repository.js` is the first repository module, but it is still not imported by `index.html`. It provides branch-scoped read, create, update, and archive functions for the normalized `clinic_patients` table. It requires explicit remote clinic/branch UUIDs and never infers them from local branch IDs.

Before connecting it to the UI, complete these gates:
- Test each operation with owner, manager, dentist, reception, accountant, readonly, inactive, other-clinic, and unassigned-branch accounts in a disposable Supabase project.
- Decide and implement the field mapping for local-only patient fields: governorate, source, assigned dentist, tags, notes, local audit fields, and local file-number sequences.
- Build an owner-controlled import preview that maps local branch IDs to remote UUIDs and detects duplicate file numbers/phones; do not upload the whole `D` object.
- Keep local storage as the source of truth until remote CRUD and conflict/error handling pass on two devices.

The module's basic field mapping is intentionally incomplete. It must not be described as production sync or enabled in the live UI yet.

## Owner email signup and confirmation

The isolated cloud portal now exposes owner self-signup through Supabase Auth, a resend-confirmation action, and a sign-in check that rejects users whose email is not confirmed. The signup request intentionally uses the Supabase project's configured Site URL; after clicking the confirmation link, the user returns to the app and signs in with the same email/password.

Before real use, the Supabase project owner must:
- Enable email confirmations under Authentication settings.
- Configure a working SMTP provider for the clinic's recipient addresses and review the email template.
- Set the Auth Site URL and allowed redirect URLs appropriately for the deployment.
- Test a new address, click the received confirmation link, then sign in again from the app.

A successful GitHub build or local code test does not prove that Supabase delivered an email. Live delivery and post-confirmation login still require the actual project URL, public key, and a test mailbox. Do not share any service-role or secret key.

Self-signup is for creating a new clinic owner account only. Staff invitation/provisioning and linking existing local nurse accounts to Supabase Auth are not implemented yet.

## Why authentication is separate from local app users
The current app's `D.users` entries contain local password hashes and recovery/session data. These are not valid Supabase Auth credentials. Do not copy those values into `auth.users`, and do not let a browser client assign its own role or branch membership.

## Integration gates
1. Confirm the SQL migrations pass in a disposable Supabase project.
2. Fix and test all RLS policies with the role/branch matrix in `TEST_PLAN.md`.
3. Provision the clinic owner through a controlled onboarding flow; create staff identities through a trusted invitation/admin flow, not direct client writes to Auth.
4. Add an explicit clinic selector if a user can belong to multiple clinics.
5. Replace direct local data writes module by module with a repository/data-access layer.
6. Implement versioned export, preview, validation and explicit import before migrating any existing `dcos1` data.
7. Test sign-in, sign-out, expired sessions, network failure and two-device concurrency before APK integration.

## Current limitations
- The main UI remains local-only.
- The adapter expects a Supabase URL and publishable key supplied at runtime.
- The adapter does not query clinical records and must not be considered proof of authorization; database RLS remains the enforcement boundary.
