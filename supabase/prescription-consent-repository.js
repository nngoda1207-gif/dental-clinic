/*
 * Prescription items and consent records. Parent clinical records and consent
 * rows remain protected by Supabase RLS; this client module never uses service keys.
 */
import {getSupabaseClient} from './auth-adapter.js';
function required(v,label){if(typeof v!=='string'||!v.trim())throw new Error(label+' is required.');return v.trim();}
async function actor(){const {data,error}=await getSupabaseClient().auth.getSession();if(error)throw error;const id=data.session?.user?.id;if(!id)throw new Error('Sign in first.');return id;}
const RX_FIELDS='id,clinic_id,clinical_record_id,medication_name,strength,dose,route,frequency,duration,quantity,instructions,created_at';
const CONSENT_FIELDS='id,clinic_id,branch_id,patient_id,clinical_record_id,consent_type,status,signer_name,signer_relationship,signed_at,document_path,notes,created_by,created_at';
function prescriptionFields(v={}){return {
 medication_name:required(v.medication_name,'Medication name'),strength:String(v.strength||'').trim(),
 dose:String(v.dose||'').trim(),route:String(v.route||'').trim(),frequency:String(v.frequency||'').trim(),
 duration:String(v.duration||'').trim(),quantity:String(v.quantity||'').trim(),instructions:String(v.instructions||'').trim()
};}
export async function listRemotePrescriptionItems({clinicId,clinicalRecordId}={}){
 required(clinicId,'Clinic ID');required(clinicalRecordId,'Clinical record ID');
 const {data,error}=await getSupabaseClient().from('clinic_prescription_items').select(RX_FIELDS)
  .eq('clinic_id',clinicId).eq('clinical_record_id',clinicalRecordId).order('created_at',{ascending:true});
 if(error)throw error;return data||[];
}
export async function createRemotePrescriptionItem({clinicId,clinicalRecordId,item}={}){
 required(clinicId,'Clinic ID');required(clinicalRecordId,'Clinical record ID');await actor();
 const {data:parent,error:parentError}=await getSupabaseClient().from('clinic_clinical_records')
  .select('id,clinic_id,record_type').eq('clinic_id',clinicId).eq('id',clinicalRecordId).single();
 if(parentError)throw parentError;
 if(parent.record_type!=='prescription')throw new Error('Prescription items require a prescription clinical record.');
 const {data,error}=await getSupabaseClient().from('clinic_prescription_items')
  .insert({clinic_id:clinicId,clinical_record_id:clinicalRecordId,...prescriptionFields(item)})
  .select(RX_FIELDS).single();
 if(error)throw error;return data;
}
export async function listRemoteConsents({clinicId,branchId,patientId}={}){
 required(clinicId,'Clinic ID');required(branchId,'Branch ID');required(patientId,'Patient ID');
 const {data,error}=await getSupabaseClient().from('clinic_consents').select(CONSENT_FIELDS)
  .eq('clinic_id',clinicId).eq('branch_id',branchId).eq('patient_id',patientId)
  .order('created_at',{ascending:false});
 if(error)throw error;return data||[];
}
export async function createRemoteConsent(args={}){
 const clinicId=required(args.clinicId,'Clinic ID'),branchId=required(args.branchId,'Branch ID'),patientId=required(args.patientId,'Patient ID');
 const created_by=await actor(),v=args.consent||{};
 const consent_type=required(v.consent_type,'Consent type');
 const clinical_record_id=v.clinical_record_id?required(v.clinical_record_id,'Clinical record ID'):null;
 const payload={clinic_id:clinicId,branch_id:branchId,patient_id:patientId,clinical_record_id,consent_type,
  status:'draft',signer_name:String(v.signer_name||'').trim(),signer_relationship:String(v.signer_relationship||'').trim(),
  document_path:String(v.document_path||'').trim(),notes:String(v.notes||'').trim(),created_by};
 const {data,error}=await getSupabaseClient().from('clinic_consents').insert(payload).select(CONSENT_FIELDS).single();
 if(error)throw error;return data;
}
export async function updateRemoteConsentStatus(args={}){
 const clinicId=required(args.clinicId,'Clinic ID'),branchId=required(args.branchId,'Branch ID'),consentId=required(args.consentId,'Consent ID');
 await actor();const status=args.status;
 if(!['draft','signed','withdrawn','void'].includes(status))throw new Error('Unsupported consent status.');
 const patch={status};
 if(status==='signed'){patch.signer_name=required(args.signerName,'Signer name');patch.signed_at=args.signedAt?new Date(args.signedAt).toISOString():new Date().toISOString();}
 if(status==='withdrawn'||status==='void')patch.notes=String(args.notes||'').trim();
 const {data,error}=await getSupabaseClient().from('clinic_consents').update(patch)
  .eq('id',consentId).eq('clinic_id',clinicId).eq('branch_id',branchId).select(CONSENT_FIELDS).single();
 if(error)throw error;return data;
}
