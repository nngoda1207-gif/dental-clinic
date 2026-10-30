import assert from 'node:assert/strict';
import {
  localAppointmentStatusToRemote,
  remoteAppointmentStatusToLocal,
  mapLocalAppointmentToRemote,
  mapRemoteAppointmentToLocal
} from '../appointment-mapping.js';

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const patient = { id:'local-patient-1', br:'local-branch-1', remoteId:uuid(1) };
const maps = {
  branches:{'local-branch-1':uuid(2)},
  dentists:{'local-dentist-1':uuid(3)},
  chairs:{'local-chair-1':uuid(4)},
  patients:[patient]
};
assert.equal(localAppointmentStatusToRemote('wait'),'arrived');
assert.equal(localAppointmentStatusToRemote('done'),'completed');
assert.equal(remoteAppointmentStatusToLocal('cancelled','cp'),'cp');
assert.throws(()=>remoteAppointmentStatusToLocal('cancelled'),/manual review/);
const local = {
  id:'local-appt-1',pid:patient.id,br:patient.br,dr:'local-dentist-1',
  ch:'local-chair-1',start:'2032-03-04T09:30',dur:45,st:'confirmed',
  type:'Follow-up',note:'Reception note',src:'WhatsApp'
};
const remote = mapLocalAppointmentToRemote(local,maps);
assert.equal(remote.branchId,uuid(2));
assert.equal(remote.patientId,uuid(1));
assert.equal(remote.localId,'local-appt-1');
assert.equal(remote.appointment.dentist_user_id,uuid(3));
assert.equal(remote.appointment.chair_id,uuid(4));
assert.equal(remote.appointment.status,'confirmed');
assert.equal(new Date(remote.appointment.ends_at)-new Date(remote.appointment.starts_at),45*60000);
assert.throws(()=>mapLocalAppointmentToRemote(local,{...maps,dentists:{}}),/dentist user/);
assert.throws(()=>localAppointmentStatusToRemote('unknown-status'),/Unsupported local appointment status/);
assert.throws(()=>mapLocalAppointmentToRemote({...local,dur:0},maps),/date or duration is invalid/);
assert.throws(()=>mapLocalAppointmentToRemote({...local,dur:481},maps),/date or duration is invalid/);
assert.throws(()=>mapLocalAppointmentToRemote({...local,start:'not-a-date'},maps),/date or duration is invalid/);
assert.throws(()=>mapLocalAppointmentToRemote(local,{...maps,chairs:{}}),/chair/);
assert.throws(()=>mapLocalAppointmentToRemote(local,{...maps,patients:[]}),/patient/);
const inbound = mapRemoteAppointmentToLocal({
  id:uuid(5),branch_id:uuid(2),patient_id:uuid(1),dentist_user_id:uuid(3),
  chair_id:uuid(4),source_local_id:'local-appt-1',starts_at:'2032-03-04T07:30:00.000Z',
  ends_at:'2032-03-04T08:15:00.000Z',status:'confirmed',reason:'Follow-up',
  notes:'Reception note',source:'WhatsApp',updated_at:'2032-03-04T07:00:00.000Z'
},maps,local);
assert.equal(inbound.id,'local-appt-1');
assert.equal(inbound.remoteId,uuid(5));
assert.equal(inbound.dur,45);
assert.equal(inbound.dr,'local-dentist-1');
assert.equal(inbound.note,'Reception note');
assert.equal(inbound.src,'WhatsApp');
assert.deepEqual(inbound.hist,local.hist || []);
assert.equal(inbound.cloudUpdatedAt,'2032-03-04T07:00:00.000Z');
assert.throws(()=>mapRemoteAppointmentToLocal({status:'scheduled'},maps),/explicit local/);
assert.throws(()=>mapRemoteAppointmentToLocal({
  branch_id:uuid(2),patient_id:uuid(1),dentist_user_id:uuid(3),chair_id:uuid(4),
  source_local_id:'local-appt-1',starts_at:'2032-03-04T08:15:00.000Z',
  ends_at:'2032-03-04T07:30:00.000Z',status:'confirmed'
},maps),/time range is invalid/);
console.log('Appointment mapping tests passed.');
