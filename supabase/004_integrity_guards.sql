-- Dental Clinic OS: integrity constraints missed by basic composite FKs.
-- Apply after 001, 002 and 003 in a disposable project first.
-- This migration does not touch index.html or the user's live Supabase project.

-- Appointments must have a positive duration when an end time is supplied.
alter table public.clinic_appointments
  drop constraint if exists clinic_appointments_valid_duration;
alter table public.clinic_appointments
  add constraint clinic_appointments_valid_duration
  check (ends_at is null or ends_at > starts_at);

-- Composite clinic FKs prevent cross-clinic references, but do not ensure that
-- a child row's branch matches its referenced patient's/case's branch.
create or replace function public.enforce_clinic_child_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_branch uuid;
begin
  if tg_table_name = 'clinic_patient_medical_history'
     or tg_table_name = 'clinic_tooth_records'
     or tg_table_name = 'clinic_periodontal_measurements'
     or tg_table_name = 'clinic_consents' then
    select p.branch_id into parent_branch
      from public.clinic_patients p
     where p.clinic_id = new.clinic_id and p.id = new.patient_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Child branch must match the patient branch'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'clinic_lab_payments' then
    select c.branch_id into parent_branch
      from public.clinic_lab_cases c
     where c.clinic_id = new.clinic_id and c.id = new.lab_case_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Lab payment branch must match the lab case branch'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'clinic_appointment_events' then
    select a.branch_id into parent_branch
      from public.clinic_appointments a
     where a.clinic_id = new.clinic_id and a.id = new.appointment_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Appointment event branch must match the appointment branch'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_medical_history_branch_guard on public.clinic_patient_medical_history;
create trigger clinic_medical_history_branch_guard
before insert or update of clinic_id, branch_id, patient_id
on public.clinic_patient_medical_history
for each row execute function public.enforce_clinic_child_branch();

drop trigger if exists clinic_tooth_branch_guard on public.clinic_tooth_records;
create trigger clinic_tooth_branch_guard
before insert or update of clinic_id, branch_id, patient_id
on public.clinic_tooth_records
for each row execute function public.enforce_clinic_child_branch();

drop trigger if exists clinic_perio_branch_guard on public.clinic_periodontal_measurements;
create trigger clinic_perio_branch_guard
before insert or update of clinic_id, branch_id, patient_id
on public.clinic_periodontal_measurements
for each row execute function public.enforce_clinic_child_branch();

drop trigger if exists clinic_consents_branch_guard on public.clinic_consents;
create trigger clinic_consents_branch_guard
before insert or update of clinic_id, branch_id, patient_id
on public.clinic_consents
for each row execute function public.enforce_clinic_child_branch();

drop trigger if exists clinic_lab_payments_branch_guard on public.clinic_lab_payments;
create trigger clinic_lab_payments_branch_guard
before insert or update of clinic_id, branch_id, lab_case_id
on public.clinic_lab_payments
for each row execute function public.enforce_clinic_child_branch();

drop trigger if exists clinic_appointment_events_branch_guard on public.clinic_appointment_events;
create trigger clinic_appointment_events_branch_guard
before insert or update of clinic_id, branch_id, appointment_id
on public.clinic_appointment_events
for each row execute function public.enforce_clinic_child_branch();

-- Keep event insertion aligned with appointment mutation permissions. Reception,
-- dentists, managers and owners can manage appointments in their assigned branch.
drop policy if exists clinic_appointment_events_insert on public.clinic_appointment_events;
create policy clinic_appointment_events_insert
on public.clinic_appointment_events
for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);

-- Appointment events are immutable to authenticated clients. The trigger below
-- also rejects attempts to update/delete through privileged application paths.
create or replace function public.reject_appointment_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Appointment history is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists clinic_appointment_events_immutable on public.clinic_appointment_events;
create trigger clinic_appointment_events_immutable
before update or delete on public.clinic_appointment_events
for each row execute function public.reject_appointment_event_mutation();

-- Deliberately no chair assignment or overlap rule yet: that needs an approved
-- scheduling RPC and a chair_id field after the appointment workflow is mapped.
