/*
 * Generic, revision-checked repository for clinic_records.
 * This is the safe bridge between the existing D model and module-scoped cloud
 * records. It deliberately never uploads the whole D object.
 */
import { getSupabaseClient, getCurrentSupabaseSession } from './auth-adapter.js';

export const CLOUD_RECORD_MODULES = Object.freeze([
  'patients', 'appointments', 'finance', 'prices', 'inventory', 'labs',
  'reports', 'settings', 'branches', 'audit', 'suppliers', 'treatment'
]);

const FIELDS = [
  'id', 'clinic_id', 'branch_id', 'module', 'record_key', 'payload',
  'revision', 'deleted_at', 'created_by', 'updated_by', 'created_at', 'updated_at'
].join(',');

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
function moduleName(value) {
  const name = required(value, 'Module');
  if (!CLOUD_RECORD_MODULES.includes(name)) throw new Error('Unsupported cloud record module.');
  return name;
}
function objectPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cloud record payload must be a plain object.');
  }
  return value;
}
async function currentUserId() {
  const session = await getCurrentSupabaseSession();
  if (!session?.user?.id) throw new Error('Sign in before accessing clinic data.');
  return session.user.id;
}

/** Read one module from one explicitly authorized branch. */
export async function listRemoteClinicRecords({ clinicId, branchId, module, limit = 1000 } = {}) {
  required(clinicId, 'Remote clinic ID');
  required(branchId, 'Remote branch ID');
  const name = moduleName(module);
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 1000, 2000));
  const { data, error } = await getSupabaseClient()
    .from('clinic_records')
    .select(FIELDS)
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .eq('module', name)
    .is('deleted_at', null)
    .order('updated_at', { ascending: true })
    .limit(boundedLimit);
  if (error) throw error;
  return data || [];
}

/** Create a new record. Existing keys are never silently overwritten. */
export async function createRemoteClinicRecord({ clinicId, branchId, module, recordKey, payload } = {}) {
  required(clinicId, 'Remote clinic ID');
  required(branchId, 'Remote branch ID');
  const name = moduleName(module);
  const key = required(recordKey, 'Record key');
  if (key.length > 160) throw new Error('Record key is too long.');
  const body = objectPayload(payload);
  const userId = await currentUserId();
  const { data, error } = await getSupabaseClient()
    .from('clinic_records')
    .insert({
      clinic_id: clinicId, branch_id: branchId, module: name,
      record_key: key, payload: body, revision: 1,
      created_by: userId, updated_by: userId
    })
    .select(FIELDS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update only when the caller still has the revision it last read.
 * A missing row is treated as a conflict, never as permission to recreate it.
 */
export async function updateRemoteClinicRecord({
  clinicId, branchId, module, recordKey, payload, expectedRevision
} = {}) {
  required(clinicId, 'Remote clinic ID');
  required(branchId, 'Remote branch ID');
  const name = moduleName(module);
  const key = required(recordKey, 'Record key');
  const body = objectPayload(payload);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('A valid cloud revision is required before updating a record.');
  }
  const userId = await currentUserId();
  const { data, error } = await getSupabaseClient()
    .from('clinic_records')
    .update({
      payload: body, revision: expectedRevision + 1,
      updated_by: userId, updated_at: new Date().toISOString()
    })
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .eq('module', name)
    .eq('record_key', key)
    .eq('revision', expectedRevision)
    .is('deleted_at', null)
    .select(FIELDS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('تغير السجل على جهاز آخر أو لم يعد متاحًا. تم إيقاف المزامنة لتجنب استبدال بيانات أحدث.');
  return data;
}

/** Soft-delete only; retain the row and revision history for recovery/audit. */
export async function softDeleteRemoteClinicRecord({
  clinicId, branchId, module, recordKey, expectedRevision
} = {}) {
  required(clinicId, 'Remote clinic ID');
  required(branchId, 'Remote branch ID');
  const name = moduleName(module);
  const key = required(recordKey, 'Record key');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('A valid cloud revision is required before deleting a record.');
  }
  const userId = await currentUserId();
  const { data, error } = await getSupabaseClient()
    .from('clinic_records')
    .update({
      deleted_at: new Date().toISOString(),
      revision: expectedRevision + 1,
      updated_by: userId, updated_at: new Date().toISOString()
    })
    .eq('clinic_id', clinicId)
    .eq('branch_id', branchId)
    .eq('module', name)
    .eq('record_key', key)
    .eq('revision', expectedRevision)
    .is('deleted_at', null)
    .select(FIELDS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('تغير السجل على جهاز آخر أو لم يعد متاحًا. لم يتم حذفه.');
  return data;
}
