-- 022: owner-issued, single-use staff invitations.
-- Staff create their own Supabase Auth identity, then redeem a one-time code
-- issued by the clinic owner. No service-role key is exposed to the app.

create table if not exists public.clinic_invitations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null,
  email text not null check (email = lower(trim(email)) and length(email) between 5 and 254),
  role text not null check (role in ('manager','dentist','reception','accountant','readonly','invmgr','nurse')),
  token_hash bytea not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete cascade,
  check (expires_at > created_at),
  check ((redeemed_by is null) = (redeemed_at is null))
);

create index if not exists clinic_invitations_pending_idx
  on public.clinic_invitations(clinic_id, email, expires_at)
  where redeemed_at is null;

alter table public.clinic_invitations enable row level security;
revoke all on public.clinic_invitations from public, anon, authenticated;

create or replace function public.create_clinic_invitation(
  p_email text,
  p_role text,
  p_branch_id uuid,
  p_expires_hours integer default 72
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(v_email) > 254 then
    raise exception 'INVALID_INVITE_EMAIL';
  end if;
  if p_role not in ('manager','dentist','reception','accountant','readonly','invmgr','nurse') then
    raise exception 'INVALID_INVITE_ROLE';
  end if;
  if p_expires_hours is null or p_expires_hours < 1 or p_expires_hours > 168 then
    raise exception 'INVALID_INVITE_EXPIRY';
  end if;

  select m.clinic_id into v_clinic_id
  from public.clinic_members m
  where m.user_id = v_user_id and m.active = true and m.role = 'owner'
  limit 1;
  if v_clinic_id is null then raise exception 'OWNER_REQUIRED'; end if;

  if not exists (
    select 1 from public.clinic_branches b
    where b.id = p_branch_id and b.clinic_id = v_clinic_id and b.active = true
  ) then raise exception 'BRANCH_NOT_AVAILABLE'; end if;

  if exists (
    select 1 from public.clinic_members m
    where m.clinic_id = v_clinic_id and m.active = true
      and lower(coalesce((select u.email from auth.users u where u.id=m.user_id),'')) = v_email
  ) then raise exception 'USER_ALREADY_MEMBER'; end if;

  insert into public.clinic_invitations(
    clinic_id, branch_id, email, role, token_hash, created_by, expires_at
  ) values (
    v_clinic_id, p_branch_id, v_email, p_role,
    extensions.digest(v_token, 'sha256'), v_user_id,
    now() + make_interval(hours => p_expires_hours)
  );

  return v_token;
end;
$$;

create or replace function public.redeem_clinic_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_inv public.clinic_invitations%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(coalesce(p_token,'')) <> 64 or p_token !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'INVALID_INVITATION_CODE';
  end if;
  if v_email = '' then raise exception 'AUTH_EMAIL_MISSING'; end if;

  select * into v_inv
  from public.clinic_invitations i
  where i.token_hash = extensions.digest(lower(p_token), 'sha256')
  for update;

  if not found then raise exception 'INVALID_INVITATION_CODE'; end if;
  if v_inv.redeemed_at is not null then raise exception 'INVITATION_ALREADY_USED'; end if;
  if v_inv.expires_at <= now() then raise exception 'INVITATION_EXPIRED'; end if;
  if v_inv.email <> v_email then raise exception 'INVITATION_EMAIL_MISMATCH'; end if;
  if exists (
    select 1 from public.clinic_members m
    where m.clinic_id = v_inv.clinic_id and m.user_id = v_user_id
  ) then raise exception 'ALREADY_A_CLINIC_MEMBER'; end if;

  insert into public.clinic_members(clinic_id, user_id, role, active)
  values (v_inv.clinic_id, v_user_id, v_inv.role, true);

  insert into public.clinic_member_branches(clinic_id, user_id, branch_id)
  values (v_inv.clinic_id, v_user_id, v_inv.branch_id);

  update public.clinic_invitations
  set redeemed_by = v_user_id, redeemed_at = now()
  where id = v_inv.id;

  return jsonb_build_object('clinic_id', v_inv.clinic_id, 'branch_id', v_inv.branch_id, 'role', v_inv.role);
end;
$$;

revoke all on function public.create_clinic_invitation(text,text,uuid,integer) from public, anon;
revoke all on function public.redeem_clinic_invitation(text) from public, anon;
grant execute on function public.create_clinic_invitation(text,text,uuid,integer) to authenticated;
grant execute on function public.redeem_clinic_invitation(text) to authenticated;
