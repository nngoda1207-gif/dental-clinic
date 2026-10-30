/*
 * Guarded patient service for the future sync UI.
 *
 * This is not wired into index.html. It requires a live Supabase session,
 * one validated active clinic membership, and an explicitly assigned active
 * remote branch before each operation. Database RLS remains authoritative.
 */
import {
  getCurrentClinicMembership,
  listAssignedRemoteBranches
} from './auth-adapter.js';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from './clinic-context.js';
import {
  listRemotePatients,
  listAllRemotePatients,
  createRemotePatient,
  updateRemotePatient,
  archiveRemotePatient,
  subscribeToRemotePatientChanges,
  upsertRemotePatientFromLocal
} from './patient-repository.js';

const WRITE_ROLES = new Set(['owner', 'manager', 'dentist', 'reception']);

async function resolveScope(branchId, { write = false } = {}) {
  const result = await getCurrentClinicMembership();
  const context = requireActiveClinicContext(result);
  if (write && !WRITE_ROLES.has(context.role)) {
    throw new Error('Your clinic role does not allow changing patient records.');
  }

  const branches = await listAssignedRemoteBranches(context.clinicId);
  const assignedIds = branches.map(branch => branch.id);
  const scope = requireAssignedRemoteBranch(context, branchId, assignedIds);
  return { ...scope, role: context.role };
}

/** Lists patients in a branch explicitly assigned to the signed-in member. */
export async function listPatientsForAssignedBranch({ branchId, limit } = {}) {
  const scope = await resolveScope(branchId);
  return listRemotePatients({ clinicId: scope.clinicId, branchId: scope.branchId, limit });
}

/** Loads every patient in the assigned branch for duplicate-safe import preview. */
export async function listAllPatientsForAssignedBranch({ branchId } = {}) {
  const scope = await resolveScope(branchId);
  return listAllRemotePatients({ clinicId: scope.clinicId, branchId: scope.branchId });
}

/** Creates one patient after active membership, branch and role checks. */
export async function createPatientInAssignedBranch({ branchId, fileNo, patient, localId } = {}) {
  const scope = await resolveScope(branchId, { write: true });
  return createRemotePatient({
    clinicId: scope.clinicId,
    branchId: scope.branchId,
    fileNo,
    patient,
    localId
  });
}

/** Updates one patient without allowing clinic/branch/file-number reassignment. */
export async function updatePatientInAssignedBranch({ branchId, patientId, patient, expectedUpdatedAt } = {}) {
  const scope = await resolveScope(branchId, { write: true });
  return updateRemotePatient({
    clinicId: scope.clinicId,
    branchId: scope.branchId,
    patientId,
    patient,
    expectedUpdatedAt
  });
}

/** Archives a patient while retaining their linked clinical/financial history. */
export async function archivePatientInAssignedBranch({ branchId, patientId } = {}) {
  const scope = await resolveScope(branchId, { write: true });
  return archiveRemotePatient({
    clinicId: scope.clinicId,
    branchId: scope.branchId,
    patientId
  });
}


/** Subscribe only after validating active membership and explicit branch assignment. */
export async function watchPatientsForAssignedBranch({ branchId, onChange, onStatus } = {}) {
  const scope = await resolveScope(branchId);
  return subscribeToRemotePatientChanges({
    clinicId: scope.clinicId,
    branchId: scope.branchId,
    onChange,
    onStatus
  });
}


/** Idempotent demographics-only upsert for a local patient with a stable ID. */
export async function upsertPatientInAssignedBranch({ branchId, localId, fileNo, patient, expectedUpdatedAt } = {}) {
  const scope = await resolveScope(branchId, { write: true });
  return upsertRemotePatientFromLocal({
    clinicId: scope.clinicId, branchId: scope.branchId, localId, fileNo, patient, expectedUpdatedAt
  });
}
