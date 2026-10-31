-- Stable local payment/refund identities and retry-safe ledger RPCs.
alter table public.clinic_invoice_payments add column if not exists source_local_id text;
create unique index if not exists clinic_invoice_payments_local_identity_uidx
  on public.clinic_invoice_payments(clinic_id,branch_id,source_local_id)
  where source_local_id is not null;

create or replace function public.post_invoice_payment_idempotent(
  p_invoice_id uuid,p_source_local_id text,p_amount numeric,
  p_method text default 'cash',p_reference text default '',p_notes text default '',
  p_paid_at timestamptz default now()
)
returns public.clinic_invoice_payments
language plpgsql security definer set search_path=''
as $payment_sync$
declare
 v_actor uuid:=auth.uid();v_invoice public.clinic_invoices%rowtype;
 v_entry public.clinic_invoice_payments%rowtype;v_paid numeric(12,2);v_amount numeric(12,2);
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_source_local_id is null or pg_catalog.btrim(p_source_local_id)='' then raise exception 'Stable local payment ID required' using errcode='22023';end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Payment amount must be positive with at most two decimals' using errcode='22023';end if;
 if p_method not in ('cash','card','transfer','wallet','other') then raise exception 'Unsupported payment method' using errcode='22023';end if;
 select * into v_invoice from public.clinic_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002';end if;
 if not private.has_clinic_role(v_invoice.clinic_id,array['owner','manager','accountant'])
    or not private.can_access_clinic_branch(v_invoice.clinic_id,v_invoice.branch_id) then
   raise exception 'Not allowed to post invoice payments' using errcode='42501';
 end if;
 select * into v_entry from public.clinic_invoice_payments
  where clinic_id=v_invoice.clinic_id and branch_id=v_invoice.branch_id and source_local_id=p_source_local_id;
 if found then
  if v_entry.invoice_id<>v_invoice.id or v_entry.entry_type<>'payment' or v_entry.amount<>round(p_amount,2)
     or v_entry.method<>p_method or v_entry.reference<>coalesce(p_reference,'') or v_entry.notes<>coalesce(p_notes,'')
     or v_entry.paid_at<>coalesce(p_paid_at,now()) then
   raise exception 'Local payment ID was reused with different data' using errcode='23505';
  end if;
  return v_entry;
 end if;
 if v_invoice.status in ('void','refunded') then raise exception 'Cannot pay a void or fully refunded invoice' using errcode='23514';end if;
 select coalesce(sum(case when entry_type='refund' then -amount else amount end),0) into v_paid
  from public.clinic_invoice_payments where clinic_id=v_invoice.clinic_id and invoice_id=v_invoice.id;
 v_amount:=round(p_amount,2);
 if v_amount>v_invoice.total-v_paid then raise exception 'Payment exceeds outstanding invoice balance' using errcode='23514';end if;
 insert into public.clinic_invoice_payments(clinic_id,branch_id,invoice_id,amount,method,paid_at,reference,notes,created_by,entry_type,original_payment_id,source_local_id)
 values(v_invoice.clinic_id,v_invoice.branch_id,v_invoice.id,v_amount,p_method,coalesce(p_paid_at,now()),coalesce(p_reference,''),coalesce(p_notes,''),v_actor,'payment',null,p_source_local_id)
 returning * into v_entry;
 v_paid:=v_paid+v_amount;
 update public.clinic_invoices set status=case when v_paid>=v_invoice.total then 'paid' else 'open' end
  where id=v_invoice.id and clinic_id=v_invoice.clinic_id;
 return v_entry;
end;
$payment_sync$;

