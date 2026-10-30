-- Make omitted lab-payment timestamps stable across offline retries.
-- An explicit paid_at remains part of payload identity; when omitted, the
-- existing idempotency key wins before a new timestamp is generated.
create or replace function public.post_lab_case_payment_idempotent(
 p_lab_case_id uuid,p_source_local_id text,p_amount numeric,
 p_method text default 'cash',p_reference text default '',p_notes text default '',p_paid_at timestamptz default null
)
returns public.clinic_lab_payments
language plpgsql security definer set search_path=''
as $lab_payment_sync_v2$
declare
 v_actor uuid:=auth.uid();v_case public.clinic_lab_cases%rowtype;
 v_entry public.clinic_lab_payments%rowtype;v_amount numeric(12,2);v_paid_at timestamptz;
begin
 if v_actor is null then raise exception 'Authentication required' using errcode='28000';end if;
 if p_source_local_id is null or pg_catalog.btrim(p_source_local_id)='' then raise exception 'Stable local lab-payment ID required' using errcode='22023';end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Lab payment must be positive with at most two decimals' using errcode='22023';end if;
 if p_method not in ('cash','card','transfer','wallet','other') then raise exception 'Unsupported payment method' using errcode='22023';end if;
 select * into v_case from public.clinic_lab_cases where id=p_lab_case_id for update;
 if not found then raise exception 'Lab case not found' using errcode='P0002';end if;
 if not public.has_clinic_role(v_case.clinic_id,array['owner','manager','accountant'])
    or not public.can_access_clinic_branch(v_case.clinic_id,v_case.branch_id) then
  raise exception 'Not allowed to post lab payments' using errcode='42501';
 end if;
 select * into v_entry from public.clinic_lab_payments
  where clinic_id=v_case.clinic_id and branch_id=v_case.branch_id and source_local_id=p_source_local_id;
 if found then
  if v_entry.lab_case_id<>v_case.id or v_entry.amount<>round(p_amount,2) or v_entry.method<>p_method
    or v_entry.reference<>coalesce(p_reference,'') or v_entry.notes<>coalesce(p_notes,'')
    or (p_paid_at is not null and v_entry.paid_at<>p_paid_at) then
   raise exception 'Local lab-payment ID was reused with different data' using errcode='23505';
  end if;
  return v_entry;
 end if;
 v_amount:=round(p_amount,2);
 v_paid_at:=coalesce(p_paid_at,pg_catalog.clock_timestamp());
 insert into public.clinic_lab_payments(clinic_id,branch_id,lab_case_id,amount,paid_at,method,reference,notes,created_by,source_local_id)
 values(v_case.clinic_id,v_case.branch_id,v_case.id,v_amount,v_paid_at,p_method,coalesce(p_reference,''),coalesce(p_notes,''),v_actor,p_source_local_id)
 returning * into v_entry;
 return v_entry;
end;
$lab_payment_sync_v2$;
revoke all on function public.post_lab_case_payment_idempotent(uuid,text,numeric,text,text,text,timestamptz) from public,anon;
grant execute on function public.post_lab_case_payment_idempotent(uuid,text,numeric,text,text,text,timestamptz) to authenticated;
