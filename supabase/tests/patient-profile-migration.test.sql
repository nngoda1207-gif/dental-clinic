-- Run after migrations 001-009 and synthetic smoke fixtures.
-- This verifies the additive patient profile fields exist and DB constraints are enforced.
do $test$
declare
  missing_columns text[];
begin
  select array_agg(required.column_name)
    into missing_columns
  from (values
    ('english_name'),
    ('governorate'),
    ('source'),
    ('assigned_dentist_user_id'),
    ('tags')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'clinic_patients'
      and c.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'Patient profile migration missing columns: %', missing_columns;
  end if;

  begin
    update public.clinic_patients
       set english_name = repeat('x', 201)
     where id = '30000000-0000-0000-0000-000000000001';
    if not found then
      raise exception 'Patient profile migration test fixture was not found';
    end if;
    raise exception 'Patient profile test failed: 201-character English name was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update public.clinic_patients
       set governorate = repeat('x', 121)
     where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'Patient profile test failed: 121-character governorate was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update public.clinic_patients
       set source = repeat('x', 121)
     where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'Patient profile test failed: 121-character source was accepted';
  exception when check_violation then
    null;
  end;
end
$test$;

select 'PATIENT_PROFILE_MIGRATION_TESTS_PASSED' as result;
