-- Dental Clinic OS: normalized operational data with role-aware RLS.
-- Additive only. Does not touch the existing local app or clinic_state JSON.
-- Test in a separate Supabase project before applying to real data.

create table if not exists public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  file_no text not null,
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  phone text not null default '',
  phone_alt text not null default '',
  email text not null default '',
  date_of_birth date,
  sex text not null default '' check (sex in ('','male','female','other')),
  address text not null default '',
  emergency_contact text not null default '',
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, branch_id, file_no),
  unique (clinic_id, id),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  dentist_user_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','arrived','completed','cancelled','no_show')),
  reason text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_clinical_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid references public.clinic_appointments(id) on delete set null,
  dentist_user_id uuid references auth.users(id) on delete set null,
  record_type text not null default 'visit'
    check (record_type in ('visit','diagnosis','prescription','consent','note')),
  occurred_at timestamptz not null default now(),
  complaint text not null default '',
  examination text not null default '',
  diagnosis text not null default '',
  treatment text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_treatment_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  clinical_record_id uuid references public.clinic_clinical_records(id) on delete set null,
  tooth text not null default '',
  procedure_name text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  status text not null default 'planned'
    check (status in ('planned','done','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict,
  check (discount <= quantity * unit_price)
);

create table if not exists public.clinic_invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  invoice_no text not null,
  status text not null default 'open' check (status in ('open','paid','void','refunded')),
  currency text not null default 'EGP',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text not null default '',
  issued_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, branch_id, invoice_no),
  unique (clinic_id, id),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict,
  check (discount <= subtotal)
);

create table if not exists public.clinic_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  invoice_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash'
    check (method in ('cash','card','transfer','wallet','other')),
  paid_at timestamptz not null default now(),
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, invoice_id)
    references public.clinic_invoices(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  category text not null default '',
  unit text not null default '',
  price numeric(12,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, name),
  unique (clinic_id, id)
);

create table if not exists public.clinic_suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_inventory_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  supplier_id uuid,
  sku text not null default '',
  name text not null,
  unit text not null default 'piece',
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  min_quantity numeric(12,3) not null default 0 check (min_quantity >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, supplier_id)
    references public.clinic_suppliers(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  item_id uuid not null,
  movement_type text not null
    check (movement_type in ('purchase','use','adjustment','transfer_in','transfer_out','return')),
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  reference text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, item_id)
    references public.clinic_inventory_items(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_lab_cases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  lab_name text not null default '',
  case_type text not null default '',
  shade text not null default '',
  status text not null default 'sent'
    check (status in ('planned','sent','received','fitted','cancelled')),
  sent_at timestamptz,
  due_at timestamptz,
  received_at timestamptz,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict,
  foreign key (clinic_id, patient_id)
    references public.clinic_patients(clinic_id, id) on delete restrict
);

create table if not exists public.clinic_audit_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete restrict
);

create index if not exists clinic_patients_branch_name_idx
  on public.clinic_patients(clinic_id, branch_id, full_name);
create index if not exists clinic_patients_phone_idx
  on public.clinic_patients(clinic_id, phone);
create index if not exists clinic_appointments_schedule_idx
  on public.clinic_appointments(clinic_id, branch_id, starts_at);
create index if not exists clinic_clinical_patient_idx
  on public.clinic_clinical_records(clinic_id, patient_id, occurred_at desc);
create index if not exists clinic_invoices_patient_idx
  on public.clinic_invoices(clinic_id, patient_id, issued_at desc);
create index if not exists clinic_payments_invoice_idx
  on public.clinic_invoice_payments(clinic_id, invoice_id, paid_at desc);
create index if not exists clinic_inventory_branch_idx
  on public.clinic_inventory_items(clinic_id, branch_id, active);
create index if not exists clinic_inventory_movements_item_idx
  on public.clinic_inventory_movements(clinic_id, item_id, created_at desc);
create index if not exists clinic_lab_cases_due_idx
  on public.clinic_lab_cases(clinic_id, branch_id, due_at);

