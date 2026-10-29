/*
 * Clinical-record operations are restricted to clinical roles before querying.
 * RLS must independently enforce this restriction on every request.
 */
import {getCurrentClinicMembership,listAssignedRemoteBranches} from './auth-adapter.js';
import {requireActiveClinicContext,requireAssignedRemoteBranch} from './clinic-context.js';
import {listRemoteClinicalRecords,createRemoteClinicalRecord,updateRemoteClinicalRecord} from './clinical-record-repository.js';
const CLINICAL_ROLES=new Set(['owner','manager','dentist','nurse']);
async function scope(branchId,write=false){
 const context=requireActiveClinicContext(await getCurrentClinicMembership());
 if(!CLINICAL_ROLES.has(context.role))throw new Error('Your clinic role does not allow access to clinical records.');
 const branches=await listAssignedRemoteBranches(context.clinicId);
 const selected=requireAssignedRemoteBranch(context,branchId,branches.map(b=>b.id));
 return selected;
}
export async function listClinicalRecordsForAssignedBranch(options={}){
 const s=await scope(options.branchId);return listRemoteClinicalRecords({...options,clinicId:s.clinicId,branchId:s.branchId});
}
export async function createClinicalRecordInAssignedBranch(options={}){
 const s=await scope(options.branchId,true);return createRemoteClinicalRecord({...options,clinicId:s.clinicId,branchId:s.branchId});
}
export async function updateClinicalRecordInAssignedBranch(options={}){
 const s=await scope(options.branchId,true);return updateRemoteClinicalRecord({...options,clinicId:s.clinicId,branchId:s.branchId});
}
