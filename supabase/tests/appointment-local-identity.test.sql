-- Synthetic-only appointment sync identity, chair branch and version tests.
\set ON_ERROR_STOP on
begin;

insert into public.clinic_chairs(id,clinic_id,branch_id,name)
values (
 '81000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',
 'Synthetic Chair A'
);

insert into public.clinic_appointments(
 id,clinic_id,branch_id,patient_id,dentist_user_id,starts_at,ends_at,
 source_local_id,source,chair_id,created_by
) values (
 '82000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002',
 '2031-01-10 10:00:00+00','2031-01-10 10:30:00+00',
 'local-appt-001','WhatsApp','81000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000001'
);

do $$
begin
  if not exists (
    select 1 from public.clinic_appointment_events
    where appointment_id='82000000-0000-0000-0000-000000000001'
      and event_type='created' and new_status='scheduled'
  ) then
    raise exception 'Appointment creation event was not recorded';
  end if;

  if not exists (
    select 1 from public.clinic_appointments
    where id='82000000-0000-0000-0000-000000000001'
      and source_local_id='local-appt-001'
      and source='WhatsApp'
      and chair_id='81000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Appointment sync identity or chair mapping was not persisted';
  end if;

  begin
    insert into public.clinic_appointments(
      clinic_id,branch_id,patient_id,starts_at,ends_at,source_local_id,created_by
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2031-01-10 11:00:00+00','2031-01-10 11:30:00+00',
      'local-appt-001','00000000-0000-0000-0000-000000000001'
    );
    raise exception 'Duplicate local appointment identity was accepted';
  exception when unique_violation then null;
  end;

  begin
    update public.clinic_appointments
       set chair_id='81000000-0000-0000-0000-000000000001',
           branch_id='20000000-0000-0000-0000-000000000002'
     where id='82000000-0000-0000-0000-000000000001';
    raise exception 'Cross-branch appointment chair mapping was accepted';
  exception when check_violation then null;
  end;
end
$$;

do $$
declare before_version timestamptz; after_version timestamptz;
begin
  select updated_at into before_version from public.clinic_appointments
   where id='82000000-0000-0000-0000-000000000001';
  perform pg_catalog.pg_sleep(0.01);
  update public.clinic_appointments set notes='version test'
   where id='82000000-0000-0000-0000-000000000001';
  if not exists (
    select 1 from public.clinic_appointment_events
    where appointment_id='82000000-0000-0000-0000-000000000001'
      and event_type='updated'
  ) then
    raise exception 'Appointment update event was not recorded';
  end if;
  select updated_at into after_version from public.clinic_appointments
   where id='82000000-0000-0000-0000-000000000001';
  if after_version <= before_version then
    raise exception 'Appointment updated_at did not advance';
  end if;
end
$$;

rollback;
