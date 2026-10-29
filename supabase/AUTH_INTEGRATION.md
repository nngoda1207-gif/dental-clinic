# Auth adapter integration notes

## Prototype status
`auth-adapter.js` is a small ES-module prototype for Supabase Auth only. It is not imported by the current app and does not sync clinic data. It does not create users, assign roles, or upload local records.

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
