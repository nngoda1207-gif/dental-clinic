/*
 * Clinical-record repository. No receptionist/accountant access is granted here;
 * PostgreSQL RLS is the final authorization boundary.
 */
import { getSupabaseClient } from './auth-adapter.js';
const FIELDS = 'id,clinic_id,branch_id,patient_id,appointment_id,dentist_user_id,record_type,occurred_at,complaint,examination,diagnosis,treatment,notes,created_by,created_at,updated_at';
const TYPES = new Set(['visit','diagnosis','prescription','consent','note']);
function required(value,label){if(typeof value!=='string'||!value.trim())throw new Error(label+' is required.');return value.trim();}
function dateValue(value,label){const d=new Date(value||Date.now());if(Number.isNaN(d.getTime()))throw new Error(label+' must be a valid date/time.');return d.toISOString();}
function fields(input={}) {
 const record_type=input.record_type||'visit';
 if(!TYPES.has(record_type))throw new Error('Unsupported clinical record type.');
 return {record_type,occurred_at:dateValue(input.occurred_at,'Record date'),
  dentist_user_id:input.dentist_user_id||null,complaint:String(input.complaint||'').trim(),
  examination:String(input.examination||'').trim(),diagnosis:String(input.diagnosis||'').trim(),
  treatment:String(input.treatment||'').trim(),notes:String(input.notes||'').trim()};
}
async function userId(){const {data,error}=await getSupabaseClient().auth.getSession();if(error)throw error;if(!data.session?.user?.id)throw new Error('Sign in before accessing clinical records.');return data.session.user.id;}
export async function listRemoteClinicalRecords({clinicId,branchId,patientId,limit=200}={}) {
 required(clinicId,'Remote clinic ID');required(branchId,'Remote branch ID');required(patientId,'Remote patient ID');
 const {data,error}=await getSupabaseClient().from('clinic_clinical_records').select(FIELDS)
  .eq('clinic_id',clinicId).eq('branch_id',branchId).eq('patient_id',patientId)
  .order('occurred_at',{ascending:false}).limit(Math.max(1,Math.min(Number(limit)||200,500)));
 if(error)throw error;return data||[];
}
export async function createRemoteClinicalRecord({clinicId,branchId,patientId,appointmentId,record}={}) {
 required(clinicId,'Remote clinic ID');required(branchId,'Remote branch ID');required(patientId,'Remote patient ID');
 const actor=await userId();
 const payload={clinic_id:clinicId,branch_id:branchId,patient_id:patientId,
  appointment_id:appointmentId||null,...fields(record),created_by:actor};
 const {data,error}=await getSupabaseClient().from('clinic_clinical_records').insert(payload).select(FIELDS).single();
 if(error)throw error;return data;
}
export async function updateRemoteClinicalRecord({clinicId,branchId,recordId,record}={}) {
 required(clinicId,'Remote clinic ID');required(branchId,'Remote branch ID');required(recordId,'Remote clinical record ID');
 await userId();
 const {data,error}=await getSupabaseClient().from('clinic_clinical_records')
  .update({...fields(record),updated_at:new Date().toISOString()})
  .eq('id',recordId).eq('clinic_id',clinicId).eq('branch_id',branchId).select(FIELDS).single();
 if(error)throw error;return data;
}
