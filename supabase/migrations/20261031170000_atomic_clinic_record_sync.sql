create or replace function public.save_clinic_record(
  p_clinic_id uuid, p_branch_id uuid, p_module text, p_record_key text,
  p_payload jsonb, p_expected_revision bigint default null
)
returns setof public.clinic_records
language plpgsql security invoker set search_path = ''
as $$
declare v_row public.clinic_records%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_clinic_id is null or p_branch_id is null then raise exception 'CLINIC_BRANCH_REQUIRED' using errcode = '22023'; end if;
  if p_module not in ('patients','appointments','finance','prices','inventory','labs','reports','settings','branches','audit','suppliers','treatment') then raise exception 'INVALID_MODULE' using errcode = '22023'; end if;
  if p_record_key is null or length(btrim(p_record_key)) < 1 or length(btrim(p_record_key)) > 160 then raise exception 'INVALID_RECORD_KEY' using errcode = '22023'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 500000 then raise exception 'INVALID_PAYLOAD' using errcode = '22023'; end if;
  if p_expected_revision is null then
    insert into public.clinic_records(clinic_id,branch_id,module,record_key,payload,revision,created_by,updated_by)
    values(p_clinic_id,p_branch_id,p_module,p_record_key,p_payload,1,auth.uid(),auth.uid())
    on conflict(clinic_id,branch_id,module,record_key) do nothing returning * into v_row;
    if not found then raise exception 'RECORD_ALREADY_EXISTS' using errcode = '23505'; end if;
  else
    update public.clinic_records set payload=p_payload,revision=revision+1,updated_by=auth.uid(),updated_at=now()
    where clinic_id=p_clinic_id and branch_id=p_branch_id and module=p_module
      and record_key=p_record_key and revision=p_expected_revision and deleted_at is null
    returning * into v_row;
    if not found then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
  end if;
  return next v_row;
end;
$$;
create or replace function public.archive_clinic_record(
  p_clinic_id uuid,p_branch_id uuid,p_module text,p_record_key text,p_expected_revision bigint
)
returns setof public.clinic_records
language plpgsql security invoker set search_path = ''
as $$
declare v_row public.clinic_records%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_expected_revision is null or p_branch_id is null then raise exception 'REVISION_AND_BRANCH_REQUIRED' using errcode = '22023'; end if;
  update public.clinic_records set deleted_at=now(),revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where clinic_id=p_clinic_id and branch_id=p_branch_id and module=p_module
    and record_key=p_record_key and revision=p_expected_revision and deleted_at is null
  returning * into v_row;
  if not found then raise exception 'REVISION_CONFLICT_OR_NOT_FOUND' using errcode = '40001'; end if;
  return next v_row;
end;
$$;
revoke all on function public.save_clinic_record(uuid,uuid,text,text,jsonb,bigint) from public,anon;
revoke all on function public.archive_clinic_record(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.save_clinic_record(uuid,uuid,text,text,jsonb,bigint) to authenticated;
grant execute on function public.archive_clinic_record(uuid,uuid,text,text,bigint) to authenticated;
