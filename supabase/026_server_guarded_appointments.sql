-- Server-authoritative appointment writes on the generic cloud record store.
-- The RPC checks branch/module permissions, linked patient/dentist identities,
-- and cross-device schedule overlaps before creating or revising a record.
begin;

create or replace function public.save_clinic_appointment_record(
  p_clinic_id uuid,
  p_branch_id uuid,
  p_record_key text,
  p_payload jsonb,
  p_expected_revision bigint default null
) returns setof public.clinic_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_patient_id uuid;
  v_patient_file_no text;
  v_dentist_username text;
  v_chair_name text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_status text;
  v_existing public.clinic_records%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_clinic_id is null or p_branch_id is null then raise exception 'CLINIC_BRANCH_REQUIRED'; end if;
  if p_record_key is null or length(btrim(p_record_key)) < 1 or length(btrim(p_record_key)) > 160 then
    raise exception 'INVALID_APPOINTMENT_KEY';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 12000
     or p_payload->>'kind' <> 'appointment' then
    raise exception 'INVALID_APPOINTMENT_PAYLOAD';
  end if;
  if coalesce(p_payload->>'source_local_id','') <> p_record_key then
    raise exception 'APPOINTMENT_LOCAL_ID_MISMATCH';
  end if;
  if not private.can_access_clinic_record(
    p_clinic_id, p_branch_id, 'appointments',
    case when p_expected_revision is null then 'create' else 'update' end
  ) then raise exception 'APPOINTMENT_PERMISSION_DENIED'; end if;

  begin
    v_patient_id := (p_payload->>'patient_record_id')::uuid;
    v_starts_at := (p_payload->>'starts_at')::timestamptz;
    v_ends_at := (p_payload->>'ends_at')::timestamptz;
  exception when others then
    raise exception 'INVALID_APPOINTMENT_PATIENT_OR_TIME';
  end;
  v_patient_file_no := btrim(coalesce(p_payload->>'patient_file_no',''));
  v_dentist_username := lower(btrim(coalesce(p_payload->>'dentist_username','')));
  v_chair_name := nullif(btrim(coalesce(p_payload->>'chair_name','')),'');
  v_status := coalesce(p_payload->>'status','scheduled');

  if v_patient_file_no = '' or v_dentist_username = '' then raise exception 'APPOINTMENT_LINKS_REQUIRED'; end if;
  if v_starts_at is null or v_ends_at is null or v_ends_at <= v_starts_at then raise exception 'INVALID_APPOINTMENT_TIME_RANGE'; end if;
  if v_status not in ('scheduled','confirmed','arrived','completed','cancelled','no_show') then raise exception 'INVALID_APPOINTMENT_STATUS'; end if;
  if v_chair_name is not null and length(v_chair_name) > 120 then raise exception 'INVALID_APPOINTMENT_CHAIR'; end if;

  if not exists (
    select 1 from public.clinic_records p
    where p.id = v_patient_id and p.clinic_id = p_clinic_id
      and p.branch_id = p_branch_id and p.module = 'patients'
      and p.record_key = v_patient_file_no and p.deleted_at is null
  ) then raise exception 'APPOINTMENT_PATIENT_NOT_LINKED'; end if;

  if not exists (
    select 1
    from public.clinic_usernames u
    join public.clinic_members m on m.user_id = u.user_id and m.clinic_id = p_clinic_id and m.active = true
    join public.clinic_member_branches mb on mb.clinic_id = m.clinic_id and mb.user_id = m.user_id and mb.branch_id = p_branch_id
    where u.username = v_dentist_username and m.role in ('owner','manager','dentist')
  ) then raise exception 'APPOINTMENT_DENTIST_NOT_LINKED_TO_BRANCH'; end if;

  if exists (
    select 1
    from public.clinic_records r
    where r.clinic_id = p_clinic_id and r.branch_id = p_branch_id
      and r.module = 'appointments' and r.deleted_at is null
      and r.record_key <> p_record_key
      and r.payload->>'kind' = 'appointment'
      and coalesce(r.payload->>'status','scheduled') not in ('cancelled','completed','no_show')
      and (
        r.payload->>'dentist_username' = v_dentist_username
        or (v_chair_name is not null and r.payload->>'chair_name' = v_chair_name)
      )
      and (r.payload->>'starts_at')::timestamptz < v_ends_at
      and (r.payload->>'ends_at')::timestamptz > v_starts_at
  ) then raise exception 'APPOINTMENT_OVERLAP'; end if;

  if p_expected_revision is null then
    if exists (
      select 1 from public.clinic_records r
      where r.clinic_id = p_clinic_id and r.branch_id = p_branch_id
        and r.module = 'appointments' and r.record_key = p_record_key
    ) then raise exception 'APPOINTMENT_ALREADY_EXISTS'; end if;

    return query
    insert into public.clinic_records(
      clinic_id,branch_id,module,record_key,payload,revision,created_by,updated_by
    ) values (
      p_clinic_id,p_branch_id,'appointments',p_record_key,p_payload,1,v_user_id,v_user_id
    )
    returning *;
  else
    update public.clinic_records
    set payload = p_payload, revision = revision + 1,
        updated_by = v_user_id, updated_at = now()
    where clinic_id = p_clinic_id and branch_id = p_branch_id
      and module = 'appointments' and record_key = p_record_key
      and revision = p_expected_revision and deleted_at is null
    returning * into v_existing;
    if not found then raise exception 'APPOINTMENT_REVISION_CONFLICT'; end if;
    return next v_existing;
  end if;
end;
$$;

revoke all on function public.save_clinic_appointment_record(uuid,uuid,text,jsonb,bigint) from public, anon;
grant execute on function public.save_clinic_appointment_record(uuid,uuid,text,jsonb,bigint) to authenticated;

commit;
