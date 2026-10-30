/*
 * Pure mapping helpers for local-first appointment data.
 * No ID is guessed: patients, dentists, chairs and branches must be explicitly linked.
 */
const LOCAL_TO_REMOTE_STATUS = Object.freeze({
  new: 'scheduled', confirmed: 'confirmed',
  arr: 'arrived', wait: 'arrived', in: 'arrived',
  done: 'completed', cp: 'cancelled', cc: 'cancelled', ns: 'no_show'
});
const REMOTE_TO_LOCAL_STATUS = Object.freeze({
  scheduled: 'new', confirmed: 'confirmed', arrived: 'arr',
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
  // A new cloud cancellation has no trustworthy patient/clinic cancellation actor.
  if (status === 'cancelled') throw new Error('Cloud cancellation needs manual review because the remote schema does not record who cancelled.');
  return mapped;
}
export function mapLocalAppointmentToRemote(local, maps = {}) {
  if (!local || typeof local !== 'object') throw new Error('A local appointment is required.');
  const patient = (maps.patients || []).find(p => String(p.id) === String(local.pid) && p.br === local.br && p.remoteId);
  if (!patient) throw new Error('Appointment patient is not linked to a cloud patient.');
  const dentistId = validRemoteUuid((maps.dentists || {})[local.dr], 'dentist user');
  const chairId = local.ch ? validRemoteUuid((maps.chairs || {})[local.ch], 'chair') : null;
  const branchId = validRemoteUuid((maps.branches || {})[local.br], 'branch');
  const start = new Date(local.start);
  const duration = Number(local.dur);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(duration) || duration < 5 || duration > 480) {
    throw new Error('Local appointment date or duration is invalid.');
  }
  return {
    branchId, patientId: validRemoteUuid(patient.remoteId, 'patient'),
    localId: String(required(local.id, 'local appointment ID')),
    expectedUpdatedAt: local.cloudUpdatedAt || undefined,
    appointment: {
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + duration * 60000).toISOString(),
      status: localAppointmentStatusToRemote(local.st),
      dentist_user_id: dentistId,
      chair_id: chairId,
      source: String(local.src || ''),
      reason: String(local.type || ''),
      notes: String(local.note || '')
    }
  };
}
export function mapRemoteAppointmentToLocal(remote, maps = {}, existing = null) {
  if (!remote || typeof remote !== 'object') throw new Error('A remote appointment is required.');
  const localBranchId = Object.keys(maps.branches || {}).find(id => maps.branches[id] === remote.branch_id);
  const patient = (maps.patients || []).find(p => p.remoteId === remote.patient_id && p.br === localBranchId);
  const localDentistId = Object.keys(maps.dentists || {}).find(id => maps.dentists[id] === remote.dentist_user_id);
  const localChairId = remote.chair_id
    ? Object.keys(maps.chairs || {}).find(id => maps.chairs[id] === remote.chair_id)
    : '';
  if (!localBranchId || !patient || !localDentistId || (remote.chair_id && !localChairId)) {
    throw new Error('Remote appointment is missing an explicit local branch, patient, dentist or chair mapping.');
  }
  const localId = String(required(remote.source_local_id, 'stable local appointment identity'));
  const status = remoteAppointmentStatusToLocal(remote.status, existing?.st);
  const start = new Date(remote.starts_at);
  const end = new Date(remote.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error('Remote appointment time range is invalid.');
  }
  return {
    ...(existing || {}),
    id: localId, remoteId: remote.id, cloudUpdatedAt: remote.updated_at,
    pid: patient.id, br: localBranchId, dr: localDentistId, ch: localChairId || '',
    start: new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0,16),
    dur: Math.round((end - start) / 60000),
    st: status, type: remote.reason || '', note: remote.notes || '', src: remote.source || '',
    hist: Array.isArray(existing?.hist) ? existing.hist : []
  };
}
