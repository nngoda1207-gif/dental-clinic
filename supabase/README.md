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
- `010_atomic_invoice_payments.sql` makes invoice payment/refund posting atomic and append-only.
- `011_invoice_items_and_service_pricing.sql` adds immutable invoice-line snapshots from the clinic service catalog.
- `012_treatment_to_invoice.sql` links completed treatment items to invoice lines, locks treatment rows during billing, and prevents a treatment item from being invoiced twice.
- `013_patient_realtime_publication.sql` adds `clinic_patients` to the Supabase Realtime publication when it exists, enabling branch-scoped live refresh notifications; it does not write local app data.
- `014_patient_local_identity.sql` adds a stable local patient ID to the cloud patient row so demographic updates from the same device can be retried idempotently without creating duplicates.
- `015_patient_updated_at_trigger.sql` advances the patient version timestamp on every update so optimistic concurrency checks can detect changes made by any client.

- `018_clinical_local_identity.sql` adds stable local IDs for clinical records, treatment items, odontogram observations, periodontal measurements, prescription items and consents; it also adds optimistic-version timestamps and Realtime publication for the clinical tables. It is schema groundwork only: local clinical records are not yet imported or automatically synchronized.
- `017_inventory_idempotent_posting.sql` adds stable local inventory-item identity, item version timestamps, and an idempotent stock-movement RPC. Replaying the same local movement ID with the same payload returns the original ledger row; a changed payload is rejected. Inventory quantities are changed only through this atomic RPC, never through metadata sync.
- `016_appointment_local_identity.sql` adds a stable local appointment identity, booking source, explicit chair mapping, branch-consistency enforcement, updated-at versioning, immutable appointment event capture, and Realtime publication for appointments and their event history. The appointment repository now supports branch-scoped idempotent writes, optimistic concurrency, and event-history reads. It is still a data-access foundation only: no appointment UI sync is enabled until each local dentist is explicitly mapped to a Supabase Auth user, each chair is mapped to a remote chair, patient links exist, and event/status history has a tested import/merge workflow.
- `009_patient_profile_fields.sql` adds missing patient-form fields (English name, governorate, source, assigned dentist Auth ID, and tags) without changing existing records.
- `003_app_mapping.md` maps the existing UI/data to the proposed schema; `TEST_PLAN.md` lists required synthetic-data RLS and migration tests.
- `.github/workflows/supabase-schema-test.yml` runs migrations `001`–`018` against a disposable PostgreSQL service and executes synthetic smoke tests. This is a compatibility smoke test, not a substitute for testing on Supabase itself.
- `auth-adapter.js` provides Supabase Auth and membership/branch lookup, plus email/password account signup and password-reset email requests. `cloud-portal.js` is loaded by the app as a separate cloud workspace: it accepts a project URL and publishable/anon key on-device, signs in through Supabase Auth, validates active membership and assigned branches, supports first-owner clinic/branch creation, and reads patients from the selected remote branch. Password reset includes a recovery-session callback and a new-password completion form; the redirect URL still must be allowlisted in the Supabase Auth URL configuration.
- The cloud workspace is intentionally separate from the local login and local `D` object. After the owner completes a protected backup and explicitly approves the local-to-cloud branch mapping, new or edited patient demographics are queued locally and synced to the assigned cloud branch using a stable local patient ID. The queue retries when the device is online and the cloud account is signed in. A file-number collision with an older cloud row that has no stable local link is blocked for manual review rather than overwritten. The patient demographic merge is designed for two-way synchronization: local edits enter a retryable outbox, while Realtime changes from the cloud are merged into the mapped local `D` object on each signed-in device. Remote-only edits apply; simultaneous divergent edits are retained as conflicts rather than silently overwritten. The explicit initial importer uploads only patient demographics and pages through all remote patient rows for duplicate checks. This code path still requires a real Supabase project and two-device integration test before production use. Clinical, appointment, inventory, lab, and financial sync are not enabled in the live UI.
- `clinic-context.js` validates active membership and explicit remote branch assignment for UI gating; PostgreSQL RLS remains authoritative.
- `import-preview.js` is also not wired into the app; it is a tested safety primitive, not a production import workflow.
- `import-preview.js` is a read-only legacy-backup preview: it checks patient demographics and explicit branch mappings, reports blocked rows and unmodeled top-level modules, and never writes data.
- `inventory-repository.js` / `inventory-sync-service.js` provide branch-scoped inventory metadata reads, stable-ID metadata upserts without changing stock quantities, and stock movement posting through the retry-safe RPC from migration 017. They are not wired into the live UI; local item and movement IDs, supplier IDs, and the full inventory movement history still need an explicit import preview and two-device tests.
- `financial-repository.js` / `financial-sync-service.js` provide branch-scoped invoice creation from active service-catalog lines or completed treatment items, immutable invoice-item snapshots, invoice/payment reads, and payment/refund RPC calls. `treatment-repository.js` / `treatment-sync-service.js` list active services and patient treatment items, add planned items, associate them with a service, and mark planned items done/cancelled under clinical-role and assigned-branch checks. Only owner/manager/accountant can create invoices, post payments, or issue refunds; reception/readonly can read according to RLS. Migration 010 makes payment/refund ledger inserts RPC-only, locks the invoice while checking the outstanding balance, and keeps all entries immutable.
- Clinical-record updates now require the caller's last-seen `updated_at` token; missing/stale versions are rejected. Creation can carry a stable local ID. This prevents blind last-write-wins, but a full clinical import preview, detail-child identity reconciliation and UI integration remain required.
- `clinical-record-repository.js` / `clinical-record-sync-service.js` provide branch-scoped clinical visit records; `clinical-details-repository.js` / `clinical-details-sync-service.js` cover medical history, odontogram, and periodontal measurements; `prescription-consent-repository.js` / `prescription-consent-sync-service.js` cover prescription items and consent metadata. These modules are isolated prototypes and are **not wired into the live UI**.
- Prescription-item inserts are subject to the existing database policy requiring the parent prescription record to have been created by the current authenticated user. Consent rows currently store metadata and a document path only; secure file upload and a verified signature workflow remain future work.
- `patient-repository.js` is the first branch-scoped data-access slice (read/create/update/archive) for normalized patients. It is not wired into the app and its field mapping is incomplete; do not treat it as production sync.
- `connection-check.html` is a standalone diagnostic that checks the project Auth endpoint, signs in a synthetic test user, reads that user's active membership under RLS, and signs out. It performs no clinic-data writes and is not part of the production app.
- The current app in `index.html` still uses local storage for its full `D` state and its custom local login.
- Migration 009 improves patient field coverage, but patient repository still is not wired into the UI. This migration does **not** turn on app sync and does **not** migrate existing local users.
- Do not put a Supabase secret/service-role key in browser or APK code.

