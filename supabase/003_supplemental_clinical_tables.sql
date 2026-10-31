-- Dental Clinic OS: supplemental tables for features found in the current UI.
-- Run after 001_clinic_membership.sql and 002_operational_tables.sql.
-- Additive only. Test on a disposable Supabase project before any production use.

-- Chairs/rooms are branch resources. Appointment overlap prevention should be
-- implemented in a trusted transaction/RPC before the UI relies on this table.
create table if not exists public.clinic_chairs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 100),
  resource_type text not null default 'chair'
    check (resource_type in ('chair','room','other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, branch_id, name),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict
);

-- Keep a stable directory for dental labs; a case can snapshot lab_name separately.
create table if not exists public.clinic_laboratories (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  phone text not null default '',
  contact_name text not null default '',
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, name),
  unique (clinic_id, id)
);

-- Track case payments separately from case cost. Never overwrite payment history.
create table if not exists public.clinic_lab_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  lab_case_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text not null default 'cash'
    check (method in ('cash','card','transfer','wallet','other')),
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, lab_case_id)
    references public.clinic_lab_cases(clinic_id, id) on delete restrict
);

-- Structured patient medical history. Avoid putting all fields in a client-trusted JSON blob.
create table if not exists public.clinic_patient_medical_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  allergies text not null default '',
  medical_conditions text not null default '',
  medications text not null default '',
  prior_surgeries text not null default '',
  notes text not null default '',
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, patient_id),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict
);

-- One record per patient/tooth/surface as needed by the app's odontogram.
create table if not exists public.clinic_tooth_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  tooth_code text not null check (length(trim(tooth_code)) between 1 and 8),
  surface_code text not null default '',
  finding_code text not null default '',
  finding_label text not null default '',
  status text not null default 'active' check (status in ('active','resolved','historical')),
  notes text not null default '',
  recorded_by uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict
);

-- Store periodontal measurements as dated tooth/site observations.
create table if not exists public.clinic_periodontal_measurements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  tooth_code text not null,
  site_code text not null default '',
  pocket_depth_mm numeric(4,1) check (pocket_depth_mm between 0 and 30),
  recession_mm numeric(4,1) check (recession_mm between -10 and 30),
  bleeding boolean,
  plaque boolean,
  notes text not null default '',
  recorded_by uuid not null references auth.users(id) on delete restrict,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict
);

-- Detailed prescription items; parent record is kept in clinic_clinical_records.
create table if not exists public.clinic_prescription_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  clinical_record_id uuid not null,
  medication_name text not null,
  strength text not null default '',
  dose text not null default '',
  route text not null default '',
  frequency text not null default '',
  duration text not null default '',
  quantity text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default now(),
  foreign key (clinic_id, clinical_record_id)
    references public.clinic_clinical_records(clinic_id, id) on delete restrict
);

-- Record consent metadata and lifecycle; actual signature storage needs a protected file strategy.
create table if not exists public.clinic_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  clinical_record_id uuid,
  consent_type text not null,
  status text not null default 'draft' check (status in ('draft','signed','withdrawn','void')),
  signer_name text not null default '',
  signer_relationship text not null default '',
  signed_at timestamptz,
  document_path text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict,
  foreign key (clinic_id, clinical_record_id)
    references public.clinic_clinical_records(clinic_id, id) on delete restrict
);

-- Appointment history is append-only in intent; no client UPDATE/DELETE policies below.
create table if not exists public.clinic_appointment_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  appointment_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  old_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, appointment_id)
    references public.clinic_appointments(clinic_id, id) on delete restrict
);

create index if not exists clinic_chairs_branch_idx
  on public.clinic_chairs(clinic_id, branch_id, active);
create index if not exists clinic_tooth_patient_idx
  on public.clinic_tooth_records(clinic_id, patient_id, tooth_code, occurred_at desc);
create index if not exists clinic_perio_patient_idx
  on public.clinic_periodontal_measurements(clinic_id, patient_id, measured_at desc);
create index if not exists clinic_lab_payments_case_idx
  on public.clinic_lab_payments(clinic_id, lab_case_id, paid_at desc);
create index if not exists clinic_appointment_events_idx
  on public.clinic_appointment_events(clinic_id, appointment_id, created_at desc);

-- All supplemental tables enforce branch and role access in PostgreSQL.
alter table public.clinic_chairs enable row level security;
alter table public.clinic_laboratories enable row level security;
alter table public.clinic_lab_payments enable row level security;
alter table public.clinic_patient_medical_history enable row level security;
alter table public.clinic_tooth_records enable row level security;
alter table public.clinic_periodontal_measurements enable row level security;
alter table public.clinic_prescription_items enable row level security;
alter table public.clinic_consents enable row level security;
alter table public.clinic_appointment_events enable row level security;

