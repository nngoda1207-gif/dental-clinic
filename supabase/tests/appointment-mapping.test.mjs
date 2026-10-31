import assert from 'node:assert/strict';
import {
  localAppointmentStatusToRemote,
  remoteAppointmentStatusToLocal,
  mapLocalAppointmentToRemote,
  mapRemoteAppointmentToLocal
} from '../appointment-mapping.js';

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const patient = { id:'local-patient-1', br:'local-branch-1', remoteId:uuid(1), no:'P-001' };
const maps = {
  branches:{'local-branch-1':uuid(2)},
  dentists:{'local-dentist-1':'dr.one'},
  chairs:{'local-chair-1':'Room 1'},
  patients:[patient]
};
assert.equal(localAppointmentStatusToRemote('wait'),'arrived');
assert.equal(localAppointmentStatusToRemote('done'),'completed');
assert.equal(remoteAppointmentStatusToLocal('cancelled','cp'),'cp');
assert.throws(()=>remoteAppointmentStatusToLocal('cancelled'),/manual review/);
const local = {
  id:'local-appt-1',pid:patient.id,br:patient.br,dr:'local-dentist-1',
  ch:'local-chair-1',start:'2032-03-04T09:30',dur:45,st:'confirmed',
  type:'Follow-up',note:'Reception note',src:'WhatsApp',hist:[{act:'Created'}]
};
const remote = mapLocalAppointmentToRemote(local,maps);
assert.equal(remote.branchId,uuid(2));
assert.equal(remote.recordKey,'local-appt-1');
assert.equal(remote.payload.patient_record_id,uuid(1));
assert.equal(remote.payload.patient_file_no,'P-001');
assert.equal(remote.payload.dentist_username,'dr.one');
assert.equal(remote.payload.chair_name,'Room 1');
assert.equal(remote.payload.status,'confirmed');
assert.equal(remote.expectedRevision,null);
assert.equal(new Date(remote.payload.ends_at)-new Date(remote.payload.starts_at),45*60000);
assert.throws(()=>mapLocalAppointmentToRemote(local,{...maps,dentists:{}}),/dentist username/);
assert.throws(()=>localAppointmentStatusToRemote('unknown-status'),/Unsupported local appointment status/);
assert.throws(()=>mapLocalAppointmentToRemote({...local,dur:0},maps),/date or duration is invalid/);
assert.throws(()=>mapLocalAppointmentToRemote({...local,dur:481},maps),/date or duration is invalid/);
assert.throws(()=>mapLocalAppointmentToRemote({...local,start:'not-a-date'},maps),/date or duration is invalid/);
assert.throws(()=>mapLocalAppointmentToRemote(local,{...maps,chairs:{}}),/chair name/);
assert.throws(()=>mapLocalAppointmentToRemote(local,{...maps,patients:[]}),/patient/);
const inbound = mapRemoteAppointmentToLocal({
  id:uuid(5),clinic_id:uuid(6),branch_id:uuid(2),module:'appointments',
  record_key:'local-appt-1',revision:3,updated_at:'2032-03-04T07:00:00.000Z',
  payload:{
    kind:'appointment',source_local_id:'local-appt-1',patient_record_id:uuid(1),
    patient_file_no:'P-001',dentist_username:'dr.one',chair_name:'Room 1',
    starts_at:'2032-03-04T07:30:00.000Z',ends_at:'2032-03-04T08:15:00.000Z',
    status:'confirmed',reason:'Follow-up',notes:'Reception note',source:'WhatsApp',
    history:[{act:'Created'}]
  }
},maps,local);
assert.equal(inbound.id,'local-appt-1');
assert.equal(inbound.cloudRecordKey,'local-appt-1');
assert.equal(inbound.remoteId,uuid(5));
assert.equal(inbound.cloudRevision,3);
assert.equal(inbound.dur,45);
assert.equal(inbound.dr,'local-dentist-1');
assert.equal(inbound.note,'Reception note');
assert.equal(inbound.src,'WhatsApp');
assert.deepEqual(inbound.hist,[{act:'Created'}]);
assert.equal(inbound.cloudUpdatedAt,'2032-03-04T07:00:00.000Z');
assert.throws(()=>mapRemoteAppointmentToLocal({payload:{status:'scheduled'}},maps),/explicit local/);
assert.throws(()=>mapRemoteAppointmentToLocal({
  branch_id:uuid(2),record_key:'local-appt-1',revision:1,updated_at:'2032-03-04T07:00:00Z',
  payload:{kind:'appointment',source_local_id:'local-appt-1',patient_record_id:uuid(1),patient_file_no:'P-001',dentist_username:'dr.one',chair_name:'Room 1',starts_at:'2032-03-04T08:15:00Z',ends_at:'2032-03-04T07:30:00Z',status:'confirmed'}
},maps),/time range is invalid/);
console.log('Appointment mapping tests passed.');
