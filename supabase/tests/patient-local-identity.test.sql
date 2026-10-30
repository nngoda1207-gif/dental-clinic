do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinic_patients'
      and column_name = 'source_local_id'
      and data_type = 'text'
  ) then
    raise exception 'clinic_patients.source_local_id column is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinic_patients'::regclass
      and conname = 'clinic_patients_source_local_id_key'
      and contype = 'u'
  ) then
    raise exception 'stable local patient identity unique constraint is missing';
  end if;
end
$$;