-- Chairs: staff can view assigned branch resources; owner/manager can maintain them.
drop policy if exists clinic_chairs_select on public.clinic_chairs;
create policy clinic_chairs_select on public.clinic_chairs for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager','dentist','reception','nurse','readonly'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_chairs_insert on public.clinic_chairs;
create policy clinic_chairs_insert on public.clinic_chairs for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager'])
  and private.can_access_clinic_branch(clinic_id, branch_id));
drop policy if exists clinic_chairs_update on public.clinic_chairs;
create policy clinic_chairs_update on public.clinic_chairs for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager']) and private.can_access_clinic_branch(clinic_id, branch_id))
with check (private.has_clinic_role(clinic_id, array['owner','manager']) and private.can_access_clinic_branch(clinic_id, branch_id));
drop policy if exists clinic_chairs_delete on public.clinic_chairs;
create policy clinic_chairs_delete on public.clinic_chairs for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']) and private.can_access_clinic_branch(clinic_id, branch_id));

-- Lab directory: clinic members can view; only owner/manager/accountant maintain it.
drop policy if exists clinic_laboratories_select on public.clinic_laboratories;
create policy clinic_laboratories_select on public.clinic_laboratories for select to authenticated
using (private.is_clinic_member(clinic_id));
drop policy if exists clinic_laboratories_insert on public.clinic_laboratories;
create policy clinic_laboratories_insert on public.clinic_laboratories for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','accountant']));
drop policy if exists clinic_laboratories_update on public.clinic_laboratories;
create policy clinic_laboratories_update on public.clinic_laboratories for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','accountant']))
with check (private.has_clinic_role(clinic_id, array['owner','manager','accountant']));
drop policy if exists clinic_laboratories_delete on public.clinic_laboratories;
create policy clinic_laboratories_delete on public.clinic_laboratories for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']));

-- Clinical data: only owner and clinical roles may access medical/tooth/perio details.
drop policy if exists clinic_medical_select on public.clinic_patient_medical_history;
create policy clinic_medical_select on public.clinic_patient_medical_history for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager','dentist','nurse'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_medical_insert on public.clinic_patient_medical_history;
create policy clinic_medical_insert on public.clinic_patient_medical_history for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and updated_by = auth.uid());
drop policy if exists clinic_medical_update on public.clinic_patient_medical_history;
create policy clinic_medical_update on public.clinic_patient_medical_history for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id))
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and updated_by = auth.uid());
drop policy if exists clinic_medical_delete on public.clinic_patient_medical_history;
create policy clinic_medical_delete on public.clinic_patient_medical_history for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']) and private.can_access_clinic_branch(clinic_id, branch_id));

drop policy if exists clinic_tooth_select on public.clinic_tooth_records;
create policy clinic_tooth_select on public.clinic_tooth_records for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager','dentist','nurse'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_tooth_insert on public.clinic_tooth_records;
create policy clinic_tooth_insert on public.clinic_tooth_records for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and recorded_by = auth.uid());
drop policy if exists clinic_tooth_update on public.clinic_tooth_records;
create policy clinic_tooth_update on public.clinic_tooth_records for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id))
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and recorded_by = auth.uid());
drop policy if exists clinic_tooth_delete on public.clinic_tooth_records;
create policy clinic_tooth_delete on public.clinic_tooth_records for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']) and private.can_access_clinic_branch(clinic_id, branch_id));

drop policy if exists clinic_perio_select on public.clinic_periodontal_measurements;
create policy clinic_perio_select on public.clinic_periodontal_measurements for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager','dentist','nurse'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_perio_insert on public.clinic_periodontal_measurements;
create policy clinic_perio_insert on public.clinic_periodontal_measurements for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and recorded_by = auth.uid());
drop policy if exists clinic_perio_update on public.clinic_periodontal_measurements;
create policy clinic_perio_update on public.clinic_periodontal_measurements for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id))
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and recorded_by = auth.uid());
drop policy if exists clinic_perio_delete on public.clinic_periodontal_measurements;
create policy clinic_perio_delete on public.clinic_periodontal_measurements for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']) and private.can_access_clinic_branch(clinic_id, branch_id));

-- Prescription items inherit the parent clinical record's clinic/branch access.
drop policy if exists clinic_prescription_items_select on public.clinic_prescription_items;
create policy clinic_prescription_items_select on public.clinic_prescription_items for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and exists (select 1 from public.clinic_clinical_records r
    where r.clinic_id = clinic_prescription_items.clinic_id
      and r.id = clinic_prescription_items.clinical_record_id
      and private.can_access_clinic_branch(r.clinic_id, r.branch_id)));
