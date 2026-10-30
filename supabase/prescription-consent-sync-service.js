/*
 * Role- and branch-guarded prescription and consent operations.
 */
import {getCurrentClinicMembership,listAssignedRemoteBranches} from './auth-adapter.js';
import {requireActiveClinicContext,requireAssignedRemoteBranch} from './clinic-context.js';
import * as repository from './prescription-consent-repository.js';
const ROLES=new Set(['owner','manager','dentist','nurse']);
async function context(branchId){const active=requireActiveClinicContext(await getCurrentClinicMembership());
 if(!ROLES.has(active.role))throw new Error('Your clinic role cannot access prescriptions or consents.');
 const branches=await listAssignedRemoteBranches(active.clinicId);
 const branch=requireAssignedRemoteBranch(active,branchId,branches.map(x=>x.id));
 return {clinicId:active.clinicId,branchId:branch.branchId};}
export async function listPrescriptionItems(args={}){const c=await context(args.branchId);return repository.listRemotePrescriptionItems({...c,clinicalRecordId:args.clinicalRecordId});}
export async function createPrescriptionItem(args={}){const c=await context(args.branchId);return repository.createRemotePrescriptionItem({...c,clinicalRecordId:args.clinicalRecordId,sourceLocalId:args.sourceLocalId,item:args.item});}
export async function listConsents(args={}){const c=await context(args.branchId);return repository.listRemoteConsents({...c,patientId:args.patientId});}
export async function createConsent(args={}){const c=await context(args.branchId);return repository.createRemoteConsent({...c,patientId:args.patientId,sourceLocalId:args.sourceLocalId,consent:args.consent});}
export async function updateConsentStatus(args={}){const c=await context(args.branchId);return repository.updateRemoteConsentStatus({...c,consentId:args.consentId,expectedUpdatedAt:args.expectedUpdatedAt,status:args.status,signerName:args.signerName,signedAt:args.signedAt,notes:args.notes});}
