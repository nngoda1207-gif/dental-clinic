/*
 * Patient repository — first data-access slice for the future sync integration.
 *
 * NOT imported by index.html yet. It deliberately does not infer remote clinic or
 * branch IDs from local D IDs, and it never uploads the full local D object.
 * Every operation is scoped to a caller-supplied remote clinic/branch context;
 * Supabase RLS remains the authorization boundary.
 */
import { getSupabaseClient, getCurrentSupabaseSession } from './auth-adapter.js';
import { normalizePatient } from './patient-validation.js';

const PATIENT_FIELDS = [
  'id', 'clinic_id', 'branch_id', 'file_no', 'source_local_id', 'full_name', 'english_name', 'governorate', 'source', 'tags', 'assigned_dentist_user_id', 'phone', 'phone_alt',
  'email', 'date_of_birth', 'sex', 'address', 'emergency_contact', 'status',
  'created_by', 'created_at', 'updated_at'
].join(',');

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' is required.');
  }
  return value.trim();
}

async function currentUserId() {
  const session = await getCurrentSupabaseSession();
  if (!session?.user?.id) throw new Error('Sign in before accessing clinic data.');
  return session.user.id;
}


function toLocalPatient(row) {
  return {
    id: row.id,
    remoteId: row.id,
    sourceLocalId: row.source_local_id || '',
    no: row.file_no,
    name: row.full_name,
    en: row.english_name || '',
    gov: row.governorate || '',
    so: row.source || '',
    tg: row.tags || [],
    remoteDentistId: row.assigned_dentist_user_id || '',
    ph: row.phone,
    ph2: row.phone_alt,
    em: row.email,
    dob: row.date_of_birth || '',
    g: row.sex === 'male' ? 'ذكر' : row.sex === 'female' ? 'أنثى' : '',
    ad: row.address,
    ec: row.emergency_contact,
    st: row.status,
    br: row.branch_id,
    remoteClinicId: row.clinic_id,
    created: row.created_at,
    remoteUpdatedAt: row.updated_at,
    remoteCreatedBy: row.created_by
  };
}

/**
 * Read patients visible to the signed-in member in one explicitly selected branch.
 * Branch filtering is duplicated client-side for clarity; RLS must enforce it too.
 */
export async function listRemotePatients({ clinicId, branchId, limit = 500 } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
  const { data, error } = await getSupabaseClient()
    .from('clinic_patients')
    .select(PATIENT_FIELDS)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(boundedLimit);
  if (error) throw error;
  return (data || []).map(toLocalPatient);
}

/**
 * Read every patient in a branch using bounded pages. Import duplicate checks
 * must not silently compare against only the first 1,000 rows.
 */
export async function listAllRemotePatients({ clinicId, branchId } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const pageSize = 1000;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await getSupabaseClient()
      .from('clinic_patients')
      .select(PATIENT_FIELDS)
      .eq('clinic_id', clinicId)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all.map(toLocalPatient);
}

/**
 * Create one remote patient. Caller must explicitly map local branch IDs to a
 * remote branch UUID and provide a stable file number. Never bulk-imports D.
 */
export async function createRemotePatient({ clinicId, branchId, fileNo, patient, localId } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const file_no = requireId(fileNo, 'Patient file number');
  if (file_no.length > 80) throw new Error('Patient file number is too long.');
  const userId = await currentUserId();
  const payload = {
    clinic_id: clinicId,
    branch_id: branchId,
    file_no,
    source_local_id: localId ? String(localId) : null,
    ...normalizePatient(patient),
    created_by: userId
  };
  const { data, error } = await getSupabaseClient()
    .from('clinic_patients')
    .insert(payload)
    .select(PATIENT_FIELDS)
    .single();
  if (error) throw error;
  return toLocalPatient(data);
}

/**
 * Update only editable patient fields. Clinic, branch, file number and actor
 * cannot be reassigned through this method; database RLS and grants still apply.
 */
