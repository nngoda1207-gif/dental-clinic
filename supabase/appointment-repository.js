/*
 * Appointment records are stored in clinic_records, one row per appointment.
 * All writes go through a SECURITY DEFINER RPC that validates patient/dentist
 * links and prevents cross-device dentist/chair overlap before committing.
 */
import { getSupabaseClient } from './auth-adapter.js';

const FIELDS = 'id,clinic_id,branch_id,module,record_key,payload,revision,deleted_at,created_by,updated_by,created_at,updated_at';

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
function normalizePayload(input = {}, recordKey) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.kind !== 'appointment') {
    throw new Error('Invalid appointment cloud payload.');
  }
  const key = requireId(recordKey, 'Appointment record key');
  if (String(input.source_local_id || '') !== key) throw new Error('Appointment local identity does not match its cloud record key.');
  const start = new Date(input.starts_at), end = new Date(input.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error('Appointment end must be after its start.');
  }
  const status = String(input.status || '');
  if (!['scheduled','confirmed','arrived','completed','cancelled','no_show'].includes(status)) {
    throw new Error('Unsupported appointment status.');
  }
  const patientRecordId = requireId(String(input.patient_record_id || ''), 'Linked cloud patient ID');
  const patientFileNo = requireId(String(input.patient_file_no || ''), 'Patient file number');
  const dentistUsername = requireId(String(input.dentist_username || ''), 'Mapped cloud dentist username').toLowerCase();
  const chairName = String(input.chair_name || '').trim();
  if (chairName.length > 120) throw new Error('Chair name is too long.');
  return {
    kind: 'appointment', source_local_id: key,
    patient_record_id: patientRecordId, patient_file_no: patientFileNo,
    dentist_username: dentistUsername, chair_name: chairName,
    starts_at: start.toISOString(), ends_at: end.toISOString(), status,
    source: String(input.source || '').trim().slice(0,120),
    reason: String(input.reason || '').trim().slice(0,500),
    notes: String(input.notes || '').trim().slice(0,2000),
    history: Array.isArray(input.history) ? input.history.slice(-100) : []
  };
}
function friendlyAppointmentError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('APPOINTMENT_OVERLAP')) return 'يوجد تعارض مع موعد آخر للطبيب أو الكرسي. حدّث جدول المواعيد قبل الحفظ.';
  if (message.includes('APPOINTMENT_REVISION_CONFLICT')) return 'تم تعديل الموعد من جهاز آخر. تم إيقاف الحفظ حتى تتم مراجعة النسخة الأحدث.';
  if (message.includes('APPOINTMENT_PATIENT_NOT_LINKED')) return 'المريض غير مربوط بالسحابة في هذا الفرع. حدّث مزامنة المرضى أولًا.';
  if (message.includes('APPOINTMENT_DENTIST_NOT_LINKED_TO_BRANCH')) return 'حساب الطبيب غير مربوط بالعيادة أو غير مسند لهذا الفرع.';
  if (message.includes('APPOINTMENT_PERMISSION_DENIED')) return 'صلاحيات حسابك لا تسمح بتعديل المواعيد.';
  if (message.includes('APPOINTMENT_ALREADY_EXISTS')) return 'الموعد موجود بالفعل في السحابة؛ حدّث البيانات قبل إعادة المحاولة.';
  return message || 'تعذر حفظ الموعد في السحابة.';
}
async function saveAppointmentRecord({ clinicId, branchId, recordKey, payload, expectedRevision = null } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const key = requireId(recordKey, 'Appointment record key');
  const body = normalizePayload(payload, key);
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
    throw new Error('A valid cloud appointment revision is required.');
  }
  const { data, error } = await getSupabaseClient().rpc('save_clinic_appointment_record', {
    p_clinic_id: clinicId,
    p_branch_id: branchId,
    p_record_key: key,
    p_payload: body,
    p_expected_revision: expectedRevision
  });
  if (error) throw new Error(friendlyAppointmentError(error));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The cloud appointment save returned no record.');
  return row;
}

export async function listRemoteAppointments({ clinicId, branchId, from, to, limit = 1000 } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 1000, 2000));
  const { data, error } = await getSupabaseClient().from('clinic_records')
    .select(FIELDS).eq('clinic_id', clinicId).eq('branch_id', branchId)
    .eq('module', 'appointments').is('deleted_at', null)
    .order('updated_at', { ascending: true }).limit(boundedLimit);
  if (error) throw error;
  const start = from ? new Date(from).getTime() : -Infinity;
  const end = to ? new Date(to).getTime() : Infinity;
  return (data || []).filter(row => {
    const p = row.payload || {};
    if (p.kind !== 'appointment') return false;
    const t = new Date(p.starts_at).getTime();
    return Number.isFinite(t) && t >= start && t < end;
  });
}

export async function listRemoteAppointmentEvents({ clinicId, branchId, appointmentId } = {}) {
  requireId(clinicId, 'Remote clinic ID');
  requireId(branchId, 'Remote branch ID');
  requireId(appointmentId, 'Remote appointment ID');
  const { data, error } = await getSupabaseClient().from('clinic_records')
    .select('id,clinic_id,branch_id,module,payload')
    .eq('id', appointmentId).eq('clinic_id', clinicId).eq('branch_id', branchId)
    .eq('module', 'appointments').is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!data) return [];
  return Array.isArray(data.payload?.history) ? data.payload.history : [];
}

export async function createRemoteAppointment({ clinicId, branchId, recordKey, payload } = {}) {
  return saveAppointmentRecord({ clinicId, branchId, recordKey, payload, expectedRevision: null });
}
export async function upsertRemoteAppointmentFromLocal({ clinicId, branchId, recordKey, payload, expectedRevision = null } = {}) {
  return saveAppointmentRecord({ clinicId, branchId, recordKey, payload, expectedRevision });
}
export async function updateRemoteAppointment({ clinicId, branchId, recordKey, payload, expectedRevision } = {}) {
  if (expectedRevision === undefined || expectedRevision === null) {
    throw new Error('A cloud version token is required before updating an appointment.');
  }
  return saveAppointmentRecord({ clinicId, branchId, recordKey, payload, expectedRevision });
}
