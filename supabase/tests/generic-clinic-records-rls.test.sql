\set ON_ERROR_STOP on

insert into auth.users(id,email) values
 ('11000000-0000-4000-8000-000000000001','cloud-owner@test.invalid'),
 ('11000000-0000-4000-8000-000000000002','cloud-nurse@test.invalid'),
 ('11000000-0000-4000-8000-000000000003','cloud-appointments@test.invalid')
on conflict (id) do nothing;

insert into public.clinics(id,name,created_by)
values ('21000000-0000-4000-8000-000000000001','Cloud Record Test','11000000-0000-4000-8000-000000000001');

insert into public.clinic_members(clinic_id,user_id,role,permissions) values
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner','[]'::jsonb),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','nurse','["pv","pa","pe"]'::jsonb),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','readonly','["aw"]'::jsonb);

insert into public.clinic_branches(id,clinic_id,name) values
 ('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Assigned branch'),
 ('31000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','Unassigned branch');

insert into public.clinic_member_branches(clinic_id,user_id,branch_id)
values ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001'),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001');

insert into public.clinic_records(clinic_id,branch_id,module,record_key,payload,created_by,updated_by) values
 ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','patients','P-001','{"name":"Synthetic patient"}','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001'),
 ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','finance','F-001','{"amount":100}','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001'),
 ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','patients','P-OTHER','{"name":"Other branch patient"}','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001'),
 ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','appointments','A-001','{"start":"2026-10-31T10:00:00"}','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001');

set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","email":"cloud-nurse@test.invalid"}',false);

do $$
declare patient_rows integer; finance_rows integer; other_branch_rows integer;
begin
  select count(*) into patient_rows from public.clinic_records where module='patients' and branch_id='31000000-0000-4000-8000-000000000001';
  select count(*) into finance_rows from public.clinic_records where module='finance';
  select count(*) into other_branch_rows from public.clinic_records where branch_id='31000000-0000-4000-8000-000000000002';
  if patient_rows <> 1 then raise exception 'Assigned nurse must read the patients module in the assigned branch'; end if;
  if finance_rows <> 0 then raise exception 'Nurse must not read finance records without finance permissions'; end if;
  if other_branch_rows <> 0 then raise exception 'Nurse must not read another branch'; end if;
end;
$$;

update public.clinic_records
set payload='{"name":"Updated synthetic patient"}', revision=revision+1, updated_by=auth.uid()
where module='patients' and record_key='P-001';

do $$
begin
  if not exists (
    select 1 from public.clinic_records
    where module='patients' and record_key='P-001' and revision=2
      and payload->>'name'='Updated synthetic patient'
  ) then raise exception 'Assigned nurse with edit permission must update an assigned patient record'; end if;
end;
$$;

do $$
begin
  begin
    insert into public.clinic_records(clinic_id,branch_id,module,record_key,payload,created_by,updated_by)
    values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','finance','F-NEW','{"amount":50}',auth.uid(),auth.uid());
    raise exception 'Nurse unexpectedly inserted a finance record';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000003","email":"cloud-appointments@test.invalid"}',false);
do $$
declare appointment_rows integer; patient_rows integer;
begin
  select count(*) into appointment_rows from public.clinic_records where module='appointments';
  select count(*) into patient_rows from public.clinic_records where module='patients';
  if appointment_rows <> 1 then raise exception 'Appointment write permission must authorize appointment-module records'; end if;
  if patient_rows <> 0 then raise exception 'Appointment-only permission must not grant patient access'; end if;
end;
$$;
reset role;
select 'generic clinic record RLS tests passed' as result;
