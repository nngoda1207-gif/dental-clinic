-- Stable identities and retry-safe lab case payment ledger.
alter table public.clinic_laboratories add column if not exists source_local_id text;
alter table public.clinic_lab_cases add column if not exists source_local_id text;
alter table public.clinic_lab_payments add column if not exists source_local_id text;

create unique index if not exists clinic_laboratories_local_identity_uidx
 on public.clinic_laboratories(clinic_id,source_local_id) where source_local_id is not null;
create unique index if not exists clinic_lab_cases_local_identity_uidx
 on public.clinic_lab_cases(clinic_id,branch_id,source_local_id) where source_local_id is not null;
create unique index if not exists clinic_lab_payments_local_identity_uidx
 on public.clinic_lab_payments(clinic_id,branch_id,source_local_id) where source_local_id is not null;

create or replace function public.touch_lab_case_updated_at()
returns trigger language plpgsql set search_path=''
as $lab_case_version$
begin new.updated_at:=pg_catalog.clock_timestamp();return new;end;
$lab_case_version$;
drop trigger if exists clinic_lab_cases_touch_sync_version on public.clinic_lab_cases;
create trigger clinic_lab_cases_touch_sync_version before update on public.clinic_lab_cases
for each row execute function public.touch_lab_case_updated_at();

revoke insert on public.clinic_lab_payments from public,anon,authenticated;
create or replace function public.post_lab_case_payment_idempotent(
 p_lab_case_id uuid,p_source_local_id text,p_amount numeric,
 p_method text default 'cash',p_reference text default '',p_notes text default '',p_paid_at timestamptz default now()
)
returns public.clinic_lab_payments
language plpgsql security definer set search_path=''
as $lab_payment_sync$
declare
 v_actor uuid:=auth.uid();v_case public.clinic_lab_cases%rowtype;
 v_entry public.clinic_lab_payments%rowtype;v_amount numeric(12,2);
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
    or v_entry.paid_at<>coalesce(p_paid_at,now()) then
   raise exception 'Local lab-payment ID was reused with different data' using errcode='23505';
  end if;
  return v_entry;
 end if;
 v_amount:=round(p_amount,2);
 insert into public.clinic_lab_payments(clinic_id,branch_id,lab_case_id,amount,paid_at,method,reference,notes,created_by,source_local_id)
 values(v_case.clinic_id,v_case.branch_id,v_case.id,v_amount,coalesce(p_paid_at,now()),p_method,coalesce(p_reference,''),coalesce(p_notes,''),v_actor,p_source_local_id)
 returning * into v_entry;
 return v_entry;
end;
$lab_payment_sync$;
revoke all on function public.post_lab_case_payment_idempotent(uuid,text,numeric,text,text,text,timestamptz) from public,anon;
grant execute on function public.post_lab_case_payment_idempotent(uuid,text,numeric,text,text,text,timestamptz) to authenticated;

do $lab_realtime$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_lab_cases') then
   alter publication supabase_realtime add table public.clinic_lab_cases;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_lab_payments') then
   alter publication supabase_realtime add table public.clinic_lab_payments;
  end if;
 end if;
end
$lab_realtime$;
