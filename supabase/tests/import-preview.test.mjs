import assert from 'node:assert/strict';
import { previewLocalImport } from '../import-preview.js';

const clinicId = '123e4567-e89b-42d3-a456-426614174000';
const remoteBranch = '123e4567-e89b-42d3-a456-426614174001';
const validPatient = {
  id: 'local-patient-1', no: 'P-001', name: 'Synthetic Patient',
  ph: '+201000000000', g: 'أنثى', st: 'active', br: 'local-branch-1',
  visits: [{ id: 'visit-1', note: 'synthetic only' }]
};
const localState = {
  settings: { clinic: 'Synthetic clinic' },
  branches: [{ id: 'local-branch-1', name: 'Branch A' }, { id: 'local-branch-2', name: 'Branch B' }],
  users: [{ id: 'local-user-1', passwordHash: 'must-not-be-exported-to-remote-auth' }],
  patients: [validPatient, { id: 'bad-patient', name: '', ph: '1', br: 'missing-branch' }],
  appts: [{ id: 'appointment-1' }],
  customFutureModule: [{ id: 'unknown-1' }]
};

const preview = previewLocalImport({
  localState,
  clinicId,
  branchMap: { 'local-branch-1': remoteBranch }
});
assert.equal(preview.mode, 'preview-only');
assert.equal(preview.writesPerformed, 0);
assert.equal(preview.counts.patients, 2);
assert.equal(preview.counts.patientDemographicReady, 1);
assert.equal(preview.counts.patientsBlocked, 1);
assert.equal(preview.counts.patientsWithChildRecordsPending, 1);
assert.equal(preview.branchMapping.unmappedLocalBranches.length, 1);
assert.equal(preview.patientIssues[0].localRecord, 'bad-patient');
assert.ok(preview.unmodeledKeys.includes('customFutureModule'));
assert.ok(!JSON.stringify(preview).includes('Synthetic Patient'), 'preview must not echo patient names');
assert.ok(!JSON.stringify(preview).includes('must-not-be-exported'), 'preview must not expose local credentials');
assert.throws(() => previewLocalImport({ localState, clinicId: 'bad', branchMap: {} }), /valid remote clinic UUID/);
assert.throws(() => previewLocalImport({ localState, clinicId, branchMap: {} }), /explicit remote mapping/);
assert.throws(() => previewLocalImport({
  localState, clinicId,
  branchMap: { 'local-branch-1': remoteBranch, 'local-branch-2': remoteBranch }
}), /same remote branch/);

console.log('Local import preview safety tests passed.');
