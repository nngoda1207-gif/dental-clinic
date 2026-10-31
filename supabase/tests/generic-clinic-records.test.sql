\set ON_ERROR_STOP on

do $$
declare
  v_rls boolean;
  v_permissions boolean;
  v_helper boolean;
  v_policy_count integer;
begin
  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='clinic_records';
  if coalesce(v_rls,false) is not true then
    raise exception 'clinic_records must have row-level security enabled';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='clinic_members' and column_name='permissions'
  ) into v_permissions;
  if not v_permissions then raise exception 'clinic_members.permissions is required'; end if;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='can_access_clinic_record'
  ) into v_helper;
  if not v_helper then raise exception 'private.can_access_clinic_record is required'; end if;

  select count(*) into v_policy_count
  from pg_policies where schemaname='public' and tablename='clinic_records'
    and policyname in ('clinic_records_select','clinic_records_insert','clinic_records_update','clinic_records_delete');
  if v_policy_count <> 4 then raise exception 'clinic_records must have four operation-specific RLS policies'; end if;

  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='clinic_records'
      and c.conname='clinic_records_module_check'
  ) then raise exception 'clinic_records module allowlist constraint is required'; end if;
end;
$$;

select 'generic clinic records schema tests passed' as result;
