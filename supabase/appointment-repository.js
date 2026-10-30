/*
 * Appointment repository — branch-scoped, idempotent appointment operations.
 * Dentist and chair IDs must be explicit remote mappings; local IDs are never
 * treated as Supabase Auth or database IDs. RLS and SQL overlap guards remain authoritative.
 */
import { getSupabaseClient, getCurrentSupabaseSession } from './auth-adapter.js';

const FIELDS = 'id,clinic_id,branch_id,patient_id,dentist_user_id,chair_id,source_local_id,source,starts_at,ends_at,status,reason,notes,created_by,created_at,updated_at';
const STATUSES = new Set(['scheduled','confirmed','arrived','completed','cancelled','no_show']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
function requireUuid(value, label) {
  const id = requireId(value, label);
  if (!UUID.test(id)) throw new Error(label + ' must be a valid remote UUID.');
  return id;
}
function validateDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(label + ' must be a valid date/time.');
  return date.toISOString();
}
function normalizeAppointment(input = {}) {
  const status = input.status || 'scheduled';
  if (!STATUSES.has(status)) throw new Error('Unsupported appointment status.');
  const starts_at = validateDate(input.starts_at, 'Appointment start');
  const ends_at = input.ends_at ? validateDate(input.ends_at, 'Appointment end') : null;
  if (!ends_at || new Date(ends_at) <= new Date(starts_at)) throw new Error('Appointment end must be after its start.');
  const dentist_user_id = requireUuid(input.dentist_user_id, 'Mapped remote dentist user ID');
  const chair_id = input.chair_id ? requireUuid(input.chair_id, 'Mapped remote chair ID') : null;
  return {
    starts_at, ends_at, status, dentist_user_id, chair_id,
    source: String(input.source || '').trim().slice(0, 120),
    reason: String(input.reason || '').trim().slice(0, 500),
    notes: String(input.notes || '').trim().slice(0, 2000)
  };
}
async function currentUserId() {
  const session = await getCurrentSupabaseSession();
  if (!session?.user?.id) throw new Error('Sign in before accessing appointments.');
  return session.user.id;
}
export async function listRemoteAppointments({ clinicId, branchId, from, to, limit = 500 } = {}) {
  requireUuid(clinicId, 'Remote clinic ID'); requireUuid(branchId, 'Remote branch ID');
  let query = getSupabaseClient().from('clinic_appointments').select(FIELDS)
    .eq('clinic_id', clinicId).eq('branch_id', branchId)
    .order('starts_at', { ascending: true }).limit(Math.max(1, Math.min(Number(limit) || 500, 1000)));
  if (from) query = query.gte('starts_at', validateDate(from, 'Range start'));
  if (to) query = query.lt('starts_at', validateDate(to, 'Range end'));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function listRemoteAppointmentEvents({ clinicId, branchId, appointmentId, limit = 100 } = {}) {
  requireUuid(clinicId, 'Remote clinic ID');
  requireUuid(branchId, 'Remote branch ID');
  requireUuid(appointmentId, 'Remote appointment ID');
  const { data, error } = await getSupabaseClient().from('clinic_appointment_events')
    .select('id,clinic_id,branch_id,appointment_id,actor_user_id,event_type,old_status,new_status,details,created_at')
    .eq('clinic_id', clinicId).eq('branch_id', branchId).eq('appointment_id', appointmentId)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(Number(limit) || 100, 500)));
  if (error) throw error;
  return data || [];
}
export async function createRemoteAppointment({ clinicId, branchId, patientId, localId, appointment } = {}) {
  requireUuid(clinicId, 'Remote clinic ID'); requireUuid(branchId, 'Remote branch ID');
  requireUuid(patientId, 'Remote patient ID');
  const userId = await currentUserId();
  const payload = {
    clinic_id: clinicId, branch_id: branchId, patient_id: patientId,
    source_local_id: localId ? requireId(String(localId), 'Local appointment ID') : null,
    ...normalizeAppointment(appointment), created_by: userId
  };
  const { data, error } = await getSupabaseClient().from('clinic_appointments')
    .insert(payload).select(FIELDS).single();
  if (error) throw error;
  return data;
}
/** Idempotent write keyed only by the stable local appointment ID. */
export async function upsertRemoteAppointmentFromLocal({
  clinicId, branchId, patientId, localId, appointment, expectedUpdatedAt
} = {}) {
  requireUuid(clinicId, 'Remote clinic ID'); requireUuid(branchId, 'Remote branch ID');
  requireUuid(patientId, 'Remote patient ID');
  const stableLocalId = requireId(String(localId || ''), 'Local appointment ID');
  const userId = await currentUserId();
  const client = getSupabaseClient();
  const fields = {
    patient_id: patientId, source_local_id: stableLocalId,
    ...normalizeAppointment(appointment)
  };
  const existing = await client.from('clinic_appointments')
    .select('id').eq('clinic_id', clinicId).eq('branch_id', branchId)
    .eq('source_local_id', stableLocalId).maybeSingle();
  if (existing.error) throw existing.error;

  let result;
  if (existing.data?.id) {
    if (!expectedUpdatedAt) throw new Error('Appointment is already linked but its cloud version is unknown; refresh before writing.');
    result = await client.from('clinic_appointments').update(fields)
      .eq('id', existing.data.id).eq('clinic_id', clinicId).eq('branch_id', branchId)
      .eq('updated_at', expectedUpdatedAt).select(FIELDS).single();
    if (result.error?.code === 'PGRST116') {
      throw new Error('Appointment changed on another device. Sync stopped to prevent overwriting the newer version.');
    }
  } else {
    result = await client.from('clinic_appointments').insert({
      clinic_id: clinicId, branch_id: branchId, created_by: userId, ...fields
    }).select(FIELDS).single();
  }
  if (result.error) throw result.error;
  return result.data;
}
export async function updateRemoteAppointment({
  clinicId, branchId, appointmentId, appointment, expectedUpdatedAt
} = {}) {
  requireUuid(clinicId, 'Remote clinic ID'); requireUuid(branchId, 'Remote branch ID');
  requireUuid(appointmentId, 'Remote appointment ID');
  await currentUserId();
  if (!expectedUpdatedAt) throw new Error('A cloud version token is required before updating an appointment.');
  const { data, error } = await getSupabaseClient().from('clinic_appointments')
    .update(normalizeAppointment(appointment))
    .eq('id', appointmentId).eq('clinic_id', clinicId).eq('branch_id', branchId)
    .eq('updated_at', expectedUpdatedAt).select(FIELDS).single();
  if (error?.code === 'PGRST116') throw new Error('Appointment changed on another device. Sync stopped to prevent overwriting the newer version.');
  if (error) throw error;
  return data;
}
