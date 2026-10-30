-- Dental Clinic OS: financial/history immutability and remaining parent-branch guards.
-- Apply after migrations 001-004 in a disposable Supabase project first.
-- These guards are additive and have not been applied to the user's live project.

-- Ensure operational child rows stay in the same branch as their parent records.
create or replace function public.enforce_operational_parent_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_branch uuid;
begin
  if tg_table_name = 'clinic_clinical_records' then
    select p.branch_id into parent_branch
      from public.clinic_patients p
     where p.clinic_id = new.clinic_id and p.id = new.patient_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Clinical record branch must match the patient branch'
        using errcode = '23514';
    end if;
    if new.appointment_id is not null then
      select a.branch_id into parent_branch
        from public.clinic_appointments a
       where a.clinic_id = new.clinic_id and a.id = new.appointment_id;
      if parent_branch is null or parent_branch <> new.branch_id then
        raise exception 'Clinical record appointment must be in the same branch'
          using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'clinic_treatment_items' then
    select p.branch_id into parent_branch
      from public.clinic_patients p
     where p.clinic_id = new.clinic_id and p.id = new.patient_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Treatment item branch must match the patient branch'
        using errcode = '23514';
    end if;
    if new.clinical_record_id is not null then
      select r.branch_id into parent_branch
        from public.clinic_clinical_records r
       where r.clinic_id = new.clinic_id and r.id = new.clinical_record_id;
      if parent_branch is null or parent_branch <> new.branch_id then
        raise exception 'Treatment item clinical record must be in the same branch'
          using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'clinic_invoices' then
    select p.branch_id into parent_branch
      from public.clinic_patients p
     where p.clinic_id = new.clinic_id and p.id = new.patient_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Invoice branch must match the patient branch'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'clinic_invoice_payments' then
    select i.branch_id into parent_branch
      from public.clinic_invoices i
     where i.clinic_id = new.clinic_id and i.id = new.invoice_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Payment branch must match the invoice branch'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'clinic_inventory_movements' then
    select i.branch_id into parent_branch
      from public.clinic_inventory_items i
     where i.clinic_id = new.clinic_id and i.id = new.item_id;
    if parent_branch is null or parent_branch <> new.branch_id then
      raise exception 'Inventory movement branch must match the item branch'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_clinical_record_branch_guard on public.clinic_clinical_records;
create trigger clinic_clinical_record_branch_guard
before insert or update of clinic_id, branch_id, patient_id, appointment_id
on public.clinic_clinical_records
for each row execute function public.enforce_operational_parent_branch();

drop trigger if exists clinic_treatment_item_branch_guard on public.clinic_treatment_items;
create trigger clinic_treatment_item_branch_guard
before insert or update of clinic_id, branch_id, patient_id, clinical_record_id
on public.clinic_treatment_items
for each row execute function public.enforce_operational_parent_branch();

drop trigger if exists clinic_invoice_branch_guard on public.clinic_invoices;
create trigger clinic_invoice_branch_guard
before insert or update of clinic_id, branch_id, patient_id
on public.clinic_invoices
for each row execute function public.enforce_operational_parent_branch();

drop trigger if exists clinic_invoice_payment_branch_guard on public.clinic_invoice_payments;
create trigger clinic_invoice_payment_branch_guard
before insert or update of clinic_id, branch_id, invoice_id
on public.clinic_invoice_payments
for each row execute function public.enforce_operational_parent_branch();

drop trigger if exists clinic_inventory_movement_branch_guard on public.clinic_inventory_movements;
create trigger clinic_inventory_movement_branch_guard
before insert or update of clinic_id, branch_id, item_id
on public.clinic_inventory_movements
for each row execute function public.enforce_operational_parent_branch();

-- Payments and stock movements are ledgers. Corrections should be new refund,
-- reversal or adjustment entries, never edits that erase the original event.
create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Ledger entries are append-only; create a reversal/adjustment entry'
    using errcode = '55000';
end;
$$;

drop trigger if exists clinic_invoice_payments_immutable on public.clinic_invoice_payments;
create trigger clinic_invoice_payments_immutable
before update or delete on public.clinic_invoice_payments
for each row execute function public.reject_ledger_mutation();

drop trigger if exists clinic_lab_payments_immutable on public.clinic_lab_payments;
create trigger clinic_lab_payments_immutable
before update or delete on public.clinic_lab_payments
for each row execute function public.reject_ledger_mutation();

drop trigger if exists clinic_inventory_movements_immutable on public.clinic_inventory_movements;
create trigger clinic_inventory_movements_immutable
before update or delete on public.clinic_inventory_movements
for each row execute function public.reject_ledger_mutation();

-- Prevent clients from spoofing audit actor identity or rewriting history.
drop policy if exists clinic_audit_insert on public.clinic_audit_events;
create policy clinic_audit_insert on public.clinic_audit_events
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner','manager','dentist','reception','accountant','invmgr','nurse'])
  and actor_user_id = auth.uid()
  and (branch_id is null or public.can_access_clinic_branch(clinic_id, branch_id))
);

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit history is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists clinic_audit_events_immutable on public.clinic_audit_events;
create trigger clinic_audit_events_immutable
before update or delete on public.clinic_audit_events
for each row execute function public.reject_audit_mutation();

-- Still required before production: transaction-safe stock posting, refund/reversal
-- workflows, appointment scheduling RPC/chair assignment, and full RLS tests.
