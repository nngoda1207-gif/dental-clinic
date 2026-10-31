/*
 * Treatment plan repository. Reads and writes are explicitly scoped to a remote
 * clinic, branch and patient; RLS remains the authorization boundary.
 */
import {getSupabaseClient} from './auth-adapter.js';
const TREATMENT_FIELDS='id,clinic_id,branch_id,patient_id,clinical_record_id,tooth,procedure_name,quantity,unit_price,discount,status,created_by,created_at,service_id';
const SERVICE_FIELDS='id,clinic_id,name,category,unit,price,active,created_at,updated_at';
function required(v,label){if(typeof v!=='string'||!v.trim())throw new Error(label+' is required.');return v.trim();}
function scope({clinicId,branchId,patientId}={}){return {clinic_id:required(clinicId,'Remote clinic ID'),branch_id:required(branchId,'Remote branch ID'),patient_id:required(patientId,'Remote patient ID')};}
async function actor(){const {data,error}=await getSupabaseClient().auth.getSession();if(error)throw error;const id=data.session?.user?.id;if(!id)throw new Error('Sign in before accessing treatment plans.');return id;}
export async function listRemoteTreatmentItems(args={}){
 const s=scope(args);let q=getSupabaseClient().from('clinic_treatment_items').select(TREATMENT_FIELDS)
  .eq('clinic_id',s.clinic_id).eq('branch_id',s.branch_id).eq('patient_id',s.patient_id)
  .order('created_at',{ascending:false}).limit(Math.max(1,Math.min(Number(args.limit)||300,1000)));
 if(args.status)q=q.eq('status',args.status);
 const {data,error}=await q;if(error)throw error;return data||[];
}
export async function listRemoteActiveServices({clinicId}={}){
 required(clinicId,'Remote clinic ID');
 const {data,error}=await getSupabaseClient().from('clinic_services').select(SERVICE_FIELDS)
  .eq('clinic_id',clinicId).eq('active',true).order('name',{ascending:true}).limit(1000);
 if(error)throw error;return data||[];
}
export async function createRemoteTreatmentItem(args={}){
 const s=scope(args),v=args.item||{},created_by=await actor();
 const procedure_name=required(v.procedure_name,'Procedure name');
 const quantity=Number(v.quantity??1),unit_price=Number(v.unit_price??0),discount=Number(v.discount??0);
 if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit_price)||unit_price<0||!Number.isFinite(discount)||discount<0||Math.round(quantity*100)!==quantity*100||Math.round(unit_price*100)!==unit_price*100||Math.round(discount*100)!==discount*100)throw new Error('Quantity, price and discount must be valid amounts with at most two decimals.');
 if(discount>quantity*unit_price)throw new Error('Discount cannot exceed the procedure amount.');
 const payload={...s,procedure_name,tooth:String(v.tooth||'').trim(),quantity,unit_price,discount,status:'planned',created_by,clinical_record_id:v.clinical_record_id||null,service_id:required(v.service_id,'Service ID')};
 const {data,error}=await getSupabaseClient().from('clinic_treatment_items').insert(payload).select(TREATMENT_FIELDS).single();
 if(error)throw error;return data;
}
export async function updateRemoteTreatmentItem(args={}){
 const s=scope(args),id=required(args.treatmentItemId,'Treatment item ID'),v=args.changes||{};
 await actor();
 const patch={};
 if(v.service_id!==undefined)patch.service_id=required(v.service_id,'Service ID');
 if(v.status!==undefined){if(!['done','cancelled'].includes(v.status))throw new Error('Only completion or cancellation can be set here.');patch.status=v.status;}
 if(!Object.keys(patch).length)throw new Error('No supported treatment changes were supplied.');
 const {data,error}=await getSupabaseClient().from('clinic_treatment_items').update(patch)
  .eq('id',id).eq('clinic_id',s.clinic_id).eq('branch_id',s.branch_id).eq('patient_id',s.patient_id)
  .eq('status','planned').select(TREATMENT_FIELDS).maybeSingle();
 if(error)throw error;if(!data)throw new Error('Treatment item was not found, is not planned, or is already locked by billing.');return data;
}
