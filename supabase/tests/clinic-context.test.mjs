import assert from 'node:assert/strict';
import { requireActiveClinicContext, requireAssignedRemoteBranch } from '../clinic-context.js';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const clinicId = '123e4567-e89b-42d3-a456-426614174001';
const branchA = '123e4567-e89b-42d3-a456-426614174002';
const branchB = '123e4567-e89b-42d3-a456-426614174003';
const result = {
  session: { user: { id: userId } },
  membership: { user_id: userId, clinic_id: clinicId, role: 'dentist', active: true }
};
const context = requireActiveClinicContext(result);
assert.deepEqual(context, { userId, clinicId, role: 'dentist' });
assert.deepEqual(requireAssignedRemoteBranch(context, branchA, [branchA]), {
  clinicId, branchId: branchA, userId, role: 'dentist'
});
assert.throws(() => requireActiveClinicContext(null), /Sign in/);
assert.throws(() => requireActiveClinicContext({ ...result, membership: { ...result.membership, active: false } }), /inactive/);
assert.throws(() => requireActiveClinicContext({ ...result, membership: { ...result.membership, user_id: branchA } }), /does not match/);
assert.throws(() => requireActiveClinicContext({ ...result, membership: { ...result.membership, role: 'superadmin' } }), /unsupported role/);
assert.throws(() => requireAssignedRemoteBranch(context, branchB, [branchA]), /not assigned/);
assert.throws(() => requireAssignedRemoteBranch(context, 'local-branch-id', [branchA]), /valid remote branch ID/);
assert.throws(() => requireAssignedRemoteBranch(context, branchA, null), /not assigned/);
console.log('Clinic context validation tests passed.');