create or replace function public.refund_invoice_payment_idempotent(
 p_original_payment_id uuid,p_source_local_id text,p_amount numeric,
 p_reference text default '',p_notes text default '',p_paid_at timestamptz default now()
)
returns public.clinic_invoice_payments
language plpgsql security definer set search_path=''
as $refund_sync$
declare
 v_actor uuid:=auth.uid();v_original public.clinic_invoice_payments%rowtype;
 v_invoice public.clinic_invoices%rowtype;v_entry public.clinic_invoice_payments%rowtype;
 v_refunded numeric(12,2);v_net_paid numeric(12,2);v_amount numeric(12,2);
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_source_local_id is null or pg_catalog.btrim(p_source_local_id)='' then raise exception 'Stable local refund ID required' using errcode='22023';end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Refund amount must be positive with at most two decimals' using errcode='22023';end if;
 select * into v_original from public.clinic_invoice_payments where id=p_original_payment_id and entry_type='payment';
 if not found then raise exception 'Original payment not found' using errcode='P0002';end if;
 select * into v_invoice from public.clinic_invoices where id=v_original.invoice_id and clinic_id=v_original.clinic_id for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002';end if;
 if not private.has_clinic_role(v_invoice.clinic_id,array['owner','manager','accountant'])
    or not private.can_access_clinic_branch(v_invoice.clinic_id,v_invoice.branch_id) then
   raise exception 'Not allowed to refund invoice payments' using errcode='42501';
 end if;
 select * into v_entry from public.clinic_invoice_payments
  where clinic_id=v_invoice.clinic_id and branch_id=v_invoice.branch_id and source_local_id=p_source_local_id;
 if found then
  if v_entry.invoice_id<>v_invoice.id or v_entry.entry_type<>'refund'
     or v_entry.original_payment_id<>p_original_payment_id or v_entry.amount<>round(p_amount,2)
     or v_entry.reference<>coalesce(p_reference,'') or v_entry.notes<>coalesce(p_notes,'')
     or v_entry.paid_at<>coalesce(p_paid_at,now()) then
   raise exception 'Local refund ID was reused with different data' using errcode='23505';
  end if;
  return v_entry;
 end if;
 if v_invoice.status='void' then raise exception 'Cannot refund a void invoice' using errcode='23514';end if;
 select * into v_original from public.clinic_invoice_payments
  where id=p_original_payment_id and clinic_id=v_invoice.clinic_id and invoice_id=v_invoice.id and entry_type='payment' for update;
 if not found then raise exception 'Original payment not found' using errcode='P0002';end if;
 select coalesce(sum(amount),0) into v_refunded from public.clinic_invoice_payments
  where clinic_id=v_original.clinic_id and original_payment_id=v_original.id and entry_type='refund';
 v_amount:=round(p_amount,2);
 if v_amount>v_original.amount-v_refunded then raise exception 'Refund exceeds refundable amount' using errcode='23514';end if;
 insert into public.clinic_invoice_payments(clinic_id,branch_id,invoice_id,amount,method,paid_at,reference,notes,created_by,entry_type,original_payment_id,source_local_id)
 values(v_original.clinic_id,v_original.branch_id,v_original.invoice_id,v_amount,v_original.method,coalesce(p_paid_at,now()),coalesce(p_reference,''),coalesce(p_notes,''),v_actor,'refund',v_original.id,p_source_local_id)
 returning * into v_entry;
 select coalesce(sum(case when entry_type='refund' then -amount else amount end),0) into v_net_paid
  from public.clinic_invoice_payments where clinic_id=v_invoice.clinic_id and invoice_id=v_invoice.id;
 update public.clinic_invoices set status=case when v_net_paid<=0 then 'refunded' when v_net_paid>=total then 'paid' else 'open' end
  where id=v_invoice.id and clinic_id=v_invoice.clinic_id;
 return v_entry;
end;
$refund_sync$;

revoke all on function public.post_invoice_payment_idempotent(uuid,text,numeric,text,text,text,timestamptz) from public,anon;
revoke all on function public.refund_invoice_payment_idempotent(uuid,text,numeric,text,text,timestamptz) from public,anon;
grant execute on function public.post_invoice_payment_idempotent(uuid,text,numeric,text,text,text,timestamptz) to authenticated;
grant execute on function public.refund_invoice_payment_idempotent(uuid,text,numeric,text,text,timestamptz) to authenticated;
