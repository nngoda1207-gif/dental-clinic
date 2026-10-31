import { cloudContext } from './cloud-records.js';

const COLLECTIONS = {
  appointments: 'appts',
  finance: 'items',
  labs: 'labs',
  treatment: 'procs',
  suppliers: 'sups',
  inventory: 'chairs',
  audit: 'audit'
};
const CORE_PATIENT_FIELDS = ['id','no','name','en','gov','so','tg','ph','ph2','em','dob','g','ad','ec','st','br'];
const clone = value => JSON.parse(JSON.stringify(value ?? null));
const keyOf = (module, row, index) => String(row?.id ?? row?.no ?? module + '-' + index);

export function previewLocalMigration(localState, branchMap) {
  if (!localState || typeof localState !== 'object') throw new Error('LOCAL_STATE_NOT_FOUND');
  const branches = Array.isArray(localState.branches) ? localState.branches : [];
  const missing = branches.filter(b => !branchMap?.[String(b.id)]).map(b => b.name || b.id);
  const counts = {};
  for (const [module, property] of Object.entries(COLLECTIONS)) {
    counts[module] = Array.isArray(localState[property]) ? localState[property].length : 0;
  }
  counts.patients = Array.isArray(localState.patients) ? localState.patients.length : 0;
  counts.prices = Array.isArray(localState.procs) ? localState.procs.length : 0;
  counts.settings = localState.settings ? 1 : 0;
  return { counts, total: Object.values(counts).reduce((a,b)=>a+b,0), missingBranchMappings: missing,
    excluded: ['users/password hashes/local sessions', 'legacy local refresh tokens'] };
}

/*
 * Explicit owner-triggered migration only. This function never deletes or
 * modifies local data. It imports one row at a time and stops on first error.
 * Existing keys are treated as conflicts rather than overwritten.
 */
export async function migrateLocalClinicState(localState, branchMap, onProgress = () => {}) {
  const c = await cloudContext();
  if (c.membership.role !== 'owner') throw new Error('OWNER_ONLY_MIGRATION');
  const preview = previewLocalMigration(localState, branchMap);
  if (preview.missingBranchMappings.length) throw new Error('BRANCH_MAPPING_REQUIRED: ' + preview.missingBranchMappings.join(', '));
  const rows = [];
  const add = (module, property, transform = x => x) => {
    const list = Array.isArray(localState[property]) ? localState[property] : [];
    list.forEach((source, index) => {
      const localBranch = source?.br ?? source?.branchId ?? localState.branches?.[0]?.id;
      const branchId = branchMap[String(localBranch)];
      if (!branchId) throw new Error('RECORD_BRANCH_MAPPING_MISSING:' + property + ':' + index);
      rows.push({ module, branchId, recordKey: keyOf(module, source, index), payload: transform(source) });
    });
  };
  add('appointments','appts');
  add('finance','items');
  add('labs','labs');
  add('treatment','procs');
  add('suppliers','sups');
  add('inventory','chairs');
  add('audit','audit');
  (localState.patients || []).forEach((p,index)=>{
    const branchId = branchMap[String(p.br ?? localState.branches?.[0]?.id)];
    if (!branchId) throw new Error('PATIENT_BRANCH_MAPPING_MISSING');
    const core = {};
    for (const field of CORE_PATIENT_FIELDS) if (field in p) core[field] = clone(p[field]);
    rows.push({module:'patients',branchId,recordKey:keyOf('patients',p,index),payload:core});
  });
  (localState.branches || []).forEach((b,index)=>{
    const remoteId = branchMap[String(b.id)];
    rows.push({module:'branches',branchId:remoteId,recordKey:'branch-profile',payload:{
      localId:String(b.id),name:b.name||'',address:b.address||'',phone:b.phone||'',hours:b.hours||''
    }});
  });
  if (localState.settings) {
    const first = localState.branches?.[0];
    const branchId = branchMap[String(first?.id)];
    if (!branchId) throw new Error('SETTINGS_BRANCH_MAPPING_MISSING');
    rows.push({module:'settings',branchId,recordKey:'clinic-settings',payload:clone(localState.settings)});
  }
  const conflicts = [], imported = [];
  for (let i=0;i<rows.length;i++) {
    const row = rows[i];
    const {data:existing,error:readError} = await c.db.from('clinic_records')
      .select('id').eq('clinic_id',c.clinicId).eq('branch_id',row.branchId)
      .eq('module',row.module).eq('record_key',row.recordKey).maybeSingle();
    if (readError) throw readError;
    if (existing) { conflicts.push({module:row.module,key:row.recordKey}); onProgress({done:i+1,total:rows.length,conflicts:conflicts.length}); continue; }
    const {data,error} = await c.db.from('clinic_records').insert({
      clinic_id:c.clinicId,branch_id:row.branchId,module:row.module,
      record_key:row.recordKey,payload:row.payload,created_by:c.userId,updated_by:c.userId,revision:1
    }).select('id').single();
    if (error) throw new Error('IMPORT_FAILED:' + row.module + ':' + row.recordKey + ':' + error.message);
    imported.push(data.id);
    onProgress({done:i+1,total:rows.length,imported:imported.length,conflicts:conflicts.length});
  }
  return {total:rows.length,imported:imported.length,conflicts,localDataPreserved:true,
    excluded:preview.excluded};
}
