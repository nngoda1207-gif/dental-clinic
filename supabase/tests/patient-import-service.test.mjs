import assert from 'node:assert/strict';
import { preparePatientImport } from '../patient-import-service.js';

const clinicId = '123e4567-e89b-42d3-a456-426614174000';
const branchId = '123e4567-e89b-42d3-a456-426614174001';
const localState = {
  branches: [{ id: 'local-a', name: 'A' }],
  patients: [
    { id: 'p1', no: '001', name: 'Same Person', ph: '+201000000000', br: 'local-a' },
    { id: 'p2', no: '002', name: 'New Person', ph: '+201111111111', br: 'local-a' },
    { id: 'p3', no: '003', name: 'No File', ph: '+201222222222', br: 'local-a' }
  ]
};
const remotePatients = [
  { no: '001', name: 'Same Person', ph: '+201000000000', br: branchId, sourceLocalId: 'p1' },
  { no: '003', name: 'Different Person', ph: '+201333333333', br: branchId }
];
const preview = preparePatientImport({
  localState, clinicId, branchMap: { 'local-a': branchId }, remotePatients
});
assert.equal(preview.writesPerformed, 0);
assert.deepEqual(preview.counts, { new: 1, duplicate: 1, conflict: 1, blocked: 0 });
assert.equal(preview.rows.find(x => x.localId === 'p1').state, 'duplicate');
assert.equal(preview.rows.find(x => x.localId === 'p2').state, 'new');
assert.equal(preview.rows.find(x => x.localId === 'p3').state, 'conflict');
assert.ok(!JSON.stringify(preview).includes('Same Person'), 'preview must not expose patient names');
assert.throws(() => preparePatientImport({ localState, clinicId, branchMap: { 'local-a': branchId, other: branchId } }), /same remote branch/);
console.log('Patient import preview tests passed.');
