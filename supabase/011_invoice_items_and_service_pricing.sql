-- Migration 011: immutable invoice line snapshots created atomically from clinic services.
create table if not exists public.clinic_invoice_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  invoice_id uuid not null,
  service_id uuid not null,
  service_name text not null,
  unit text not null default '',
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id,id) on delete restrict,
  foreign key (clinic_id, invoice_id)
    references public.clinic_invoices(clinic_id,id) on delete restrict,
  foreign key (clinic_id, service_id)
    references public.clinic_services(clinic_id,id) on delete restrict,
  check (discount <= quantity * unit_price),
  check (line_total = round(quantity * unit_price - discount,2))
);

create index if not exists clinic_invoice_items_invoice_idx
  on public.clinic_invoice_items(clinic_id,branch_id,invoice_id);

alter table public.clinic_invoice_items enable row level security;
grant select on public.clinic_invoice_items to authenticated;
drop policy if exists clinic_invoice_items_select on public.clinic_invoice_items;
create policy clinic_invoice_items_select on public.clinic_invoice_items
for select to authenticated
using (
  private.has_clinic_role(clinic_id,array['owner'])
  or (
    private.has_clinic_role(clinic_id,array['manager','accountant','reception','readonly'])
    and private.can_access_clinic_branch(clinic_id,branch_id)
  )
);

revoke insert,update,delete on public.clinic_invoice_items from public,anon,authenticated;

create or replace function public.create_invoice_with_items(
  p_branch_id uuid,
  p_patient_id uuid,
  p_invoice_no text,
  p_lines jsonb,
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
  v_subtotal numeric(12,2) := 0;
  v_line_discount numeric(12,2) := 0;
  v_invoice_discount numeric(12,2) := round(coalesce(p_invoice_discount,0),2);
  v_invoice public.clinic_invoices%rowtype;
  v_line jsonb;
  v_service public.clinic_services%rowtype;
  v_qty numeric(10,2);
  v_discount numeric(12,2);
  v_line_total numeric(12,2);
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'At least one invoice line is required' using errcode='22023';
  end if;
  if v_invoice_discount < 0 then raise exception 'Invoice discount cannot be negative' using errcode='22023'; end if;
  if p_invoice_no is null or length(trim(p_invoice_no))=0 then
    raise exception 'Invoice number is required' using errcode='22023';
  end if;

  select clinic_id into v_clinic_id from public.clinic_branches where id=p_branch_id;
  if v_clinic_id is null then raise exception 'Branch not found' using errcode='P0002'; end if;
  if not private.has_clinic_role(v_clinic_id,array['owner','manager','accountant'])
     or not private.can_access_clinic_branch(v_clinic_id,p_branch_id) then
    raise exception 'Not allowed to create invoices in this branch' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.clinic_patients
     where id=p_patient_id and clinic_id=v_clinic_id and branch_id=p_branch_id
  ) then raise exception 'Patient not found in assigned branch' using errcode='P0002'; end if;

  -- Validate every catalog reference and compute all totals server-side.
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce(v_line->>'service_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Each invoice line requires a valid service_id' using errcode='22023';
    end if;
    select * into v_service from public.clinic_services
     where id=(v_line->>'service_id')::uuid and clinic_id=v_clinic_id and active=true;
    if not found then raise exception 'Active service not found in this clinic' using errcode='P0002'; end if;
    v_qty := (v_line->>'quantity')::numeric;
    v_discount := round(coalesce((v_line->>'discount')::numeric,0),2);
    if v_qty <= 0 or v_qty <> round(v_qty,2) or v_discount < 0 then
      raise exception 'Invalid invoice line quantity or discount' using errcode='22023';
    end if;
    v_line_total := round(v_qty*v_service.price-v_discount,2);
    if v_discount > v_qty*v_service.price then raise exception 'Line discount exceeds line amount' using errcode='23514'; end if;
    v_subtotal := v_subtotal + round(v_qty*v_service.price,2);
    v_line_discount := v_line_discount + v_discount;
  end loop;

  if v_invoice_discount > v_subtotal-v_line_discount then
    raise exception 'Invoice discount exceeds amount after line discounts' using errcode='23514';
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

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_service from public.clinic_services
     where id=(v_line->>'service_id')::uuid and clinic_id=v_clinic_id and active=true;
    v_qty := (v_line->>'quantity')::numeric;
    v_discount := round(coalesce((v_line->>'discount')::numeric,0),2);
    v_line_total := round(v_qty*v_service.price-v_discount,2);
    insert into public.clinic_invoice_items(
      clinic_id,branch_id,invoice_id,service_id,service_name,unit,
      quantity,unit_price,discount,line_total
    ) values (
      v_clinic_id,p_branch_id,v_invoice.id,v_service.id,v_service.name,v_service.unit,
      v_qty,v_service.price,v_discount,v_line_total
    );
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.create_invoice_with_items(uuid,uuid,text,jsonb,numeric,text,timestamptz) from public,anon;
grant execute on function public.create_invoice_with_items(uuid,uuid,text,jsonb,numeric,text,timestamptz) to authenticated;
comment on function public.create_invoice_with_items(uuid,uuid,text,jsonb,numeric,text,timestamptz)
is 'Creates an invoice and immutable service-price snapshots in one transaction; price and totals are calculated server-side.';