export async function updateRemotePatient({ clinicId, branchId, patientId, patient, expectedUpdatedAt } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  requireId(patientId, 'Remote patient ID');
  await currentUserId();
  const payload = { ...normalizePatient(patient), updated_at: new Date().toISOString() };
  let query = getSupabaseClient()
    .from('clinic_patients')
    .update(payload)
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await query.select(PATIENT_FIELDS).single();
  if (error) {
    if (expectedUpdatedAt && error.code === 'PGRST116') throw new Error('تغير سجل المريض على جهاز آخر منذ آخر مزامنة. تم إيقاف التعديل للمراجعة بدل استبدال بيانات أحدث.');
    throw error;
  }
  return toLocalPatient(data);
}

/** Archive instead of deleting patient history. */
export async function archiveRemotePatient({ clinicId, branchId, patientId } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  requireId(patientId, 'Remote patient ID');
  await currentUserId();
  const { data, error } = await getSupabaseClient()
    .from('clinic_patients')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .select(PATIENT_FIELDS)
    .single();
  if (error) throw error;
  return toLocalPatient(data);
}


/**
 * Subscribe to branch-scoped patient changes. The caller must refresh the
 * branch list on every event; RLS remains the authorization boundary.
 * Realtime must be enabled for public.clinic_patients in the Supabase project.
 */
export function subscribeToRemotePatientChanges({ clinicId, branchId, onChange, onStatus } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  if (typeof onChange !== 'function') throw new Error('A patient change callback is required.');
  const client = getSupabaseClient();
  const channel = client
    .channel('clinic-patients-' + branchId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'clinic_patients',
      filter: 'branch_id=eq.' + branchId
    }, payload => onChange(payload))
    .subscribe(status => {
      if (typeof onStatus === 'function') onStatus(status);
    });
  return () => client.removeChannel(channel);
}


/** Idempotent demographics-only upsert using the stable local patient ID. */
export async function upsertRemotePatientFromLocal({ clinicId, branchId, localId, fileNo, patient, expectedUpdatedAt } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const stableLocalId = requireId(localId, 'Local patient ID');
  const file_no = requireId(fileNo, 'Patient file number');
  if (file_no.length > 80) throw new Error('Patient file number is too long.');
  const userId = await currentUserId();
  const client = getSupabaseClient();
  const fields = { file_no, ...normalizePatient(patient), updated_at: new Date().toISOString() };

  // Update only a row carrying this exact stable local identity. Never claim a
  // legacy row by matching phone/name/file number alone.
  const existing = await client.from('clinic_patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .eq('source_local_id', stableLocalId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let result;
  if (existing.data?.id) {
    if (!expectedUpdatedAt) throw new Error('يوجد سجل سحابي مربوط بالفعل لكن إصدار المزامنة غير معروف؛ حدّث بيانات السحابة أولًا قبل الكتابة.');
    result = await client.from('clinic_patients')
      .update(fields)
      .eq('id', existing.data.id)
      .eq('clinic_id', clinicId)
      .eq('branch_id', branchId)
      .eq('updated_at', expectedUpdatedAt)
      .select(PATIENT_FIELDS)
      .single();
  } else {
    result = await client.from('clinic_patients')
      .insert({
        clinic_id: clinicId,
        branch_id: branchId,
        source_local_id: stableLocalId,
        created_by: userId,
        ...fields
      })
      .select(PATIENT_FIELDS)
      .single();
  }
  if (result.error) {
    if (result.error.code === '23505') throw new Error('رقم الملف مستخدم بالفعل في السحابة لسجل غير مربوط بهذا الجهاز. يلزم ربط السجل يدويًا قبل المزامنة لتجنب تكرار المرضى أو استبدال بيانات خاطئة.');
    if (expectedUpdatedAt && result.error.code === 'PGRST116') throw new Error('تغير سجل المريض على جهاز آخر منذ آخر مزامنة. تم إيقاف التعديل للمراجعة بدل استبدال بيانات أحدث.');
    throw result.error;
  }
  return toLocalPatient(result.data);
}
