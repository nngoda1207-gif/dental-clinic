/*
 * Branch-scoped treatment workflow. Clinical staff can manage treatment items;
 * accountant/reception may view the service catalog but cannot edit clinical plans.
 */
import {getCurrentClinicMembership,listAssignedRemoteBranches} from './auth-adapter.js';
import {requireActiveClinicContext,requireAssignedRemoteBranch} from './clinic-context.js';
import * as repository from './treatment-repository.js';
const CLINICAL_ROLES=new Set(['owner','manager','dentist']);
const READ_ROLES=new Set(['owner','manager','dentist','nurse','readonly']);
async function resolve(branchId,write=false){
 const context=requireActiveClinicContext(await getCurrentClinicMembership());
 if(!(write?CLINICAL_ROLES:READ_ROLES).has(context.role))throw new Error('Your clinic role does not allow this treatment operation.');
 const branches=await listAssignedRemoteBranches(context.clinicId);
 return requireAssignedRemoteBranch(context,branchId,branches.map(b=>b.id));
}
export async function listTreatmentItemsForAssignedBranch(options={}){const s=await resolve(options.branchId);return repository.listRemoteTreatmentItems({...options,clinicId:s.clinicId,branchId:s.branchId});}
export async function listActiveServicesForAssignedBranch(options={}){const s=await resolve(options.branchId);return repository.listRemoteActiveServices({clinicId:s.clinicId});}
export async function addTreatmentItemToAssignedBranch(options={}){const s=await resolve(options.branchId,true);return repository.createRemoteTreatmentItem({...options,clinicId:s.clinicId,branchId:s.branchId});}
export async function updatePlannedTreatmentItemInAssignedBranch(options={}){const s=await resolve(options.branchId,true);return repository.updateRemoteTreatmentItem({...options,clinicId:s.clinicId,branchId:s.branchId});}
