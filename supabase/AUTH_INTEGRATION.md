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


## Staff invitations (migration 022)
- The owner issues an invitation for one exact email, role, and active branch.
- The invitation returns a random one-time code; only its SHA-256 hash is stored in the database.
- The staff member creates or signs into their own Supabase Auth account, then redeems the code. The JWT email must match the invited email exactly (case-insensitive).
- Redemption creates the clinic membership and branch assignment atomically, then marks the invitation used. Expired, mismatched, and reused codes are rejected.
- The app must never create staff Auth users directly, expose a service-role key, or allow self-selected roles.
- Apply migration 022 to the target Supabase project before enabling invitation UI. CI passing is not evidence that the live project has the migration.
