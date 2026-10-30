/*
 * Guarded inventory service. RLS and the atomic movement RPC enforce access;
 * this layer also requires active membership and an explicitly assigned branch.
 */
import {getCurrentClinicMembership,listAssignedRemoteBranches} from './auth-adapter.js';
import {requireActiveClinicContext,requireAssignedRemoteBranch} from './clinic-context.js';
import {
  listRemoteInventoryItems,listRemoteInventoryMovements,
  upsertRemoteInventoryItemFromLocal,postRemoteInventoryMovementFromLocal
} from './inventory-repository.js';

const WRITE_ROLES=new Set(['owner','manager','invmgr','dentist','nurse']);
async function scope(branchId,write=false){
  const context=requireActiveClinicContext(await getCurrentClinicMembership());
  if(write&&!WRITE_ROLES.has(context.role))throw new Error('Your clinic role does not allow changing inventory.');
  const branches=await listAssignedRemoteBranches(context.clinicId);
  return requireAssignedRemoteBranch(context,branchId,branches.map(x=>x.id));
}
export async function listInventoryForAssignedBranch(options={}){
  const s=await scope(options.branchId);
  return listRemoteInventoryItems({...options,clinicId:s.clinicId,branchId:s.branchId});
}
export async function listInventoryMovementsForAssignedBranch(options={}){
  const s=await scope(options.branchId);
  return listRemoteInventoryMovements({...options,clinicId:s.clinicId,branchId:s.branchId});
}
export async function upsertInventoryItemInAssignedBranch(options={}){
  const s=await scope(options.branchId,true);
  return upsertRemoteInventoryItemFromLocal({...options,clinicId:s.clinicId,branchId:s.branchId});
}
export async function postInventoryMovementInAssignedBranch(options={}){
  await scope(options.branchId,true);
  return postRemoteInventoryMovementFromLocal(options);
}
