/*
 * Structured clinical detail access: medical history, odontogram and perio.
 * All calls are clinic/branch/patient scoped; PostgreSQL RLS remains authoritative.
 */
import { getSupabaseClient } from './auth-adapter.js';

function required(value,label){
  if(typeof value!=='string'||!value.trim()) throw new Error(label+' is required.');
  return value.trim();
}
async function actorId(){
  const {data,error}=await getSupabaseClient().auth.getSession();
  if(error) throw error;
  const id=data.session?.user?.id;
  if(!id) throw new Error('Sign in before accessing clinical details.');
  return id;
}
function client(){return getSupabaseClient();}
const HISTORY_FIELDS='id,clinic_id,branch_id,patient_id,allergies,medical_conditions,medications,prior_surgeries,notes,updated_by,created_at,updated_at';
const TOOTH_FIELDS='id,clinic_id,branch_id,patient_id,tooth_code,surface_code,finding_code,finding_label,status,notes,recorded_by,occurred_at,created_at';
const PERIO_FIELDS='id,clinic_id,branch_id,patient_id,tooth_code,site_code,pocket_depth_mm,recession_mm,bleeding,plaque,notes,recorded_by,measured_at,created_at';
function textFields(input,keys){const out={};for(const key of keys)out[key]=String(input?.[key]??'').trim();return out;}
function scope({clinicId,branchId,patientId}={}){
 return {clinic_id:required(clinicId,'Remote clinic ID'),branch_id:required(branchId,'Remote branch ID'),patient_id:required(patientId,'Remote patient ID')};
}
export async function getRemoteMedicalHistory(args={}){
 const s=scope(args);
 const {data,error}=await client().from('clinic_patient_medical_history').select(HISTORY_FIELDS)
  .eq('clinic_id',s.clinic_id).eq('branch_id',s.branch_id).eq('patient_id',s.patient_id).maybeSingle();
 if(error)throw error;return data;
}
export async function saveRemoteMedicalHistory(args={}){
 const s=scope(args), actor=await actorId();
 const payload={...s,...textFields(args.history,['allergies','medical_conditions','medications','prior_surgeries','notes']),updated_by:actor,updated_at:new Date().toISOString()};
 const {data,error}=await client().from('clinic_patient_medical_history')
  .upsert(payload,{onConflict:'clinic_id,patient_id'}).select(HISTORY_FIELDS).single();
 if(error)throw error;return data;
}
export async function listRemoteToothRecords(args={}){
 const s=scope(args);
 const {data,error}=await client().from('clinic_tooth_records').select(TOOTH_FIELDS)
  .eq('clinic_id',s.clinic_id).eq('branch_id',s.branch_id).eq('patient_id',s.patient_id)
  .order('occurred_at',{ascending:false}).limit(1000);
 if(error)throw error;return data||[];
}
export async function createRemoteToothRecord(args={}){
 const s=scope(args),actor=await actorId(),v=args.record||{};
 const tooth_code=required(v.tooth_code,'Tooth code');
 const status=v.status||'active';
 if(!['active','resolved','historical'].includes(status))throw new Error('Unsupported tooth-record status.');
 const payload={...s,tooth_code,surface_code:String(v.surface_code||'').trim(),finding_code:String(v.finding_code||'').trim(),
  finding_label:String(v.finding_label||'').trim(),status,notes:String(v.notes||'').trim(),recorded_by:actor,
  occurred_at:v.occurred_at?new Date(v.occurred_at).toISOString():new Date().toISOString()};
 const {data,error}=await client().from('clinic_tooth_records').insert(payload).select(TOOTH_FIELDS).single();
 if(error)throw error;return data;
}
export async function listRemotePeriodontalMeasurements(args={}){
 const s=scope(args);
 const {data,error}=await client().from('clinic_periodontal_measurements').select(PERIO_FIELDS)
  .eq('clinic_id',s.clinic_id).eq('branch_id',s.branch_id).eq('patient_id',s.patient_id)
  .order('measured_at',{ascending:false}).limit(2000);
 if(error)throw error;return data||[];
}
export async function createRemotePeriodontalMeasurement(args={}){
 const s=scope(args),actor=await actorId(),v=args.measurement||{};
 const tooth_code=required(v.tooth_code,'Tooth code');
 const payload={...s,tooth_code,site_code:String(v.site_code||'').trim(),notes:String(v.notes||'').trim(),recorded_by:actor,
  measured_at:v.measured_at?new Date(v.measured_at).toISOString():new Date().toISOString()};
 for(const key of ['pocket_depth_mm','recession_mm'])if(v[key]!==undefined&&v[key]!==null&&v[key]!==''){
  const n=Number(v[key]);if(!Number.isFinite(n))throw new Error(key+' must be numeric.');payload[key]=n;
 }
 for(const key of ['bleeding','plaque'])if(v[key]!==undefined)payload[key]=v[key]===null?null:Boolean(v[key]);
 const {data,error}=await client().from('clinic_periodontal_measurements').insert(payload).select(PERIO_FIELDS).single();
 if(error)throw error;return data;
}
