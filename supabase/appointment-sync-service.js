/*
 * Guarded appointment service. The active membership and remote branch are
 * resolved for every request; module permissions and schedule overlap are
 * authoritatively enforced by PostgreSQL's appointment RPC and RLS helper.
 */
import { getCurrentClinicMembership, listAssignedRemoteBranches } from './auth-adapter.js';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from './clinic-context.js';
import {
  listRemoteAppointments, listRemoteAppointmentEvents, createRemoteAppointment,
  updateRemoteAppointment, upsertRemoteAppointmentFromLocal
} from './appointment-repository.js';

async function resolveScope(branchId) {
  const context = requireActiveClinicContext(await getCurrentClinicMembership());
  const branches = await listAssignedRemoteBranches(context.clinicId);
  return requireAssignedRemoteBranch(context, branchId, branches.map(branch => branch.id));
}
export async function listAppointmentsForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return listRemoteAppointments({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function listAppointmentEventsForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return listRemoteAppointmentEvents({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function createAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return createRemoteAppointment({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function upsertAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return upsertRemoteAppointmentFromLocal({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
export async function updateAppointmentInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return updateRemoteAppointment({ ...options, clinicId: scope.clinicId, branchId: scope.branchId });
}
