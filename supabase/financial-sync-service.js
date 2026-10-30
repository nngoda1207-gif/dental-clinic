import {getCurrentClinicMembership,listAssignedRemoteBranches} from './auth-adapter.js';
import {requireActiveClinicContext,requireAssignedRemoteBranch} from './clinic-context.js';
import * as repository from './financial-repository.js';
const READ_ROLES=new Set(['owner','manager','accountant','reception','readonly']);
const WRITE_ROLES=new Set(['owner','manager','accountant']);
async function resolveScope(branchId,write=false){const context=requireActiveClinicContext(await getCurrentClinicMembership());if(!(write?WRITE_ROLES:READ_ROLES).has(context.role))throw new Error('Your clinic role does not allow this financial operation.');const branches=await listAssignedRemoteBranches(context.clinicId);const branch=requireAssignedRemoteBranch(context,branchId,branches.map(x=>x.id));return {clinicId:context.clinicId,branchId:branch.branchId};}
function requireId(value,label){if(typeof value!=='string'||!value.trim())throw new Error(label+' is required.');}
export async function listInvoicesForAssignedBranch(options={}){return repository.listRemoteInvoices({...options,...await resolveScope(options.branchId)});}
export async function listInvoiceItemsForAssignedBranch(options={}){return repository.listRemoteInvoiceItems({...options,...await resolveScope(options.branchId)});}
export async function createInvoiceWithServiceLines(options={}){const scope=await resolveScope(options.branchId,true);return repository.createRemoteInvoiceWithServiceLines({...options,...scope});}
export async function createInvoiceFromCompletedTreatments(options={}){const scope=await resolveScope(options.branchId,true);return repository.createRemoteInvoiceFromTreatmentItems({...options,...scope});}
export async function createInvoiceInAssignedBranch(options={}){throw new Error('Use createInvoiceWithServiceLines; manual-total invoices are disabled.');}
export async function listInvoicePaymentsForAssignedBranch(options={}){return repository.listRemoteInvoicePayments({...options,...await resolveScope(options.branchId)});}
export async function postPaymentForAssignedInvoice(options={}){await resolveScope(options.branchId,true);requireId(options.invoiceId,'Invoice ID');return repository.postRemoteInvoicePayment(options);}
export async function refundPaymentForAssignedInvoice(options={}){await resolveScope(options.branchId,true);requireId(options.originalPaymentId,'Original payment ID');return repository.refundRemoteInvoicePayment(options);}
