-- Enable branch-scoped Postgres change notifications for the patient cloud view.
-- Supabase projects normally provide this publication. Disposable vanilla PostgreSQL
-- CI may not; in that case the migration is intentionally a no-op.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'clinic_patients'
    ) then
      alter publication supabase_realtime add table public.clinic_patients;
    end if;
  end if;
end
$$;
