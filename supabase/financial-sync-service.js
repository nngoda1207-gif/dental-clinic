/*
 * Role- and branch-guarded financial operations.
 * Reception/readonly can view according to SQL RLS; only owner/manager/accountant
 * can create invoices. Payment posting waits for a transaction-safe server RPC.
 */
import { getCurrentClinicMembership, listAssignedRemoteBranches } from './auth-adapter.js';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from './clinic-context.js';
import * as repository from './financial-repository.js';

const READ_ROLES = new Set(['owner','manager','accountant','reception','readonly']);
const WRITE_ROLES = new Set(['owner','manager','accountant']);
async function resolveScope(branchId, write = false) {
  const context = requireActiveClinicContext(await getCurrentClinicMembership());
  if (!(write ? WRITE_ROLES : READ_ROLES).has(context.role)) {
    throw new Error('Your clinic role does not allow this financial operation.');
  }
  const branches = await listAssignedRemoteBranches(context.clinicId);
  const branch = requireAssignedRemoteBranch(context, branchId, branches.map(item => item.id));
  return { clinicId: context.clinicId, branchId: branch.branchId };
}
export async function listInvoicesForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return repository.listRemoteInvoices({ ...options, ...scope });
}
export async function createInvoiceInAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId, true);
  return repository.createRemoteInvoice({ ...options, ...scope });
}
export async function listInvoicePaymentsForAssignedBranch(options = {}) {
  const scope = await resolveScope(options.branchId);
  return repository.listRemoteInvoicePayments({ ...options, ...scope });
}