drop policy if exists clinic_prescription_items_insert on public.clinic_prescription_items;
create policy clinic_prescription_items_insert on public.clinic_prescription_items for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and exists (select 1 from public.clinic_clinical_records r
    where r.clinic_id = clinic_prescription_items.clinic_id
      and r.id = clinic_prescription_items.clinical_record_id
      and r.created_by = auth.uid()
      and private.can_access_clinic_branch(r.clinic_id, r.branch_id)));
drop policy if exists clinic_prescription_items_update on public.clinic_prescription_items;
create policy clinic_prescription_items_update on public.clinic_prescription_items for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and exists (select 1 from public.clinic_clinical_records r
    where r.clinic_id = clinic_prescription_items.clinic_id
      and r.id = clinic_prescription_items.clinical_record_id
      and private.can_access_clinic_branch(r.clinic_id, r.branch_id)))
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and exists (select 1 from public.clinic_clinical_records r
    where r.clinic_id = clinic_prescription_items.clinic_id
      and r.id = clinic_prescription_items.clinical_record_id
      and private.can_access_clinic_branch(r.clinic_id, r.branch_id)));
drop policy if exists clinic_prescription_items_delete on public.clinic_prescription_items;
create policy clinic_prescription_items_delete on public.clinic_prescription_items for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']));

-- Consents: clinical roles can create/manage consent records in assigned branches.
drop policy if exists clinic_consents_select on public.clinic_consents;
create policy clinic_consents_select on public.clinic_consents for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager','dentist','nurse'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_consents_insert on public.clinic_consents;
create policy clinic_consents_insert on public.clinic_consents for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and created_by = auth.uid());
drop policy if exists clinic_consents_update on public.clinic_consents;
create policy clinic_consents_update on public.clinic_consents for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id))
with check (private.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and private.can_access_clinic_branch(clinic_id, branch_id));
drop policy if exists clinic_consents_delete on public.clinic_consents;
create policy clinic_consents_delete on public.clinic_consents for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']) and private.can_access_clinic_branch(clinic_id, branch_id));

-- Lab payments: finance roles only, restricted to assigned branch.
drop policy if exists clinic_lab_payments_select on public.clinic_lab_payments;
create policy clinic_lab_payments_select on public.clinic_lab_payments for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager','accountant'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_lab_payments_insert on public.clinic_lab_payments;
create policy clinic_lab_payments_insert on public.clinic_lab_payments for insert to authenticated
with check (private.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and private.can_access_clinic_branch(clinic_id, branch_id) and created_by = auth.uid());
drop policy if exists clinic_lab_payments_update on public.clinic_lab_payments;
create policy clinic_lab_payments_update on public.clinic_lab_payments for update to authenticated
using (private.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and private.can_access_clinic_branch(clinic_id, branch_id))
with check (private.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and private.can_access_clinic_branch(clinic_id, branch_id));
drop policy if exists clinic_lab_payments_delete on public.clinic_lab_payments;
create policy clinic_lab_payments_delete on public.clinic_lab_payments for delete to authenticated
using (private.has_clinic_role(clinic_id, array['owner']) and private.can_access_clinic_branch(clinic_id, branch_id));

-- Appointment events are append-only to clients; managers/owner can review.
drop policy if exists clinic_appointment_events_select on public.clinic_appointment_events;
create policy clinic_appointment_events_select on public.clinic_appointment_events for select to authenticated
using (private.has_clinic_role(clinic_id, array['owner'])
  or (private.has_clinic_role(clinic_id, array['manager'])
      and private.can_access_clinic_branch(clinic_id, branch_id)));
drop policy if exists clinic_appointment_events_insert on public.clinic_appointment_events;
create policy clinic_appointment_events_insert on public.clinic_appointment_events for insert to authenticated
with check (private.is_clinic_member(clinic_id)
  and actor_user_id = auth.uid() and private.can_access_clinic_branch(clinic_id, branch_id));
-- No UPDATE/DELETE grants or policies for appointment events.

grant select, insert, update, delete on public.clinic_chairs to authenticated;
grant select, insert, update, delete on public.clinic_laboratories to authenticated;
grant select, insert, update, delete on public.clinic_lab_payments to authenticated;
grant select, insert, update, delete on public.clinic_patient_medical_history to authenticated;
grant select, insert, update, delete on public.clinic_tooth_records to authenticated;
grant select, insert, update, delete on public.clinic_periodontal_measurements to authenticated;
grant select, insert, update, delete on public.clinic_prescription_items to authenticated;
grant select, insert, update, delete on public.clinic_consents to authenticated;
grant select, insert on public.clinic_appointment_events to authenticated;
