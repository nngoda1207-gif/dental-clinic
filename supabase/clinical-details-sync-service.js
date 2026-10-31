/*
 * Clinical detail access is restricted to clinical staff and assigned branches.
 * RLS is still the final authorization boundary.
 */
import {getCurrentClinicMembership,listAssignedRemoteBranches} from './auth-adapter.js';
import {requireActiveClinicContext,requireAssignedRemoteBranch} from './clinic-context.js';
import * as repository from './clinical-details-repository.js';
const ROLES=new Set(['owner','manager','dentist','nurse']);
async function context(branchId){
 const active=requireActiveClinicContext(await getCurrentClinicMembership());
 if(!ROLES.has(active.role))throw new Error('Your clinic role does not allow access to clinical details.');
 const branches=await listAssignedRemoteBranches(active.clinicId);
 const branch=requireAssignedRemoteBranch(active,branchId,branches.map(item=>item.id));
 return {clinicId:active.clinicId,branchId:branch.branchId};
}
async function scoped(args){const c=await context(args.branchId);return {...args,...c};}
export async function getMedicalHistoryForAssignedBranch(args={}){return repository.getRemoteMedicalHistory(await scoped(args));}
export async function saveMedicalHistoryForAssignedBranch(args={}){return repository.saveRemoteMedicalHistory(await scoped(args));}
export async function listToothRecordsForAssignedBranch(args={}){return repository.listRemoteToothRecords(await scoped(args));}
export async function createToothRecordForAssignedBranch(args={}){return repository.createRemoteToothRecord(await scoped(args));}
export async function listPeriodontalMeasurementsForAssignedBranch(args={}){return repository.listRemotePeriodontalMeasurements(await scoped(args));}
export async function createPeriodontalMeasurementForAssignedBranch(args={}){return repository.createRemotePeriodontalMeasurement(await scoped(args));}
