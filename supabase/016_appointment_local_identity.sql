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

-- Every successful remote appointment insert/update gets an immutable audit event.
-- The actor is always the authenticated Supabase user, never a local display name.
create or replace function public.record_clinic_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $appointment_event$
declare
  v_actor uuid := auth.uid();
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';
    insert into public.clinic_appointment_events(clinic_id, branch_id, appointment_id, actor_user_id, event_type, new_status, details)
    values (new.clinic_id, new.branch_id, new.id, v_actor, v_event_type, new.status,
      pg_catalog.jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at, 'dentist_user_id', new.dentist_user_id, 'chair_id', new.chair_id, 'source', new.source));
  else
    v_event_type := case when old.status is distinct from new.status then 'status_changed' else 'updated' end;
    insert into public.clinic_appointment_events(clinic_id, branch_id, appointment_id, actor_user_id, event_type, old_status, new_status, details)
    values (new.clinic_id, new.branch_id, new.id, v_actor, v_event_type, old.status, new.status,
      pg_catalog.jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at, 'dentist_user_id', new.dentist_user_id, 'chair_id', new.chair_id, 'source', new.source));
  end if;
  return new;
end;
$appointment_event$;

drop trigger if exists clinic_appointments_audit_event on public.clinic_appointments;
create trigger clinic_appointments_audit_event after insert or update on public.clinic_appointments
for each row execute function public.record_clinic_appointment_event();
revoke all on function public.record_clinic_appointment_event() from public, anon, authenticated;

do $appointment_publication$
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
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clinic_appointment_events') then
    alter publication supabase_realtime add table public.clinic_appointment_events;
  end if;
end
$appointment_publication$;

comment on column public.clinic_appointments.source_local_id
  is 'Stable local appointment ID used for idempotent device sync; never inferred from patient/time.';
comment on column public.clinic_appointments.source
  is 'Appointment booking source copied from the local app.';
comment on column public.clinic_appointments.chair_id
  is 'Optional mapped clinic_chairs resource; must belong to the same branch.';
