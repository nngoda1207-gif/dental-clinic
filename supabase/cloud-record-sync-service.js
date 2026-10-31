/*
 * Guarded service for generic clinic_records.
 * Every operation revalidates the signed-in clinic membership and branch.
 * PostgreSQL RLS is the final module/role authorization boundary.
 */
import { getCurrentClinicMembership, listAssignedRemoteBranches } from './auth-adapter.js';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from './clinic-context.js';
import {
  CLOUD_RECORD_MODULES, listRemoteClinicRecords, createRemoteClinicRecord,
  updateRemoteClinicRecord, softDeleteRemoteClinicRecord
} from './cloud-record-repository.js';

async function resolveScope(branchId, module) {
  const name = String(module || '');
  if (!CLOUD_RECORD_MODULES.includes(name)) throw new Error('Unsupported cloud record module.');
  const context = requireActiveClinicContext(await getCurrentClinicMembership());
  const branches = await listAssignedRemoteBranches(context.clinicId);
  const branch = requireAssignedRemoteBranch(context, branchId, branches.map(item => item.id));
  return { clinicId: context.clinicId, branchId: branch.branchId, module: name };
}

export async function listRecordsForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, options.module);
  return listRemoteClinicRecords({ ...scope, limit: options.limit });
}
export async function createRecordInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, options.module);
  return createRemoteClinicRecord({ ...scope, recordKey: options.recordKey, payload: options.payload });
}
export async function updateRecordInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, options.module);
  return updateRemoteClinicRecord({
    ...scope, recordKey: options.recordKey, payload: options.payload,
    expectedRevision: options.expectedRevision
  });
}
export async function deleteRecordInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, options.module);
  return softDeleteRemoteClinicRecord({
    ...scope, recordKey: options.recordKey, expectedRevision: options.expectedRevision
  });
}
