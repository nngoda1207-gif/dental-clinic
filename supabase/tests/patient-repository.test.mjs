import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repo = readFileSync('supabase/patient-repository.js', 'utf8');
const auth = readFileSync('supabase/auth-adapter.js', 'utf8');
const validation = readFileSync('supabase/patient-validation.js', 'utf8');
const schema = readFileSync('supabase/002_operational_tables.sql', 'utf8');
const patientFields = readFileSync('supabase/009_patient_profile_fields.sql', 'utf8');
const mapping = readFileSync('supabase/003_app_mapping.md', 'utf8');

for (const method of [
  'listRemotePatients',
  'listAllRemotePatients',
  'createRemotePatient',
  'updateRemotePatient',
  'archiveRemotePatient'
]) {
  assert.match(repo, new RegExp('export async function ' + method + '\\b'), method + ' must be exported');
}

assert.match(repo, /\.eq\('clinic_id', clinicId\)/, 'reads/writes must be clinic-scoped');
assert.match(repo, /\.eq\('branch_id', branchId\)/, 'reads/writes must be branch-scoped');
assert.match(repo, /\.from\('clinic_records'\)/, 'patient demographics must use the deployed generic clinic_records table');
assert.match(repo, /\.eq\('module', MODULE\)/, 'patient queries must be restricted to the patients module');
assert.match(repo, /sourceLocalId/, 'stable local patient identity must be retained in the payload');
assert.match(repo, /record_key: key/, 'file number must remain the per-branch duplicate key');
assert.doesNotMatch(repo, /\.from\('clinic_patients'\)/, 'live patient sync must not depend on unapplied normalized tables');
assert.match(repo, /\.range\(offset, offset \+ pageSize - 1\)/, 'full import comparison must paginate through all remote patients');
assert.match(repo, /if \(page\.length < pageSize\) break/, 'pagination must stop only after the final partial page');
assert.match(repo, /created_by: userId/, 'creator must come from the authenticated session');
assert.match(repo, /status: 'archived'/, 'archiving should preserve patient history');
assert.match(validation, /Date of birth must be a valid date in the past/, 'invalid calendar/future birth dates must be rejected');
assert.match(validation, /Patient status is invalid/, 'unknown status values must not silently become active');
assert.match(validation, /Sex must be male, female, other, or empty/, 'unknown sex values must not be silently discarded');
assert.match(validation, /Patient email address is invalid/, 'malformed email must be rejected');
assert.match(validation, /One or more patient profile fields are too long/, 'oversized patient profile fields must be rejected');
assert.doesNotMatch(repo, /localStorage|dcos1|\.from\(['"]clinic_state['"]\)/, 'repository must not sync the local D blob');
assert.match(auth, /storageKey:\s*'dcos_supabase_auth_v1'/, 'Supabase auth storage must be isolated from the app dataset');
assert.ok(auth.includes('export async function listAssignedRemoteBranches(clinicId)'), 'assigned branch listing must be explicit');
assert.ok(auth.includes(".eq('user_id', session.user.id)"), 'branch assignments must be scoped to the authenticated user');
assert.ok(auth.includes(".eq('active', true)"), 'inactive branches must not be returned');
assert.ok(auth.includes(".in('id', ids)"), 'branch details must be limited to assigned branch IDs');

for (const policy of [
  'clinic_patients_select',
  'clinic_patients_insert',
  'clinic_patients_update',
  'clinic_patients_delete'
]) {
  assert.ok(schema.includes('create policy ' + policy), 'missing patient RLS policy: ' + policy);
}
assert.match(schema, /created_by = auth\.uid\(\)/, 'patient creation must bind creator to auth.uid()');
for (const field of ['english_name', 'governorate', 'source', 'assigned_dentist_user_id', 'tags']) {
  assert.match(patientFields, new RegExp('add column if not exists ' + field), 'missing patient field: ' + field);
  assert.ok(repo.includes(field), 'repository must map patient field: ' + field);
}
assert.match(mapping, /Do not automatically merge local `dcos1` blobs/, 'migration plan must prohibit blind local blob merging');

console.log('Patient repository static safety checks passed.');

assert.match(repo, /export function subscribeToRemotePatientChanges\b/, 'realtime subscription must be exported');
assert.match(repo, /postgres_changes/, 'live updates must subscribe to Supabase Postgres changes');
assert.match(repo, /filter: 'branch_id=eq\.' \+ branchId/, 'live updates must be restricted to the selected branch');
assert.match(repo, /removeChannel\(channel\)/, 'live update subscriptions must be removable');
