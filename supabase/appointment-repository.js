/*
 * Appointment repository — normalized remote appointment operations.
 * Not wired into index.html. PostgreSQL RLS and overlap trigger are authoritative.
 */
import { getSupabaseClient, getCurrentSupabaseSession } from './auth-adapter.js';

const FIELDS = 'id,clinic_id,branch_id,patient_id,dentist_user_id,starts_at,ends_at,status,reason,notes,created_by,created_at,updated_at';
const STATUSES = new Set(['scheduled','confirmed','arrived','completed','cancelled','no_show']);

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
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
  if (ends_at && new Date(ends_at) <= new Date(starts_at)) throw new Error('Appointment end must be after its start.');
  return {
    starts_at, ends_at, status,
    dentist_user_id: input.dentist_user_id || null,
    reason: String(input.reason || '').trim(),
    notes: String(input.notes || '').trim()
  };
}
async function currentUserId() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  if (!data.session?.user?.id) throw new Error('Sign in before accessing appointments.');
  return data.session.user.id;
}
export async function listRemoteAppointments({ clinicId, branchId, from, to, limit = 500 } = {}) {
  requireId(clinicId, 'Remote clinic ID'); requireId(branchId, 'Remote branch ID');
  let query = getSupabaseClient().from('clinic_appointments').select(FIELDS)
    .eq('clinic_id', clinicId).eq('branch_id', branchId)
    .order('starts_at', { ascending: true }).limit(Math.max(1, Math.min(Number(limit) || 500, 1000)));
  if (from) query = query.gte('starts_at', validateDate(from, 'Range start'));
  if (to) query = query.lt('starts_at', validateDate(to, 'Range end'));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function createRemoteAppointment({ clinicId, branchId, patientId, appointment } = {}) {
  requireId(clinicId, 'Remote clinic ID'); requireId(branchId, 'Remote branch ID');
  requireId(patientId, 'Remote patient ID');
  const userId = await currentUserId();
  const payload = {
    clinic_id: clinicId, branch_id: branchId, patient_id: patientId,
    ...normalizeAppointment(appointment), created_by: userId
  };
  const { data, error } = await getSupabaseClient().from('clinic_appointments')
    .insert(payload).select(FIELDS).single();
  if (error) throw error;
  return data;
}
export async function updateRemoteAppointment({ clinicId, branchId, appointmentId, appointment } = {}) {
  requireId(clinicId, 'Remote clinic ID'); requireId(branchId, 'Remote branch ID');
  requireId(appointmentId, 'Remote appointment ID');
  await currentUserId();
  const { data, error } = await getSupabaseClient().from('clinic_appointments')
    .update({ ...normalizeAppointment(appointment), updated_at: new Date().toISOString() })
    .eq('id', appointmentId).eq('clinic_id', clinicId).eq('branch_id', branchId)
    .select(FIELDS).single();
  if (error) throw error;
  return data;
}
