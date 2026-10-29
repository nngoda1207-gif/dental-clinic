-- Dental Clinic OS: shared clinic identity, members, and branches.
-- This migration is additive: it does not modify or delete public.clinic_state.
-- It intentionally does NOT sync the app's full D JSON blob. The current app stores
-- all records together in one client-side object, so row-level role permissions
-- cannot safely be enforced by sharing that blob with every staff member.
--
-- Run only after reviewing this file. The app integration is a separate step.

create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','dentist','reception','accountant','readonly','invmgr','nurse')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table if not exists public.clinic_branches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  address text not null default '',
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table if not exists public.clinic_member_branches (
  clinic_id uuid not null,
  user_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id, branch_id),
  foreign key (clinic_id, user_id)
    references public.clinic_members(clinic_id, user_id) on delete cascade,
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete cascade
);

create index if not exists clinic_members_user_idx
  on public.clinic_members(user_id, active);
create index if not exists clinic_branches_clinic_idx
  on public.clinic_branches(clinic_id, active);
create index if not exists clinic_member_branches_user_idx
  on public.clinic_member_branches(clinic_id, user_id);

-- Security-definer helpers avoid recursive RLS checks on clinic_members.
create or replace function public.is_clinic_member(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members m
    where m.clinic_id = p_clinic_id
      and m.user_id = auth.uid()
      and m.active = true
  );
$$;

create or replace function public.has_clinic_role(p_clinic_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members m
    where m.clinic_id = p_clinic_id
      and m.user_id = auth.uid()
      and m.active = true
      and m.role = any(p_roles)
  );
$$;

create or replace function public.can_access_clinic_branch(p_clinic_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_clinic_role(p_clinic_id, array['owner'])
    or exists (
      select 1
      from public.clinic_member_branches mb
      join public.clinic_members m
        on m.clinic_id = mb.clinic_id and m.user_id = mb.user_id
      where mb.clinic_id = p_clinic_id
        and mb.branch_id = p_branch_id
        and mb.user_id = auth.uid()
        and m.active = true
    );
$$;

revoke all on function public.is_clinic_member(uuid) from public;
revoke all on function public.has_clinic_role(uuid, text[]) from public;
revoke all on function public.can_access_clinic_branch(uuid, uuid) from public;
grant execute on function public.is_clinic_member(uuid) to authenticated;
grant execute on function public.has_clinic_role(uuid, text[]) to authenticated;
grant execute on function public.can_access_clinic_branch(uuid, uuid) to authenticated;

-- A signed-in user creates their clinic and is made its first owner atomically.
create or replace function public.create_clinic_for_current_user(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_name is null or length(trim(p_name)) < 1 or length(trim(p_name)) > 160 then
    raise exception 'Clinic name must be between 1 and 160 characters';
  end if;

  if exists (
    select 1 from public.clinic_members m
    where m.user_id = v_user_id and m.active = true and m.role = 'owner'
  ) then
    raise exception 'This user already owns a clinic';
  end if;

  insert into public.clinics(name, created_by)
  values (trim(p_name), v_user_id)
  returning id into v_clinic_id;

  insert into public.clinic_members(clinic_id, user_id, role)
  values (v_clinic_id, v_user_id, 'owner');

  return v_clinic_id;
end;
$$;

revoke all on function public.create_clinic_for_current_user(text) from public;
grant execute on function public.create_clinic_for_current_user(text) to authenticated;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.clinic_branches enable row level security;
alter table public.clinic_member_branches enable row level security;

drop policy if exists clinics_read_member on public.clinics;
create policy clinics_read_member on public.clinics
for select to authenticated
using (public.is_clinic_member(id));

drop policy if exists clinic_members_read_self_or_owner on public.clinic_members;
create policy clinic_members_read_self_or_owner on public.clinic_members
for select to authenticated
using (user_id = auth.uid() or public.has_clinic_role(clinic_id, array['owner']));

drop policy if exists clinic_members_insert_owner on public.clinic_members;
create policy clinic_members_insert_owner on public.clinic_members
for insert to authenticated
with check (
  public.has_clinic_role(clinic_id, array['owner'])
  and user_id <> auth.uid()
  and role <> 'owner'
);

drop policy if exists clinic_members_update_owner on public.clinic_members;
create policy clinic_members_update_owner on public.clinic_members
for update to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and user_id <> auth.uid())
with check (public.has_clinic_role(clinic_id, array['owner']) and role <> 'owner');

drop policy if exists clinic_members_delete_owner on public.clinic_members;
create policy clinic_members_delete_owner on public.clinic_members
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']) and user_id <> auth.uid());

drop policy if exists clinic_branches_read_member on public.clinic_branches;
create policy clinic_branches_read_member on public.clinic_branches
for select to authenticated
using (
  public.has_clinic_role(clinic_id, array['owner'])
  or public.can_access_clinic_branch(clinic_id, id)
);

drop policy if exists clinic_branches_insert_owner_manager on public.clinic_branches;
create policy clinic_branches_insert_owner on public.clinic_branches
for insert to authenticated
with check (public.has_clinic_role(clinic_id, array['owner']));

drop policy if exists clinic_branches_update_owner_manager on public.clinic_branches;
create policy clinic_branches_update_owner on public.clinic_branches
for update to authenticated
using (public.has_clinic_role(clinic_id, array['owner']))
with check (public.has_clinic_role(clinic_id, array['owner']));

drop policy if exists clinic_branches_delete_owner on public.clinic_branches;
create policy clinic_branches_delete_owner on public.clinic_branches
for delete to authenticated
using (public.has_clinic_role(clinic_id, array['owner']));

drop policy if exists clinic_member_branches_read_self_or_owner on public.clinic_member_branches;
create policy clinic_member_branches_read_self_or_owner on public.clinic_member_branches
for select to authenticated
using (user_id = auth.uid() or public.has_clinic_role(clinic_id, array['owner']));

drop policy if exists clinic_member_branches_manage_owner on public.clinic_member_branches;
create policy clinic_member_branches_manage_owner on public.clinic_member_branches
for all to authenticated
using (public.has_clinic_role(clinic_id, array['owner']))
with check (public.has_clinic_role(clinic_id, array['owner']));

grant select on public.clinics to authenticated;
grant select, insert, update, delete on public.clinic_members to authenticated;
grant select, insert, update, delete on public.clinic_branches to authenticated;
grant select, insert, update, delete on public.clinic_member_branches to authenticated;
