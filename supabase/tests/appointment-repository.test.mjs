import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repository = readFileSync(new URL('../appointment-repository.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../appointment-sync-service.js', import.meta.url), 'utf8');
const mapping = readFileSync(new URL('../appointment-mapping.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../026_server_guarded_appointments.sql', import.meta.url), 'utf8');

assert.ok(repository.includes(".from('clinic_records')"), 'appointment reads must use the deployed generic record store');
assert.ok(repository.includes(".rpc('save_clinic_appointment_record'"), 'appointment writes must use the server-authoritative RPC');
assert.ok(repository.includes('p_expected_revision'), 'appointment writes must carry the expected revision');
assert.ok(repository.includes('APPOINTMENT_OVERLAP'), 'overlap errors must be surfaced');
assert.ok(repository.includes('APPOINTMENT_REVISION_CONFLICT'), 'stale edits must be surfaced');
assert.ok(service.includes('requireActiveClinicContext(await getCurrentClinicMembership())'), 'every operation must validate active membership');
assert.ok(service.includes('listAssignedRemoteBranches(context.clinicId)'), 'every operation must validate assigned branches');
assert.ok(!service.includes('WRITE_ROLES'), 'module write permissions must be decided by the database permission helper');
assert.ok(mapping.includes('patient_file_no'), 'appointments must link patients by stable file number');
assert.ok(mapping.includes('dentist_username'), 'appointments must use explicit cloud dentist usernames');
assert.ok(mapping.includes('chair_name'), 'appointments must use stable chair names, not local IDs');
assert.ok(migration.includes('private.can_access_clinic_record'), 'RPC must enforce module/branch permissions');
assert.ok(migration.includes('APPOINTMENT_PATIENT_NOT_LINKED'), 'RPC must reject unlinked patients');
assert.ok(migration.includes('APPOINTMENT_DENTIST_NOT_LINKED_TO_BRANCH'), 'RPC must reject unassigned dentists');
assert.ok(migration.includes('APPOINTMENT_OVERLAP'), 'RPC must reject dentist/chair schedule overlaps');
assert.ok(migration.includes('APPOINTMENT_REVISION_CONFLICT'), 'RPC must reject stale appointment revisions');
assert.ok(migration.includes('security definer'), 'RPC must execute under a controlled server-side boundary');
assert.ok(migration.includes('revoke all on function public.save_clinic_appointment_record'), 'RPC must not be publicly executable');
console.log('Generic appointment sync safety checks passed.');