## Before running the migration

1. The GitHub Actions PostgreSQL smoke test should pass, then test in a separate Supabase project using synthetic data only.
2. Apply all eighteen SQL files in numerical order (`001` through `018`) in a separate disposable Supabase project.
3. Follow `TEST_PLAN.md`; do not treat a successful SQL run alone as proof that role/branch security is correct.
4. Confirm the project has a recent backup.
5. Review the SQL and confirm the desired owner/member workflow.
6. Run the migration only after review; it is not automatically executed by GitHub.

## Current in-app cloud workspace

Open the **المزامنة السحابية** button in the app, enter the Supabase project URL and the public publishable/anon key, then sign in with a Supabase Auth email/password. A first-time owner can create a clinic and its primary branch. Existing members can view patient records only from branches assigned to their authenticated account. These settings are stored locally on that device; configure the second device separately. Never use a service-role/secret key in the browser or APK.

The portal never copies local users, clinical notes, financial records, or the complete `D` object to Supabase. Only explicitly mapped patient demographics are synchronized; the local merge layer never replaces clinical, appointment, or financial history. Patient demographic writes require a manually verified backup, explicit branch mapping, and owner opt-in. The local demographic outbox is retryable, but conflict handling for pre-existing legacy rows remains manual; broader writes and inbound local-database merging are not enabled.

## Why full sync is not enabled yet

The current app stores patient, visit, finance, inventory, appointment, and other records together in one browser-side JSON object. Sharing that entire object with all signed-in staff would bypass the app's role distinctions. Keep the currently working local-only APK as the fallback until a sync-enabled candidate passes the complete role and two-device test matrix. A safe implementation must either:
- move the sensitive data into normalized tables with Row Level Security policies for each role and branch, or
- use a trusted backend that authorizes each operation.

Supabase Auth must also be integrated with the current local login carefully. The app's local role checks alone are not a security boundary.

## Planned implementation order

1. Review and test all twelve SQL migrations in a separate Supabase project.
2. Audit the policies against the clinic's exact role/branch workflow; these are an initial draft and need security testing.
3. Integrate and test the Auth prototype through a controlled onboarding/invitation flow; do not migrate local password hashes.
4. Add a controlled migration path for existing local accounts.
5. Map the existing `D` object and each current screen/action to normalized records; keep backup/restore available.
6. Implement load/save, validation, and conflict handling in the app.
7. Test with two devices and test every role/branch, including attempts to access another branch.
8. Build and install a new APK only after the web app tests pass.
