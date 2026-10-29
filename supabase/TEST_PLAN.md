# Supabase RLS and migration acceptance checklist

Run only in a disposable/test Supabase project with synthetic records. Do not use real patient information for security tests.

## Migration order
1. `001_clinic_membership.sql`
2. `002_operational_tables.sql`
3. `003_supplemental_clinical_tables.sql`
4. `004_integrity_guards.sql`

The SQL files have not been executed against the user's Supabase project as part of this repository change. Treat them as reviewed drafts until tested on a separate project.

## Required test identities
Create synthetic Auth users for:
- Owner of Clinic A
- Manager assigned to Branch A1 only
- Dentist assigned to Branch A1 only
- Reception assigned to Branch A1 only
- Accountant assigned to Branch A1 only
- Read-only member assigned to Branch A1 only
- Dentist assigned only to Branch A2
- Non-member of Clinic A

Use two branches in Clinic A and a second clinic with synthetic patients.

## Required negative and positive tests
- Owner can view all branches in their clinic, but cannot read another clinic's data.
- Manager can access only assigned branches and cannot promote self/others to owner.
- Dentist can read/write clinical records, odontogram, periodontal measurements and consent data only in assigned branches.
- Reception can access patient demographics and appointments only as permitted by the approved product matrix; cannot read clinical notes, prescriptions, medical history, odontogram or periodontal measurements.
- Accountant can access invoices/payments and permitted lab finance records, but not clinical notes or medical history.
- Read-only member can read only the approved modules and cannot insert/update/delete.
- Inactive membership loses access immediately.
- A user cannot assign themselves a role, clinic membership, or branch membership.
- A record cannot reference a patient, invoice, appointment, or clinical record from another clinic.
- Medical history, tooth/perio rows, consents, lab payments and appointment events must reject a branch mismatch with their parent record.
- Appointments reject an end time that is equal to or earlier than the start time.
- Appointment events reject update/delete attempts and require the actor to be the authenticated user with an appointment-managing role.
- An update cannot move a record into a branch the user is not assigned to.
- Appointment overlap tests must eventually run through a server-side transaction/RPC; two simultaneous requests for the same chair and time must not both succeed.
- Inventory quantity changes and lab/invoice payments must be atomic and preserve append-only movement/payment history.
- Audit actor IDs must come from the authenticated identity, not a client-supplied user ID.

## Acceptance criteria before merge
- All four SQL migrations execute cleanly on a fresh disposable project.
- RLS tests pass for every role, branch, inactive user, and cross-clinic case.
- The existing app's fields have an explicit migration mapping; no field silently dropped.
- Import preview reports counts and validation failures, and a backup can be restored.
- Two-device concurrent edits, offline/network failure, expired sessions, and backup/restore are tested.
- Main UI and existing local-only workflow still work before the remote adapter is enabled.
