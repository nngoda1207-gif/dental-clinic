import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repo = readFileSync('supabase/patient-repository.js', 'utf8');
const auth = readFileSync('supabase/auth-adapter.js', 'utf8');
const schema = readFileSync('supabase/002_operational_tables.sql', 'utf8');
const mapping = readFileSync('supabase/003_app_mapping.md', 'utf8');

for (const method of [
  'listRemotePatients',
  'createRemotePatient',
  'updateRemotePatient',
  'archiveRemotePatient'
]) {
  assert.match(repo, new RegExp('export async function ' + method + '\\b'), method + ' must be exported');
}

assert.match(repo, /\.eq\('clinic_id', clinicId\)/, 'reads/writes must be clinic-scoped');
assert.match(repo, /\.eq\('branch_id', branchId\)/, 'reads/writes must be branch-scoped');
assert.match(repo, /created_by: userId/, 'creator must come from the authenticated session');
assert.match(repo, /status: 'archived'/, 'archiving should preserve patient history');
assert.match(repo, /Date of birth must be a valid date in the past/, 'invalid calendar/future birth dates must be rejected');
assert.match(repo, /Patient status is invalid/, 'unknown status values must not silently become active');
assert.match(repo, /Sex must be male, female, other, or empty/, 'unknown sex values must not be silently discarded');
assert.match(repo, /Patient email address is invalid/, 'malformed email must be rejected');
assert.match(repo, /One or more patient contact fields are too long/, 'oversized contact fields must be rejected');
assert.doesNotMatch(repo, /localStorage|dcos1|\.from\(['"]clinic_state['"]\)/, 'repository must not sync the local D blob');
assert.match(auth, /storageKey: 'dcos_supabase_auth_v1'/, 'Supabase auth storage must be isolated from the app dataset');

for (const policy of [
  'clinic_patients_select',
  'clinic_patients_insert',
  'clinic_patients_update',
  'clinic_patients_delete'
]) {
  assert.ok(schema.includes('create policy ' + policy), 'missing patient RLS policy: ' + policy);
}
assert.match(schema, /created_by = auth\.uid\(\)/, 'patient creation must bind creator to auth.uid()');
assert.match(mapping, /Do not automatically merge local `dcos1` blobs/, 'migration plan must prohibit blind local blob merging');

console.log('Patient repository static safety checks passed.');
