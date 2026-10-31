/*
 * Pure mapping helpers for local-first appointments stored as one module-scoped
 * clinic_records row each. Local patient/user/chair IDs are never treated as
 * cloud IDs; the caller must supply explicit stable links.
 */
const LOCAL_TO_REMOTE_STATUS = Object.freeze({
  new: 'scheduled', conf: 'confirmed', confirmed: 'confirmed',
  arr: 'arrived', wait: 'arrived', in: 'arrived',
  done: 'completed', cp: 'cancelled', cc: 'cancelled', ns: 'no_show'
});
const REMOTE_TO_LOCAL_STATUS = Object.freeze({
  scheduled: 'new', confirmed: 'conf', arrived: 'arr',
  completed: 'done', no_show: 'ns'
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error('Missing explicit appointment mapping: ' + label);
  }
  return value;
}
function validRemoteUuid(value, label) {
  const id = String(required(value, label));
  if (!UUID.test(id)) throw new Error(label + ' must be a remote UUID.');
  return id;
}
export function localAppointmentStatusToRemote(status) {
  const mapped = LOCAL_TO_REMOTE_STATUS[status];
  if (!mapped) throw new Error('Unsupported local appointment status: ' + status);
  return mapped;
}
export function remoteAppointmentStatusToLocal(status, existingLocalStatus = '') {
  if (status === 'cancelled' && ['cp','cc'].includes(existingLocalStatus)) return existingLocalStatus;
  const mapped = REMOTE_TO_LOCAL_STATUS[status];
  if (!mapped && status !== 'cancelled') throw new Error('Unsupported remote appointment status: ' + status);
  if (status === 'cancelled') return 'cc';
  return mapped;
}

/** Map local IDs to stable patient file number, cloud dentist username and chair name. */
export function mapLocalAppointmentToRemote(local, maps = {}) {
  if (!local || typeof local !== 'object') throw new Error('A local appointment is required.');
  const patient = (maps.patients || []).find(p =>
    String(p.id) === String(local.pid) && p.br === local.br && p.remoteId && p.no
  );
  if (!patient) throw new Error('Appointment patient is not linked to a cloud patient.');
  const dentistUsername = String(required((maps.dentists || {})[local.dr], 'dentist username')).trim().toLowerCase();
  const chairName = local.ch ? String(required((maps.chairs || {})[local.ch], 'chair name')).trim() : '';
  const branchId = validRemoteUuid((maps.branches || {})[local.br], 'branch');
  const start = new Date(local.start);
  const duration = Number(local.dur);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(duration) || duration < 5 || duration > 480) {
    throw new Error('Local appointment date or duration is invalid.');
  }
  const recordKey = String(required(local.cloudRecordKey || local.id, 'stable local appointment ID'));
  const payload = {
    kind: 'appointment',
    source_local_id: recordKey,
    patient_record_id: validRemoteUuid(patient.remoteId, 'patient record'),
    patient_file_no: String(patient.no),
    dentist_username: dentistUsername,
    chair_name: chairName,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + duration * 60000).toISOString(),
    status: localAppointmentStatusToRemote(local.st),
    source: String(local.src || ''),
    reason: String(local.type || ''),
    notes: String(local.note || ''),
    history: Array.isArray(local.hist) ? local.hist.slice(-100) : []
  };
  return {
    branchId, recordKey, expectedRevision: Number.isSafeInteger(local.cloudRevision) ? local.cloudRevision : null,
    payload
  };
}

/** Rebuild local references by stable file number, username and chair name. */
export function mapRemoteAppointmentToLocal(remote, maps = {}, existing = null) {
  if (!remote || typeof remote !== 'object' || !remote.payload) throw new Error('A remote appointment record is required.');
  const payload = remote.payload;
  const localBranchId = Object.keys(maps.branches || {}).find(id => maps.branches[id] === remote.branch_id);
  const patient = (maps.patients || []).find(p =>
    p.br === localBranchId && (p.remoteId === payload.patient_record_id || String(p.no) === String(payload.patient_file_no))
  );
  const localDentistId = Object.keys(maps.dentists || {}).find(id =>
    String(maps.dentists[id]).toLowerCase() === String(payload.dentist_username || '').toLowerCase()
  );
  const localChairId = payload.chair_name
    ? Object.keys(maps.chairs || {}).find(id => maps.chairs[id] === payload.chair_name)
    : '';
  if (!localBranchId || !patient || !localDentistId || (payload.chair_name && !localChairId)) {
    throw new Error('Remote appointment is missing an explicit local branch, patient, dentist or chair mapping.');
  }
  const localId = String(required(existing?.id || payload.source_local_id || remote.record_key, 'stable local appointment identity'));
  const status = remoteAppointmentStatusToLocal(payload.status, existing?.st);
  const start = new Date(payload.starts_at);
  const end = new Date(payload.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error('Remote appointment time range is invalid.');
  }
  return {
    ...(existing || {}),
    id: localId, cloudRecordKey: remote.record_key, remoteId: remote.id,
    cloudRevision: remote.revision, cloudUpdatedAt: remote.updated_at,
    pid: patient.id, br: localBranchId, dr: localDentistId, ch: localChairId || '',
    start: new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0,16),
    dur: Math.round((end - start) / 60000),
    st: status, type: payload.reason || '', note: payload.notes || '', src: payload.source || '',
    hist: Array.isArray(payload.history) ? payload.history : (Array.isArray(existing?.hist) ? existing.hist : [])
  };
}
