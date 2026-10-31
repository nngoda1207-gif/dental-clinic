const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Client-side context validation for UI gating only.
 * PostgreSQL RLS remains the actual security boundary; never trust this helper
 * as a replacement for server-side authorization.
 */
export function requireActiveClinicContext(result) {
  if (!result || !result.session?.user?.id) {
    throw new Error('Sign in with your clinic account first.');
  }
  const member = result.membership;
  if (!member || member.active !== true) {
    throw new Error('Your clinic membership is inactive or unavailable.');
  }
  if (member.user_id !== result.session.user.id) {
    throw new Error('Clinic membership does not match the signed-in user.');
  }
  if (!UUID.test(String(member.clinic_id || ''))) {
    throw new Error('Clinic membership has an invalid clinic ID.');
  }
  const allowedRoles = ['owner', 'manager', 'dentist', 'reception', 'accountant', 'readonly', 'invmgr', 'nurse'];
  if (!allowedRoles.includes(member.role)) {
    throw new Error('Clinic membership has an unsupported role.');
  }
  return Object.freeze({
    userId: result.session.user.id,
    clinicId: member.clinic_id,
    role: member.role
  });
}

/**
 * Checks a selected branch against an explicit membership branch list.
 * The list must come from the remote clinic_member_branches query; local branch
 * IDs from localStorage are not valid remote authorization evidence.
 */
export function requireAssignedRemoteBranch(context, branchId, assignedBranchIds) {
  if (!context?.userId || !UUID.test(String(context.clinicId || ''))) {
    throw new Error('A validated active clinic context is required.');
  }
  if (!UUID.test(String(branchId || ''))) {
    throw new Error('A valid remote branch ID is required.');
  }
  if (!Array.isArray(assignedBranchIds) || !assignedBranchIds.includes(branchId)) {
    throw new Error('You are not assigned to the selected clinic branch.');
  }
  return Object.freeze({ clinicId: context.clinicId, branchId, userId: context.userId, role: context.role });
}
