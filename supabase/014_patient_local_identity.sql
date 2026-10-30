-- Stable link between one local patient and its normalized cloud demographic row.
-- NULL source_local_id is allowed for legacy rows not yet reconciled.
alter table public.clinic_patients
  add column if not exists source_local_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinic_patients'::regclass
      and conname = 'clinic_patients_source_local_id_key'
  ) then
    alter table public.clinic_patients
      add constraint clinic_patients_source_local_id_key
      unique (clinic_id, branch_id, source_local_id);
  end if;
end
$$;
