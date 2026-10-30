import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/014_patient_local_identity.sql', 'utf8');
const repository = readFileSync('supabase/patient-repository.js', 'utf8');
const service = readFileSync('supabase/patient-sync-service.js', 'utf8');
const importer = readFileSync('supabase/patient-import-service.js', 'utf8');
const portal = readFileSync('supabase/cloud-portal.js', 'utf8');
const index = readFileSync('index.html', 'utf8');

assert.match(migration, /add column if not exists source_local_id text/i);
assert.match(migration, /unique \(clinic_id, branch_id, source_local_id\)/i);
assert.match(repository, /source_local_id/);
assert.match(repository, /upsertRemotePatientFromLocal/);
assert.match(repository, /\.eq\('source_local_id', stableLocalId\)/);
assert.match(service, /upsertPatientInAssignedBranch/);
assert.match(importer, /localId: row\.localId/);
assert.match(portal, /dcos_patient_sync_queue_v1/);
assert.match(portal, /flushPatientSyncQueue/);
assert.match(portal, /dcos:patient-saved/);
assert.match(portal, /enablePatientSync/);
assert.match(index, /dcos:patient-saved/);
assert.match(index, /localBranchId/);
console.log('Stable patient identity and local-to-cloud sync bridge checks passed.');
