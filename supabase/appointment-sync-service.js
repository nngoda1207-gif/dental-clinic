/*
 * Guarded appointment service. UI integration is deliberately deferred.
 * Each call requires an active clinic member and explicit remote branch assignment.
 */
import { getCurrentClinicMembership, listAssignedRemoteBranches } from './auth-adapter.js';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from './clinic-context.js';
import { listRemoteAppointments, createRemoteAppointment, updateRemoteAppointment } from './appointment-repository.js';

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
export async function createAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, true);
  return createRemoteAppointment({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function updateAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, true);
  return updateRemoteAppointment({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
