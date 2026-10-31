import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repo = readFileSync('supabase/appointment-repository.js','utf8');
const service = readFileSync('supabase/appointment-sync-service.js','utf8');
const rpc = readFileSync('supabase/026_server_guarded_appointments.sql','utf8');
const sqlTest = readFileSync('supabase/tests/appointment-records.test.sql','utf8');

for (const fn of ['listRemoteAppointments','listRemoteAppointmentEvents','createRemoteAppointment','updateRemoteAppointment','upsertRemoteAppointmentFromLocal']) {
  assert.ok(repo.includes('export async function '+fn), 'repository exports '+fn);
}
assert.ok(repo.includes(".from('clinic_records')"), 'appointments use the deployed generic cloud record store');
assert.ok(repo.includes(".eq('module', 'appointments')"), 'appointment reads are module-scoped');
assert.ok(repo.includes("rpc('save_clinic_appointment_record'"), 'appointment writes use the server-guarded RPC');
assert.ok(repo.includes('p_expected_revision: expectedRevision'), 'appointment updates use atomic optimistic revision checks');
assert.ok(repo.includes('source_local_id: key'), 'local appointment identity is explicit and stable');
assert.ok(repo.includes("String(input.source_local_id || '') !== key"), 'payload identity must match the cloud record key');
assert.ok(repo.includes('A cloud version token is required before updating an appointment.'), 'updates without a revision token are rejected');
assert.ok(repo.includes('Appointment end must be after its start.'), 'appointment end must follow its start');
assert.ok(repo.includes("['scheduled','confirmed','arrived','completed','cancelled','no_show']"), 'appointment status values are allowlisted');
assert.ok(repo.includes('patient_record_id') && repo.includes('dentist_username') && repo.includes('chair_name'), 'appointment links use cloud-safe patient, dentist and chair identities');
assert.ok(service.includes('requireActiveClinicContext(await getCurrentClinicMembership())'), 'every operation requires an authenticated clinic membership');
assert.ok(service.includes('requireAssignedRemoteBranch(context, branchId, branches.map(branch => branch.id))'), 'every operation is restricted to an assigned branch');
for (const fn of ['listAppointmentsForAssignedBranch','listAppointmentEventsForAssignedBranch','createAppointmentInAssignedBranch','upsertAppointmentInAssignedBranch','updateAppointmentInAssignedBranch']) {
  assert.ok(service.includes('export async function '+fn), 'guarded service exports '+fn);
}
assert.doesNotMatch(repo+service,/localStorage|dcos1|service_role|secret key/i);

assert.match(rpc,/security definer/i);
assert.match(rpc,/set search_path = ''/i);
assert.match(rpc,/auth\.uid\(\)/i);
assert.match(rpc,/private\.can_access_clinic_record/);
assert.match(rpc,/APPOINTMENT_PATIENT_NOT_LINKED/);
assert.match(rpc,/APPOINTMENT_DENTIST_NOT_LINKED_TO_BRANCH/);
assert.match(rpc,/APPOINTMENT_OVERLAP/);
assert.match(rpc,/revision = revision \+ 1/);
assert.match(rpc,/revision = p_expected_revision/);
assert.match(rpc,/APPOINTMENT_REVISION_CONFLICT/);
assert.match(rpc,/revoke all on function public\.save_clinic_appointment_record[\s\S]*from public, anon/i);
assert.match(rpc,/grant execute on function public\.save_clinic_appointment_record[\s\S]*to authenticated/i);
assert.match(sqlTest,/Same-dentist appointment overlap must be rejected/);
assert.match(sqlTest,/APPOINTMENT_REVISION_CONFLICT/);
assert.match(sqlTest,/APPOINTMENT_PERMISSION_DENIED/);

console.log('Guarded generic-record appointment sync safety checks passed.');
