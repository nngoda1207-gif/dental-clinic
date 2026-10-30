-- Appointment sync identity and scheduling-resource mapping.
-- Additive only: existing local appointments are not imported or modified.
alter table public.clinic_appointments
  add column if not exists source_local_id text,
  add column if not exists source text not null default '',
  add column if not exists chair_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_appointments_chair_fk'
      and conrelid = 'public.clinic_appointments'::regclass
  ) then
    alter table public.clinic_appointments
      add constraint clinic_appointments_chair_fk
      foreign key (clinic_id, chair_id)
      references public.clinic_chairs(clinic_id, id)
      on delete restrict;
  end if;
end
$$;

create unique index if not exists clinic_appointments_local_identity_uidx
  on public.clinic_appointments(clinic_id, branch_id, source_local_id)
  where source_local_id is not null;

create index if not exists clinic_appointments_chair_time_idx
  on public.clinic_appointments(clinic_id, branch_id, chair_id, starts_at)
  where chair_id is not null;

create or replace function public.enforce_appointment_chair_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
begin
  if new.chair_id is null then
    return new;
  end if;

  select c.branch_id into v_branch
    from public.clinic_chairs c
   where c.clinic_id = new.clinic_id
     and c.id = new.chair_id;

  if v_branch is null or v_branch <> new.branch_id then
    raise exception 'Appointment chair must belong to the same clinic branch'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_appointments_chair_branch_guard on public.clinic_appointments;
create trigger clinic_appointments_chair_branch_guard
before insert or update of clinic_id, branch_id, chair_id
on public.clinic_appointments
for each row execute function public.enforce_appointment_chair_branch();

revoke all on function public.enforce_appointment_chair_branch() from public, anon, authenticated;

create or replace function public.touch_appointment_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

drop trigger if exists clinic_appointments_touch_updated_at on public.clinic_appointments;
create trigger clinic_appointments_touch_updated_at
before update on public.clinic_appointments
for each row execute function public.touch_appointment_updated_at();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'clinic_appointments'
     ) then
    alter publication supabase_realtime add table public.clinic_appointments;
  end if;
end
$$;

comment on column public.clinic_appointments.source_local_id
  is 'Stable local appointment ID used for idempotent device sync; never inferred from patient/time.';
comment on column public.clinic_appointments.source
  is 'Appointment booking source copied from the local app.';
comment on column public.clinic_appointments.chair_id
  is 'Optional mapped clinic_chairs resource; must belong to the same branch.';
