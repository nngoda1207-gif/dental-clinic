/*
 * Guarded appointment service. Every operation requires an active clinic member
 * and explicit remote branch assignment. Caller must resolve patient, dentist
 * and optional chair through explicit cloud-ID mappings before writing.
 */
import { getCurrentClinicMembership, listAssignedRemoteBranches } from './auth-adapter.js';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from './clinic-context.js';
import {
  listRemoteAppointments, listRemoteAppointmentEvents, createRemoteAppointment,
  updateRemoteAppointment, upsertRemoteAppointmentFromLocal
} from './appointment-repository.js';

const WRITE_ROLES = new Set(['owner','manager','dentist','reception']);
async function resolveScope(branchId, write = false) {
  const context = requireActiveClinicContext(await getCurrentClinicMembership());
  if (write && !WRITE_ROLES.has(context.role)) throw new Error('Your clinic role does not allow changing appointments.');
  const branches = await listAssignedRemoteBranches(context.clinicId);
  return requireAssignedRemoteBranch(context, branchId, branches.map(branch => branch.id));
}
export async function listAppointmentsForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return listRemoteAppointments({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function listAppointmentEventsForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return listRemoteAppointmentEvents({
    ...options, clinicId: scope.clinicId, branchId: scope.branchId
  });
}
export async function createAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, true);
  return createRemoteAppointment({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function upsertAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, true);
  return upsertRemoteAppointmentFromLocal({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function updateAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, true);
  return updateRemoteAppointment({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
