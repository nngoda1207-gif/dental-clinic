import { cloudContext } from './cloud-records.js';

const COLLECTIONS = {
  appointments: 'appts',
  inventory: 'items',
  labs: 'lab',
  prices: 'procs',
  suppliers: 'sups',
  audit: 'audit'
};
const clone = value => JSON.parse(JSON.stringify(value ?? null));
const keyOf = (module, row, index) => String(row?.id ?? row?.no ?? module + '-' + index);
const branchFor = (row, state, map, label) => {
  const localId = row?.br ?? row?.branchId ?? state.branches?.[0]?.id;
  const id = map?.[String(localId)];
  if (!id) throw new Error('BRANCH_MAPPING_REQUIRED:' + label + ':' + String(localId));
  return id;
};

export function previewLocalMigration(localState, branchMap) {
  if (!localState || typeof localState !== 'object') throw new Error('LOCAL_STATE_NOT_FOUND');
  const missing = (localState.branches || []).filter(b => !branchMap?.[String(b.id)]).map(b => b.name || b.id);
  const counts = {};
  for (const [module, property] of Object.entries(COLLECTIONS))
    counts[module] = Array.isArray(localState[property]) ? localState[property].length : 0;
  counts.patients = Array.isArray(localState.patients) ? localState.patients.length : 0;
  counts.finance = (localState.patients || []).filter(p => Array.isArray(p.pay) && p.pay.length).reduce((n,p)=>n+p.pay.length,0);
  counts.treatment = (localState.patients || []).reduce((n,p)=>n+(Array.isArray(p.plan)?p.plan.length:0)+(Array.isArray(p.visits)?p.visits.length:0)+(Array.isArray(p.notes)?p.notes.length:0),0);
  counts.settings = localState.settings ? 1 : 0;
  counts.branches = Array.isArray(localState.branches) ? localState.branches.length : 0;
  counts.chairs = Array.isArray(localState.chairs) ? localState.chairs.length : 0;
  counts.labs_directory = Array.isArray(localState.labs) ? localState.labs.length : 0;
  return {counts,total:Object.values(counts).reduce((a,b)=>a+b,0),missingBranchMappings:missing,
    excluded:['local user accounts, password hashes and refresh tokens (Supabase Auth replaces these)']};
}

/*
 * Owner-triggered, additive migration. Existing records are never overwritten.
 * Local state is never deleted or modified. Medical/treatment and payment data
 * are split from patient identity records into separate permission domains.
 */
export async function migrateLocalClinicState(localState, branchMap, onProgress = () => {}) {
  const c = await cloudContext();
  if (c.membership.role !== 'owner') throw new Error('OWNER_ONLY_MIGRATION');
  const preview = previewLocalMigration(localState, branchMap);
  if (preview.missingBranchMappings.length) throw new Error('BRANCH_MAPPING_REQUIRED:' + preview.missingBranchMappings.join(', '));
  const rows = [];
  const addCollection = (module, property) => {
    const list = Array.isArray(localState[property]) ? localState[property] : [];
    list.forEach((source,index)=>rows.push({
      module,branchId:branchFor(source,localState,branchMap,property),
      recordKey:keyOf(module,source,index),payload:clone(source)
    }));
  };
  for (const [module,property] of Object.entries(COLLECTIONS)) addCollection(module,property);
  // Appointments resources (chairs) are stored in the appointments permission domain.
  (localState.chairs || []).forEach((x,i)=>rows.push({module:'appointments',branchId:branchFor(x,localState,branchMap,'chairs'),recordKey:'chair:'+keyOf('chair',x,i),payload:clone(x)}));
  // Lab directory entries and lab cases are separate keys within the labs domain.
  (localState.labs || []).forEach((x,i)=>rows.push({module:'labs',branchId:branchFor(x,localState,branchMap,'labs-directory'),recordKey:'lab-directory:'+keyOf('lab-directory',x,i),payload:clone(x)}));
  const patientCoreFields=['id','no','name','en','gov','so','tg','ph','ph2','em','dob','g','ad','ec','st','br','created','by','byr'];
  (localState.patients || []).forEach((p,i)=>{
    const branchId=branchFor(p,localState,branchMap,'patients');
    const core={}; for(const k of patientCoreFields) if(k in p) core[k]=clone(p[k]);
    rows.push({module:'patients',branchId,recordKey:keyOf('patients',p,i),payload:core});
    if(Array.isArray(p.pay)&&p.pay.length) rows.push({module:'finance',branchId,recordKey:'patient-payments:'+keyOf('patients',p,i),payload:{patientId:p.id,patientNo:p.no,entries:clone(p.pay)}});
    const clinical={};
    for(const k of ['plan','visits','notes','medical','allergies','history']) if(Array.isArray(p[k])&&p[k].length) clinical[k]=clone(p[k]);
    if(Object.keys(clinical).length) rows.push({module:'treatment',branchId,recordKey:'patient-clinical:'+keyOf('patients',p,i),payload:{patientId:p.id,patientNo:p.no,...clinical}});
  });
  (localState.branches || []).forEach((b,i)=>rows.push({module:'branches',branchId:branchMap[String(b.id)],recordKey:'branch-profile',payload:{localId:String(b.id),name:b.name||'',address:b.address||'',phone:b.phone||'',hours:b.hours||''}}));
  if(localState.settings) {
    const branchId=branchFor({},localState,branchMap,'settings');
    rows.push({module:'settings',branchId,recordKey:'clinic-settings',payload:{...clone(localState.settings),seq:localState.seq||0,rseq:localState.rseq||0,lseq:localState.lseq||0}});
  }
  const imported=[],conflicts=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const {data:existing,error:readError}=await c.db.from('clinic_records').select('id')
      .eq('clinic_id',c.clinicId).eq('branch_id',row.branchId).eq('module',row.module).eq('record_key',row.recordKey).maybeSingle();
    if(readError) throw readError;
    if(existing){conflicts.push({module:row.module,key:row.recordKey});onProgress({done:i+1,total:rows.length,imported:imported.length,conflicts:conflicts.length});continue;}
    const {data,error}=await c.db.from('clinic_records').insert({
      clinic_id:c.clinicId,branch_id:row.branchId,module:row.module,record_key:row.recordKey,
      payload:row.payload,created_by:c.userId,updated_by:c.userId,revision:1
    }).select('id').single();
    if(error) throw new Error('IMPORT_FAILED:'+row.module+':'+row.recordKey+':'+error.message);
    imported.push(data.id);
    onProgress({done:i+1,total:rows.length,imported:imported.length,conflicts:conflicts.length});
  }
  return {total:rows.length,imported:imported.length,conflicts,localDataPreserved:true,excluded:preview.excluded};
}