-- Enable row-level security on all operational tables.
alter table public.clinic_patients enable row level security;
alter table public.clinic_appointments enable row level security;
alter table public.clinic_clinical_records enable row level security;
alter table public.clinic_treatment_items enable row level security;
alter table public.clinic_invoices enable row level security;
alter table public.clinic_invoice_payments enable row level security;
alter table public.clinic_services enable row level security;
alter table public.clinic_suppliers enable row level security;
alter table public.clinic_inventory_items enable row level security;
alter table public.clinic_inventory_movements enable row level security;
alter table public.clinic_lab_cases enable row level security;
alter table public.clinic_audit_events enable row level security;

-- Patients: owner/manager/dentist/reception/nurse may manage demographics;
-- accountant and read-only roles do not receive access to clinical patient records.
drop policy if exists clinic_patients_select on public.clinic_patients;
create policy clinic_patients_select on public.clinic_patients
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','dentist','reception','nurse','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_patients_insert on public.clinic_patients;
create policy clinic_patients_insert on public.clinic_patients
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_patients_update on public.clinic_patients;
create policy clinic_patients_update on public.clinic_patients
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_patients_delete on public.clinic_patients;
create policy clinic_patients_delete on public.clinic_patients
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Appointments.
drop policy if exists clinic_appointments_select on public.clinic_appointments;
create policy clinic_appointments_select on public.clinic_appointments
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','dentist','reception','nurse','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_appointments_insert on public.clinic_appointments;
create policy clinic_appointments_insert on public.clinic_appointments
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_appointments_update on public.clinic_appointments;
create policy clinic_appointments_update on public.clinic_appointments
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','reception','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_appointments_delete on public.clinic_appointments;
create policy clinic_appointments_delete on public.clinic_appointments
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Clinical records: only owner/manager/dentist/nurse; reception and accounting cannot read notes/diagnoses.
drop policy if exists clinic_clinical_select on public.clinic_clinical_records;
create policy clinic_clinical_select on public.clinic_clinical_records
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','dentist','nurse'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_clinical_insert on public.clinic_clinical_records;
create policy clinic_clinical_insert on public.clinic_clinical_records
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_clinical_update on public.clinic_clinical_records;
create policy clinic_clinical_update on public.clinic_clinical_records
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_clinical_delete on public.clinic_clinical_records;
create policy clinic_clinical_delete on public.clinic_clinical_records
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Treatment plans are clinical data.
drop policy if exists clinic_treatment_select on public.clinic_treatment_items;
create policy clinic_treatment_select on public.clinic_treatment_items
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','dentist','nurse','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_treatment_insert on public.clinic_treatment_items;
create policy clinic_treatment_insert on public.clinic_treatment_items
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_treatment_update on public.clinic_treatment_items;
create policy clinic_treatment_update on public.clinic_treatment_items
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_treatment_delete on public.clinic_treatment_items;
create policy clinic_treatment_delete on public.clinic_treatment_items
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Financial records: accountant has access; reception can read but not alter invoices/payments.
drop policy if exists clinic_invoices_select on public.clinic_invoices;
create policy clinic_invoices_select on public.clinic_invoices
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','accountant','reception','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_invoices_insert on public.clinic_invoices;
create policy clinic_invoices_insert on public.clinic_invoices
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_invoices_update on public.clinic_invoices;
create policy clinic_invoices_update on public.clinic_invoices
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_invoices_delete on public.clinic_invoices;
create policy clinic_invoices_delete on public.clinic_invoices
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

drop policy if exists clinic_payments_select on public.clinic_invoice_payments;
create policy clinic_payments_select on public.clinic_invoice_payments
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','accountant','reception','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_payments_insert on public.clinic_invoice_payments;
create policy clinic_payments_insert on public.clinic_invoice_payments
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_payments_update on public.clinic_invoice_payments;
create policy clinic_payments_update on public.clinic_invoice_payments
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','accountant'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_payments_delete on public.clinic_invoice_payments;
create policy clinic_payments_delete on public.clinic_invoice_payments
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Shared service catalog.
drop policy if exists clinic_services_select on public.clinic_services;
create policy clinic_services_select on public.clinic_services
for select to authenticated
using (public.is_clinic_member(clinic_id));
drop policy if exists clinic_services_insert on public.clinic_services;
create policy clinic_services_insert on public.clinic_services
for insert to authenticated
with check (public.has_clinic_role(clinic_id, array['owner','manager']));
drop policy if exists clinic_services_update on public.clinic_services;
create policy clinic_services_update on public.clinic_services
for update to authenticated
using (public.has_clinic_role(clinic_id, array['owner','manager']))
with check (public.has_clinic_role(clinic_id, array['owner','manager']));
drop policy if exists clinic_services_delete on public.clinic_services;
create policy clinic_services_delete on public.clinic_services
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']));

