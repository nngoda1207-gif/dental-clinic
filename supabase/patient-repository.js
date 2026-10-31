/*
 * Patient demographics repository backed by the deployed clinic_records table.
 * Only the explicitly approved demographic snapshot is stored here. Clinical
 * notes, visits, plans, prescriptions, payments and local user credentials remain
 * outside this module and must use their own role-scoped workflows.
 */
import { getSupabaseClient, getCurrentSupabaseSession } from './auth-adapter.js';
import { normalizePatient } from './patient-validation.js';

const FIELDS = 'id,clinic_id,branch_id,module,record_key,payload,revision,deleted_at,created_by,updated_by,created_at,updated_at';
const MODULE = 'patients';
const DEMOGRAPHIC_KEYS = [
  'full_name','english_name','governorate','source','tags','assigned_dentist_user_id',
  'phone','phone_alt','email','date_of_birth','sex','address','emergency_contact','status'
];

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
async function currentUserId() {
  const session = await getCurrentSupabaseSession();
  if (!session?.user?.id) throw new Error('Sign in before accessing clinic data.');
  return session.user.id;
}
function demographicPayload(patient, { localId, fileNo } = {}) {
  const normalized = normalizePatient(patient);
  const payload = {};
  for (const key of DEMOGRAPHIC_KEYS) payload[key] = normalized[key];
  if (localId !== undefined) payload.sourceLocalId = String(localId);
  if (fileNo !== undefined) payload.fileNo = String(fileNo);
  return payload;
}
function toLocalPatient(row) {
  const p = row.payload || {};
  return {
    id: row.id,
    remoteId: row.id,
    sourceLocalId: p.sourceLocalId || '',
    no: p.fileNo || row.record_key,
    name: p.full_name || '',
    en: p.english_name || '',
    gov: p.governorate || '',
    so: p.source || '',
    tg: Array.isArray(p.tags) ? p.tags : [],
    remoteDentistId: p.assigned_dentist_user_id || '',
    ph: p.phone || '',
    ph2: p.phone_alt || '',
    em: p.email || '',
    dob: p.date_of_birth || '',
    g: p.sex === 'male' ? 'ذكر' : p.sex === 'female' ? 'أنثى' : '',
    ad: p.address || '',
    ec: p.emergency_contact || '',
    st: p.status || 'active',
    br: row.branch_id,
    remoteClinicId: row.clinic_id,
    created: row.created_at,
    remoteUpdatedAt: row.updated_at,
    remoteRevision: row.revision,
    remoteCreatedBy: row.created_by
  };
}
function patientQuery({ clinicId, branchId }) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  return getSupabaseClient().from('clinic_records')
    .select(FIELDS)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .eq('module', MODULE)
    .is('deleted_at', null);
}
async function updateDemographics({ clinicId, branchId, row, patient, localId, fileNo, expectedUpdatedAt }) {
  const userId = await currentUserId();
  if (!expectedUpdatedAt) throw new Error('إصدار المزامنة غير معروف؛ حدّث بيانات السحابة أولًا قبل الكتابة.');
  const payload = demographicPayload(patient, { localId, fileNo });
  const { data, error } = await getSupabaseClient().from('clinic_records')
    .update({
      payload, revision: Number(row.revision) + 1,
      updated_by: userId, updated_at: new Date().toISOString()
    })
    .eq('id', row.id)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .eq('module', MODULE)
    .eq('revision', row.revision)
    .eq('updated_at', expectedUpdatedAt)
    .is('deleted_at', null)
    .select(FIELDS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('تغير سجل المريض على جهاز آخر منذ آخر مزامنة. تم إيقاف التعديل للمراجعة بدل استبدال بيانات أحدث.');
  return toLocalPatient(data);
}

/** List patients in one explicitly selected remote branch. */
export async function listRemotePatients({ clinicId, branchId, limit = 500 } = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
  const { data, error } = await patientQuery({ clinicId, branchId })
    .order('created_at', { ascending: false })
    .limit(boundedLimit);
  if (error) throw error;
  return (data || []).map(toLocalPatient);
}

/** Read every patient using bounded pages so import duplicate checks are complete. */
export async function listAllRemotePatients({ clinicId, branchId } = {}) {
  const all = [], pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await patientQuery({ clinicId, branchId })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all.map(toLocalPatient);
}

/** Create demographics only; file number is the stable per-branch record key. */
export async function createRemotePatient({ clinicId, branchId, fileNo, patient, localId } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const key = requireId(fileNo, 'Patient file number');
  if (key.length > 80 || key.length > 160) throw new Error('Patient file number is too long.');
  const userId = await currentUserId();
  const payload = demographicPayload(patient, { localId, fileNo: key });
  const { data, error } = await getSupabaseClient().from('clinic_records')
    .insert({
      clinic_id: clinicId, branch_id: branchId, module: MODULE,
      record_key: key, payload, revision: 1,
      created_by: userId, updated_by: userId
    })
    .select(FIELDS)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('رقم الملف مستخدم بالفعل في هذا الفرع السحابي. راجع السجل قبل استيراده.');
    throw error;
  }
  return toLocalPatient(data);
}

