import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/013_patient_realtime_publication.sql', 'utf8');
const repository = readFileSync('supabase/patient-repository.js', 'utf8');
const service = readFileSync('supabase/patient-sync-service.js', 'utf8');
const portal = readFileSync('supabase/cloud-portal.js', 'utf8');

assert.match(migration, /supabase_realtime/, 'migration must target the Supabase Realtime publication');
assert.match(migration, /clinic_patients/, 'migration must publish patient changes');
assert.match(migration, /pg_publication_tables/, 'migration must be idempotent');
assert.match(repository, /postgres_changes/, 'repository must subscribe to Postgres changes');
assert.match(repository, /branch_id=eq\./, 'subscription must be branch-filtered');
assert.match(repository, /removeChannel\(channel\)/, 'subscription cleanup must be available');
assert.match(service, /resolveScope\(branchId\)/, 'service must validate member branch before subscribing');
assert.match(portal, /refreshPatientsAfterRealtime/, 'cloud patient view must refresh after notifications');
assert.match(portal, /patientRealtimeUnsubscribe\(\)/, 'cloud portal must clean up its live subscription');
console.log('Patient Realtime publication and subscription checks passed.');
