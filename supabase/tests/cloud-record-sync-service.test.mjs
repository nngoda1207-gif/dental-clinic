import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repository = readFileSync(new URL('../cloud-record-repository.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../cloud-record-sync-service.js', import.meta.url), 'utf8');
const context = readFileSync(new URL('../clinic-context.js', import.meta.url), 'utf8');

for (const name of [
  'listRemoteClinicRecords', 'createRemoteClinicRecord',
  'updateRemoteClinicRecord', 'softDeleteRemoteClinicRecord'
]) assert.ok(repository.includes('export async function ' + name), name + ' must be exported');

for (const name of [
  'listRecordsForAssignedBranch', 'createRecordInAssignedBranch',
  'updateRecordInAssignedBranch', 'deleteRecordInAssignedBranch'
]) assert.ok(service.includes('export async function ' + name), name + ' must be exported');

assert.ok(repository.includes(".from('clinic_records')"), 'repository must use the deployed generic records table');
assert.ok(repository.includes(".eq('revision', expectedRevision)"), 'updates must use optimistic concurrency');
assert.ok(repository.includes('expectedRevision + 1'), 'every accepted update must advance the revision');
assert.ok(repository.includes('maybeSingle()'), 'stale/missing revisions must not silently succeed');
assert.ok(repository.includes('deleted_at'), 'deletes must be soft deletes');
assert.ok(repository.includes('CLOUD_RECORD_MODULES'), 'module names must be allowlisted');
assert.ok(!repository.includes('localStorage') && !repository.includes('dcos1'), 'repository must never upload the whole local database');
assert.ok(!repository.includes('service_role') && !repository.includes('secret key'), 'browser code must not contain privileged keys');
assert.ok(service.includes('requireActiveClinicContext(await getCurrentClinicMembership())'), 'every operation must validate active membership');
assert.ok(service.includes('listAssignedRemoteBranches(context.clinicId)'), 'every operation must reload assigned branches');
assert.ok(service.includes('requireAssignedRemoteBranch(context, branchId'), 'every operation must reject unassigned branches');
assert.ok(context.includes('The list must come from the remote clinic_member_branches query'), 'local branch IDs must not be authorization evidence');

console.log('Generic cloud record repository/service safety checks passed.');
