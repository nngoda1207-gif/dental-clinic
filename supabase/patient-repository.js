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
  'id', 'clinic_id', 'branch_id', 'file_no', 'full_name', 'phone', 'phone_alt',
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
    no: row.file_no,
    name: row.full_name,
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
 * Create one remote patient. Caller must explicitly map local branch IDs to a
 * remote branch UUID and provide a stable file number. Never bulk-imports D.
 */
export async function createRemotePatient({ clinicId, branchId, fileNo, patient } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const file_no = requireId(fileNo, 'Patient file number');
  if (file_no.length > 80) throw new Error('Patient file number is too long.');
  const userId = await currentUserId();
  const payload = {
    clinic_id: clinicId,
    branch_id: branchId,
    file_no,
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
export async function updateRemotePatient({ clinicId, branchId, patientId, patient } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  requireId(patientId, 'Remote patient ID');
  await currentUserId();
  const payload = { ...normalizePatient(patient), updated_at: new Date().toISOString() };
  const { data, error } = await getSupabaseClient()
    .from('clinic_patients')
    .update(payload)
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .select(PATIENT_FIELDS)
    .single();
  if (error) throw error;
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
