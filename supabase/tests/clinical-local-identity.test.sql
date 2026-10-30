\set ON_ERROR_STOP on
do $clinical_identity_test$
declare
  v_table_name text;
  required_tables text[] := array[
    'clinic_clinical_records','clinic_treatment_items','clinic_tooth_records',
    'clinic_periodontal_measurements','clinic_prescription_items','clinic_consents'
  ];
begin
  foreach v_table_name in array required_tables loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_table_name
        and c.column_name='source_local_id'
    ) then
      raise exception 'Missing source_local_id on %',v_table_name;
    end if;
  end loop;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='clinic_consents' and column_name='updated_at') then
    raise exception 'Consent updated_at version column missing';
  end if;
  if not exists(select 1 from pg_trigger where tgname='clinic_clinical_records_touch_sync_version' and not tgisinternal) then
    raise exception 'Clinical record optimistic version trigger missing';
  end if;
  if not exists(select 1 from pg_trigger where tgname='clinic_medical_history_touch_sync_version' and not tgisinternal) then
    raise exception 'Medical history optimistic version trigger missing';
  end if;
  if not exists(select 1 from pg_trigger where tgname='clinic_consents_touch_sync_version' and not tgisinternal) then
    raise exception 'Consent optimistic version trigger missing';
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table_name in array array['clinic_clinical_records','clinic_patient_medical_history','clinic_tooth_records','clinic_periodontal_measurements','clinic_prescription_items','clinic_consents'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table_name) then
        raise exception 'Clinical table % missing from Realtime publication',v_table_name;
      end if;
    end loop;
  end if;
end
$clinical_identity_test$;
