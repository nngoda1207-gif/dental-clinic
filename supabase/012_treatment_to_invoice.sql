-- Migration 012: link completed treatment procedures to invoice lines exactly once.
-- Treatment plans remain clinical records; only explicitly completed items can be billed.

alter table public.clinic_treatment_items
  add column if not exists service_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname='clinic_treatment_items_clinic_id_id_key'
       and conrelid='public.clinic_treatment_items'::regclass
  ) then
    alter table public.clinic_treatment_items
      add constraint clinic_treatment_items_clinic_id_id_key unique (clinic_id,id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname='clinic_treatment_items_clinic_service_fk'
       and conrelid='public.clinic_treatment_items'::regclass
  ) then
    alter table public.clinic_treatment_items
      add constraint clinic_treatment_items_clinic_service_fk
      foreign key (clinic_id,service_id)
      references public.clinic_services(clinic_id,id) on delete restrict;
  end if;
end $$;

alter table public.clinic_invoice_items
  add column if not exists treatment_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname='clinic_invoice_items_treatment_item_fk'
       and conrelid='public.clinic_invoice_items'::regclass
  ) then
    alter table public.clinic_invoice_items
      add constraint clinic_invoice_items_treatment_item_fk
      foreign key (clinic_id,treatment_item_id)
      references public.clinic_treatment_items(clinic_id,id) on delete restrict;
  end if;
end $$;

create unique index if not exists clinic_invoice_items_one_bill_per_treatment_idx
  on public.clinic_invoice_items(clinic_id,treatment_item_id)
  where treatment_item_id is not null;

create index if not exists clinic_treatment_items_billable_idx
  on public.clinic_treatment_items(clinic_id,branch_id,patient_id,status)
  where status='done';

create or replace function public.create_invoice_from_treatment_items(
  p_branch_id uuid,
  p_patient_id uuid,
  p_invoice_no text,
  p_treatment_item_ids uuid[],
  p_invoice_discount numeric default 0,
  p_notes text default '',
  p_issued_at timestamptz default now()
)
returns public.clinic_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_clinic_id uuid;
  v_invoice public.clinic_invoices%rowtype;
  v_item public.clinic_treatment_items%rowtype;
  v_service public.clinic_services%rowtype;
  v_count integer;
  v_subtotal numeric(12,2) := 0;
  v_line_discount numeric(12,2) := 0;
  v_invoice_discount numeric(12,2) := round(coalesce(p_invoice_discount,0),2);
  v_line_total numeric(12,2);
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_treatment_item_ids is null or cardinality(p_treatment_item_ids)=0 then
    raise exception 'At least one completed treatment item is required' using errcode='22023';
  end if;
  if array_position(p_treatment_item_ids,null) is not null
     or cardinality(p_treatment_item_ids) <> (select count(distinct x) from unnest(p_treatment_item_ids) x) then
    raise exception 'Treatment item IDs must be unique and non-null' using errcode='22023';
  end if;
  if v_invoice_discount < 0 then raise exception 'Invoice discount cannot be negative' using errcode='22023'; end if;
  if p_invoice_no is null or length(trim(p_invoice_no))=0 then
    raise exception 'Invoice number is required' using errcode='22023';
  end if;

  select clinic_id into v_clinic_id from public.clinic_branches where id=p_branch_id;
  if v_clinic_id is null then raise exception 'Branch not found' using errcode='P0002'; end if;
  if not public.has_clinic_role(v_clinic_id,array['owner','manager','accountant'])
     or not public.can_access_clinic_branch(v_clinic_id,p_branch_id) then
    raise exception 'Not allowed to create invoices in this branch' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.clinic_patients
     where id=p_patient_id and clinic_id=v_clinic_id and branch_id=p_branch_id
  ) then raise exception 'Patient not found in assigned branch' using errcode='P0002'; end if;

  -- Lock all selected treatment rows in stable order, preventing concurrent double billing.
  perform 1
    from public.clinic_treatment_items t
   where t.clinic_id=v_clinic_id and t.branch_id=p_branch_id
     and t.patient_id=p_patient_id and t.id=any(p_treatment_item_ids)
   order by t.id
   for update;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_treatment_item_ids) then
    raise exception 'One or more treatment items do not belong to this patient and branch' using errcode='P0002';
  end if;

  for v_item in
    select * from public.clinic_treatment_items
     where clinic_id=v_clinic_id and branch_id=p_branch_id
       and patient_id=p_patient_id and id=any(p_treatment_item_ids)
     order by id
  loop
    if v_item.status <> 'done' then
      raise exception 'Only completed treatment items can be invoiced' using errcode='23514';
    end if;
    if v_item.service_id is null then
      raise exception 'Assign a service catalog item to each treatment before invoicing' using errcode='23502';
    end if;
    select * into v_service from public.clinic_services
     where id=v_item.service_id and clinic_id=v_clinic_id and active=true;
    if not found then raise exception 'Treatment service is missing or inactive' using errcode='P0002'; end if;
    if v_item.discount > v_item.quantity*v_item.unit_price then
      raise exception 'Treatment discount exceeds procedure amount' using errcode='23514';
    end if;
    v_subtotal := v_subtotal + round(v_item.quantity*v_item.unit_price,2);
    v_line_discount := v_line_discount + v_item.discount;
  end loop;

  if v_invoice_discount > v_subtotal-v_line_discount then
    raise exception 'Invoice discount exceeds amount after treatment discounts' using errcode='23514';
  end if;

  insert into public.clinic_invoices(
    clinic_id,branch_id,patient_id,invoice_no,status,currency,
    subtotal,discount,total,notes,issued_at,created_by
  ) values (
    v_clinic_id,p_branch_id,p_patient_id,trim(p_invoice_no),'open','EGP',
    v_subtotal,v_line_discount+v_invoice_discount,
    v_subtotal-v_line_discount-v_invoice_discount,
    coalesce(p_notes,''),coalesce(p_issued_at,now()),v_actor
  ) returning * into v_invoice;

  for v_item in
    select * from public.clinic_treatment_items
     where clinic_id=v_clinic_id and branch_id=p_branch_id
       and patient_id=p_patient_id and id=any(p_treatment_item_ids)
     order by id
  loop
    select * into v_service from public.clinic_services
     where id=v_item.service_id and clinic_id=v_clinic_id and active=true;
    v_line_total := round(v_item.quantity*v_item.unit_price-v_item.discount,2);
    insert into public.clinic_invoice_items(
      clinic_id,branch_id,invoice_id,service_id,service_name,unit,
      quantity,unit_price,discount,line_total,treatment_item_id
    ) values (
      v_clinic_id,p_branch_id,v_invoice.id,v_service.id,v_item.procedure_name,
      v_service.unit,v_item.quantity,v_item.unit_price,v_item.discount,
      v_line_total,v_item.id
    );
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.create_invoice_from_treatment_items(uuid,uuid,text,uuid[],numeric,text,timestamptz) from public,anon;
grant execute on function public.create_invoice_from_treatment_items(uuid,uuid,text,uuid[],numeric,text,timestamptz) to authenticated;
comment on function public.create_invoice_from_treatment_items(uuid,uuid,text,uuid[],numeric,text,timestamptz)
is 'Creates an invoice from completed treatment items, locks them against concurrent billing, and prevents a treatment item from appearing on multiple invoices.';
