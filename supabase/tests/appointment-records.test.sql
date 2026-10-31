\set ON_ERROR_STOP on

insert into auth.users(id,email) values
 ('13000000-0000-4000-8000-000000000001','appt-owner@test.invalid'),
 ('13000000-0000-4000-8000-000000000002','appt-dentist-one@test.invalid'),
 ('13000000-0000-4000-8000-000000000003','appt-dentist-two@test.invalid'),
 ('13000000-0000-4000-8000-000000000004','appt-dentist-unassigned@test.invalid'),
 ('13000000-0000-4000-8000-000000000005','appt-reception@test.invalid')
on conflict (id) do nothing;

insert into public.clinics(id,name,created_by)
values ('23000000-0000-4000-8000-000000000001','Appointment RPC Test','13000000-0000-4000-8000-000000000001');

insert into public.clinic_members(clinic_id,user_id,role,active,permissions) values
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','owner',true,'[]'::jsonb),
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002','dentist',true,'["pv","pa","pe","aw"]'::jsonb),
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000003','dentist',true,'["pv","pa","pe","aw"]'::jsonb),
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000004','dentist',true,'["pv","pa","pe","aw"]'::jsonb),
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000005','reception',true,'["pv","pa","pe","aw"]'::jsonb);

insert into public.clinic_usernames(user_id,username) values
 ('13000000-0000-4000-8000-000000000002','dr.one'),
 ('13000000-0000-4000-8000-000000000003','dr.two'),
 ('13000000-0000-4000-8000-000000000004','dr.three');

insert into public.clinic_branches(id,clinic_id,name) values
 ('33000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','Appointment branch'),
 ('33000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','Other branch');

insert into public.clinic_member_branches(clinic_id,user_id,branch_id) values
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000001'),
 ('23000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000001'),
 ('23000000-0000-4000-8000-000000000005','13000000-0000-4000-8000-000000000005','33000000-0000-4000-8000-000000000001');

insert into public.clinic_records(clinic_id,branch_id,module,record_key,payload,created_by,updated_by)
values ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','patients','P-001',
 '{"name":"Synthetic appointment patient"}',
 '13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001');

set role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000005',false);
select set_config('request.jwt.claims','{"sub":"13000000-0000-4000-8000-000000000005","email":"appt-reception@test.invalid"}',false);

do $$
declare
  v_patient_id uuid;
  v_payload jsonb;
  v_row public.clinic_records%rowtype;
  v_caught boolean;
begin
  select id into v_patient_id from public.clinic_records
  where clinic_id='23000000-0000-4000-8000-000000000001'
    and branch_id='33000000-0000-4000-8000-000000000001'
    and module='patients' and record_key='P-001';

  v_payload := jsonb_build_object(
    'kind','appointment','source_local_id','appt-local-1',
    'patient_record_id',v_patient_id,'patient_file_no','P-001',
    'dentist_username','dr.one','chair_name','Room 1',
    'starts_at','2032-03-04T09:00:00Z','ends_at','2032-03-04T10:00:00Z',
    'status','scheduled','reason','Checkup','notes','Synthetic test','source','Test',
    'history',jsonb_build_array(jsonb_build_object('act','Created'))
  );

  select * into v_row from public.save_clinic_appointment_record(
    '23000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001',
    'appt-local-1',v_payload,null
  );
  if v_row.revision <> 1 or v_row.module <> 'appointments' then
    raise exception 'Appointment RPC must create revision 1 in the appointments module';
  end if;

  v_caught := false;
  begin
    perform * from public.save_clinic_appointment_record(
      '23000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001',
      'appt-local-2',
      v_payload || jsonb_build_object(
        'source_local_id','appt-local-2','starts_at','2032-03-04T09:30:00Z',
        'ends_at','2032-03-04T10:30:00Z','chair_name','Room 2'
      ),null
    );
  exception when raise_exception then
    if sqlerrm = 'APPOINTMENT_OVERLAP' then v_caught := true; else raise; end if;
  end;
  if not v_caught then raise exception 'Same-dentist appointment overlap must be rejected'; end if;

  v_caught := false;
  begin
    perform * from public.save_clinic_appointment_record(
      '23000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001',
      'appt-local-3',
      v_payload || jsonb_build_object(
        'source_local_id','appt-local-3','dentist_username','dr.two',
        'starts_at','2032-03-04T09:30:00Z','ends_at','2032-03-04T10:30:00Z'
      ),null
    );
  exception when raise_exception then
    if sqlerrm = 'APPOINTMENT_OVERLAP' then v_caught := true; else raise; end if;
  end;
  if not v_caught then raise exception 'Same-chair appointment overlap must be rejected'; end if;

  select * into v_row from public.save_clinic_appointment_record(
    '23000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000001',
    'appt-local-1',
    v_payload || jsonb_build_object('notes','Updated test note'),
    1
  );
  if v_row.revision <> 2 or v_row.payload->>'notes' <> 'Updated test note' then
    raise exception 'Appointment update must increment its revision';
  end if;

  v_caught := false;
  begin
    perform * from public.save_clinic_appointment_record(
      '23000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001',
      'appt-local-1',v_payload,1
    );
  exception when raise_exception then
    if sqlerrm = 'APPOINTMENT_REVISION_CONFLICT' then v_caught := true; else raise; end if;
  end;
  if not v_caught then raise exception 'Stale appointment revision must be rejected'; end if;

  v_caught := false;
  begin
    perform * from public.save_clinic_appointment_record(
      '23000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000001',
      'appt-local-4',
      v_payload || jsonb_build_object(
        'source_local_id','appt-local-4','dentist_username','dr.three',
        'starts_at','2032-03-04T11:00:00Z','ends_at','2032-03-04T12:00:00Z'
      ),null
    );
  exception when raise_exception then
    if sqlerrm = 'APPOINTMENT_DENTIST_NOT_LINKED_TO_BRANCH' then v_caught := true; else raise; end if;
  end;
  if not v_caught then raise exception 'Unassigned dentist must be rejected'; end if;

  v_caught := false;
  begin
    perform * from public.save_clinic_appointment_record(
      '23000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000002',
      'appt-local-5',
      v_payload || jsonb_build_object(
        'source_local_id','appt-local-5','starts_at','2032-03-04T11:00:00Z',
        'ends_at','2032-03-04T12:00:00Z'
      ),null
    );
  exception when raise_exception then
    if sqlerrm = 'APPOINTMENT_PERMISSION_DENIED' then v_caught := true; else raise; end if;
  end;
  if not v_caught then raise exception 'Unassigned branch must be rejected'; end if;
end;
$$;

reset role;
select 'guarded appointment RPC tests passed' as result;
