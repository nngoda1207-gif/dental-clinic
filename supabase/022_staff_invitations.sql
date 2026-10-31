-- Owner-issued, single-use staff invitations. Tokens are hashed at rest.
begin;

alter table public.clinic_members
  add column if not exists permissions jsonb not null default '[]'::jsonb;

create table if not exists public.clinic_invitations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  email text not null check (email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('manager','dentist','reception','accountant','readonly','invmgr','nurse')),
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete cascade
);

create index if not exists clinic_invitations_owner_idx
  on public.clinic_invitations(clinic_id, created_at desc);
create index if not exists clinic_invitations_pending_idx
  on public.clinic_invitations(clinic_id, email, expires_at)
  where redeemed_at is null;

alter table public.clinic_invitations enable row level security;
revoke all on public.clinic_invitations from public, anon, authenticated;

create or replace function private.default_clinic_permissions(p_role text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'manager' then '["pv","pa","pe","pr","ex","au","br","aw"]'::jsonb
    when 'dentist' then '["pv","pa","pe","aw"]'::jsonb
    when 'nurse' then '["pv","pa","pe"]'::jsonb
    when 'reception' then '["pv","pa","pe","aw"]'::jsonb
    when 'accountant' then '["pv","ex"]'::jsonb
    when 'readonly' then '["pv"]'::jsonb
    when 'invmgr' then '["pv","im","iv"]'::jsonb
    else '[]'::jsonb
  end;
$$;
revoke all on function private.default_clinic_permissions(text) from public, anon, authenticated;

create or replace function public.create_clinic_invitation(
  p_email text, p_role text, p_branch_id uuid, p_expires_hours integer default 72
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_clinic_id uuid;
  v_owner_count integer;
  v_email text := lower(trim(coalesce(p_email,'')));
  v_role text := trim(coalesce(p_role,''));
  v_token text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_INVITE_EMAIL'; end if;
  if v_role not in ('manager','dentist','reception','accountant','readonly','invmgr','nurse') then raise exception 'INVALID_INVITE_ROLE'; end if;
  if p_expires_hours is null or p_expires_hours < 1 or p_expires_hours > 168 then raise exception 'INVALID_EXPIRY'; end if;

  select count(*) into v_owner_count
  from public.clinic_members m
  where m.user_id = v_user_id and m.active = true and m.role = 'owner';
  if v_owner_count <> 1 then raise exception 'OWNER_REQUIRED'; end if;
  select m.clinic_id into v_clinic_id
  from public.clinic_members m
  where m.user_id = v_user_id and m.active = true and m.role = 'owner'
  limit 1;

  if not exists (
    select 1 from public.clinic_branches b
    where b.id = p_branch_id and b.clinic_id = v_clinic_id and b.active = true
  ) then raise exception 'BRANCH_NOT_AVAILABLE'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.clinic_invitations(
    clinic_id, branch_id, email, role, token_hash, expires_at, created_by
  ) values (
    v_clinic_id, p_branch_id, v_email, v_role,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    now() + make_interval(hours => p_expires_hours), v_user_id
  );
  return v_token;
end;
$$;

create or replace function public.redeem_clinic_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := lower(trim(coalesce((select auth.jwt())->>'email','')));
  v_hash text;
  v_invitation public.clinic_invitations%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(trim(p_token),'') = '' then raise exception 'INVITE_INVALID_OR_EXPIRED'; end if;
  if v_email = '' then raise exception 'INVITE_EMAIL_REQUIRED'; end if;

  v_hash := encode(extensions.digest(convert_to(trim(p_token), 'UTF8'), 'sha256'), 'hex');
  select * into v_invitation
  from public.clinic_invitations
  where token_hash = v_hash
  for update;

  if not found or v_invitation.redeemed_at is not null or v_invitation.expires_at <= now() then
    raise exception 'INVITE_INVALID_OR_EXPIRED';
  end if;
  if v_invitation.email <> v_email then raise exception 'INVITE_EMAIL_MISMATCH'; end if;
  if exists (
    select 1 from public.clinic_members m
    where m.clinic_id = v_invitation.clinic_id and m.user_id = v_user_id
  ) then raise exception 'ALREADY_CLINIC_MEMBER'; end if;

  insert into public.clinic_members(clinic_id,user_id,role,active,permissions)
  values (
    v_invitation.clinic_id, v_user_id, v_invitation.role, true,
    private.default_clinic_permissions(v_invitation.role)
  );
  insert into public.clinic_member_branches(clinic_id,user_id,branch_id)
  values (v_invitation.clinic_id,v_user_id,v_invitation.branch_id);

  update public.clinic_invitations
  set redeemed_at = now(), redeemed_by = v_user_id
  where id = v_invitation.id;
end;
$$;

revoke all on function public.create_clinic_invitation(text,text,uuid,integer) from public, anon;
revoke all on function public.redeem_clinic_invitation(text) from public, anon;
grant execute on function public.create_clinic_invitation(text,text,uuid,integer) to authenticated;
grant execute on function public.redeem_clinic_invitation(text) to authenticated;

commit;
