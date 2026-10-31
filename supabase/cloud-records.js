import { getSupabaseClient, getCurrentClinicMembership } from './auth-adapter.js';
const MODULES = ['patients','appointments','finance','prices','inventory','labs','reports','settings','branches','audit','suppliers','treatment'];
export async function cloudContext(){
 const x=await getCurrentClinicMembership();
 if(!x?.membership?.active) throw new Error('CLOUD_MEMBERSHIP_REQUIRED');
 return {db:getSupabaseClient(),clinicId:x.membership.clinic_id,userId:x.session.user.id,membership:x.membership};
}
export async function readModule(module,branchId){
 if(!MODULES.includes(module)) throw new Error('INVALID_MODULE');
 const c=await cloudContext();
 let q=c.db.from('clinic_records').select('*').eq('clinic_id',c.clinicId).eq('module',module).is('deleted_at',null);
 if(branchId) q=q.eq('branch_id',branchId);
 const {data,error}=await q.order('updated_at',{ascending:true});
 if(error) throw error;
 return data||[];
}
export async function writeModule(module,branchId,recordKey,payload){
 if(!MODULES.includes(module)||!branchId||!recordKey||!payload||typeof payload!=='object') throw new Error('INVALID_CLOUD_RECORD');
 const c=await cloudContext();
 const {data,error}=await c.db.from('clinic_records').upsert({
  clinic_id:c.clinicId,branch_id:branchId,module,record_key:String(recordKey),
  payload,updated_by:c.userId,created_by:c.userId,revision:1
 },{onConflict:'clinic_id,branch_id,module,record_key'}).select('*').single();
 if(error) throw error;
 return data;
}
export async function watchModule(module,branchId,callback){
 if(!MODULES.includes(module)||!branchId) throw new Error('INVALID_CLOUD_SUBSCRIPTION');
 const c=await cloudContext();
 const ch=c.db.channel('records-'+c.clinicId+'-'+branchId+'-'+module)
 .on('postgres_changes',{event:'*',schema:'public',table:'clinic_records',filter:'clinic_id=eq.'+c.clinicId},e=>{
  const r=e.new&&e.new.id?e.new:e.old;
  if(r&&r.branch_id===branchId&&r.module===module) callback(e);
 }).subscribe();
 return ()=>c.db.removeChannel(ch);
}