-- Suppliers and inventory are restricted to owner/manager/inventory manager/accountant.
drop policy if exists clinic_suppliers_select on public.clinic_suppliers;
create policy clinic_suppliers_select on public.clinic_suppliers
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','invmgr','accountant'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_suppliers_insert on public.clinic_suppliers;
create policy clinic_suppliers_insert on public.clinic_suppliers
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_suppliers_update on public.clinic_suppliers;
create policy clinic_suppliers_update on public.clinic_suppliers
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_suppliers_delete on public.clinic_suppliers;
create policy clinic_suppliers_delete on public.clinic_suppliers
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

drop policy if exists clinic_inventory_select on public.clinic_inventory_items;
create policy clinic_inventory_select on public.clinic_inventory_items
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','invmgr','accountant','dentist','nurse','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_inventory_insert on public.clinic_inventory_items;
create policy clinic_inventory_insert on public.clinic_inventory_items
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_inventory_update on public.clinic_inventory_items;
create policy clinic_inventory_update on public.clinic_inventory_items
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_inventory_delete on public.clinic_inventory_items;
create policy clinic_inventory_delete on public.clinic_inventory_items
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

drop policy if exists clinic_inventory_movements_select on public.clinic_inventory_movements;
create policy clinic_inventory_movements_select on public.clinic_inventory_movements
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','invmgr','accountant','dentist','nurse','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_inventory_movements_insert on public.clinic_inventory_movements;
create policy clinic_inventory_movements_insert on public.clinic_inventory_movements
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','invmgr','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_inventory_movements_update on public.clinic_inventory_movements;
create policy clinic_inventory_movements_update on public.clinic_inventory_movements
for update to authenticated
using (public.has_clinic_role(clinic_id, array['owner','manager','invmgr']) and public.can_access_clinic_branch(clinic_id, branch_id))
with check (public.has_clinic_role(clinic_id, array['owner','manager','invmgr']) and public.can_access_clinic_branch(clinic_id, branch_id));
drop policy if exists clinic_inventory_movements_delete on public.clinic_inventory_movements;
create policy clinic_inventory_movements_delete on public.clinic_inventory_movements
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Lab cases may contain treatment details; restrict to clinical staff and owner/manager.
drop policy if exists clinic_lab_select on public.clinic_lab_cases;
create policy clinic_lab_select on public.clinic_lab_cases
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager','dentist','nurse','readonly'])
    and public.can_access_clinic_branch(clinic_id, branch_id)
  )
);
drop policy if exists clinic_lab_insert on public.clinic_lab_cases;
create policy clinic_lab_insert on public.clinic_lab_cases
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
  and created_by = auth.uid()
);
drop policy if exists clinic_lab_update on public.clinic_lab_cases;
create policy clinic_lab_update on public.clinic_lab_cases
for update to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
)
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','nurse'])
  and public.can_access_clinic_branch(clinic_id, branch_id)
);
drop policy if exists clinic_lab_delete on public.clinic_lab_cases;
create policy clinic_lab_delete on public.clinic_lab_cases
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and public.can_access_clinic_branch(clinic_id, branch_id));

-- Audit is append-only for normal users; owner can read all clinic audit entries.
drop policy if exists clinic_audit_select on public.clinic_audit_events;
create policy clinic_audit_select on public.clinic_audit_events
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or (
    public.has_clinic_role(clinic_id, array['manager'])
    and (branch_id is null or public.can_access_clinic_branch(clinic_id, branch_id))
  )
);
drop policy if exists clinic_audit_insert on public.clinic_audit_events;
create policy clinic_audit_insert on public.clinic_audit_events
for insert to authenticated
with check (
  public.is_clinic_member(clinic_id)
  and actor_user_id = auth.uid()
  and (branch_id is null or public.can_access_clinic_branch(clinic_id, branch_id))
);
