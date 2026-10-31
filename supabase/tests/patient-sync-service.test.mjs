import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('supabase/patient-sync-service.js', 'utf8');
const context = readFileSync('supabase/clinic-context.js', 'utf8');
const schema = readFileSync('supabase/002_operational_tables.sql', 'utf8');

for (const method of [
  'listPatientsForAssignedBranch',
  'createPatientInAssignedBranch',
  'updatePatientInAssignedBranch',
  'archivePatientInAssignedBranch',
  'watchPatientsForAssignedBranch'
]) {
  assert.ok(service.includes('export async function ' + method), method + ' must be exported');
}
assert.ok(service.includes('requireActiveClinicContext(result)'), 'service must validate active membership');
assert.ok(service.includes('listAssignedRemoteBranches(context.clinicId)'), 'service must fetch remote branch assignments');
assert.ok(service.includes('requireAssignedRemoteBranch(context, branchId, assignedIds)'), 'service must reject unassigned branches');
assert.ok(service.includes("new Set(['owner', 'manager', 'dentist', 'reception'])"), 'write role allowlist must match patient insert/update policies');
assert.ok(service.includes('if (write && !WRITE_ROLES.has(context.role))'), 'read-only roles must be blocked before patient writes');
assert.ok(service.includes('listRemotePatients({ clinicId: scope.clinicId, branchId: scope.branchId, limit })'), 'list must use validated clinic and branch scope');
assert.ok(service.includes('patientId,\n    patient') || service.includes('patientId,\n    patient\n'), 'update must pass only a selected patient ID and patient fields');
assert.ok(context.includes('The list must come from the remote clinic_member_branches query'), 'branch assignment source must be explicit');
assert.ok(schema.includes("private.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])"), 'database remains responsible for patient write role enforcement');
assert.doesNotMatch(service, /localStorage|dcos1|service_role|secret key/i, 'service must not access local blob or embed privileged credentials');

console.log('Patient sync service safety checks passed.');

assert.ok(service.includes('subscribeToRemotePatientChanges'), 'realtime watcher must use the scoped repository subscription');
assert.ok(service.includes('const scope = await resolveScope(branchId)'), 'realtime watcher must validate active membership and branch assignment');