/** Update a linked patient only when the timestamp/revision still match. */
export async function updateRemotePatient({ clinicId, branchId, patientId, patient, expectedUpdatedAt } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  requireId(patientId, 'Remote patient ID');
  requireId(expectedUpdatedAt, 'Cloud update version');
  const { data: row, error: readError } = await patientQuery({ clinicId, branchId })
    .eq('id', patientId).maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error('سجل المريض السحابي غير موجود أو لم يعد متاحًا.');
  return updateDemographics({ clinicId, branchId, row, patient, expectedUpdatedAt });
}

/** Archive in place; preserve the demographic row and all separate clinical history. */
export async function archiveRemotePatient({ clinicId, branchId, patientId } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  requireId(patientId, 'Remote patient ID');
  const { data: row, error } = await patientQuery({ clinicId, branchId }).eq('id', patientId).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('سجل المريض السحابي غير موجود أو لم يعد متاحًا.');
  const userId = await currentUserId();
  const payload = { ...row.payload, status: 'archived' };
  const { data, error: updateError } = await getSupabaseClient().from('clinic_records')
    .update({ payload, revision: Number(row.revision) + 1, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('clinic_id', clinicId).eq('branch_id', branchId)
    .eq('module', MODULE).eq('revision', row.revision).eq('updated_at', row.updated_at)
    .is('deleted_at', null).select(FIELDS).maybeSingle();
  if (updateError) throw updateError;
  if (!data) throw new Error('تغير سجل المريض على جهاز آخر؛ لم يتم أرشفته.');
  return toLocalPatient(data);
}

/**
 * Subscribe to branch record changes and forward only patient-module events.
 * Realtime must be enabled for public.clinic_records in the Supabase project.
 */
export function subscribeToRemotePatientChanges({ clinicId, branchId, onChange, onStatus } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  if (typeof onChange !== 'function') throw new Error('A patient change callback is required.');
  const client = getSupabaseClient();
  const channel = client.channel('clinic-record-patients-' + branchId)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'clinic_records',
      filter: 'branch_id=eq.' + branchId
    }, payload => {
      const row = payload.new || payload.old;
      if (row?.module === MODULE) onChange(payload);
    })
    .subscribe(status => { if (typeof onStatus === 'function') onStatus(status); });
  return () => client.removeChannel(channel);
}

/** Idempotent demographics-only upsert keyed by the stable file number. */
export async function upsertRemotePatientFromLocal({ clinicId, branchId, localId, fileNo, patient, expectedUpdatedAt } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const stableLocalId = requireId(localId, 'Local patient ID');
  const key = requireId(fileNo, 'Patient file number');
  if (key.length > 160) throw new Error('Patient file number is too long.');
  const { data: existing, error } = await patientQuery({ clinicId, branchId })
    .eq('record_key', key).maybeSingle();
  if (error) throw error;
  if (existing) {
    if (String(existing.payload?.sourceLocalId || '') !== stableLocalId) {
      throw new Error('رقم الملف مستخدم لسجل غير مربوط بهذا الجهاز. يلزم ربط يدوي قبل المزامنة لتجنب استبدال بيانات مريض آخر.');
    }
    return updateDemographics({
      clinicId, branchId, row: existing, patient,
      localId: stableLocalId, fileNo: key, expectedUpdatedAt
    });
  }
  return createRemotePatient({ clinicId, branchId, fileNo: key, patient, localId: stableLocalId });
}
