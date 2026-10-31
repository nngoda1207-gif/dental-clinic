-- Keep SECURITY DEFINER RLS helpers outside exposed API schemas.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_clinic_member(p_clinic_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.clinic_members m where m.clinic_id=p_clinic_id and m.user_id=auth.uid() and m.active=true); $$;
create or replace function private.has_clinic_role(p_clinic_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.clinic_members m where m.clinic_id=p_clinic_id and m.user_id=auth.uid() and m.active=true and m.role=any(p_roles)); $$;
create or replace function private.can_access_clinic_branch(p_clinic_id uuid,p_branch_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_clinic_role(p_clinic_id,array['owner']) or exists(select 1 from public.clinic_member_branches mb join public.clinic_members m on m.clinic_id=mb.clinic_id and m.user_id=mb.user_id where mb.clinic_id=p_clinic_id and mb.branch_id=p_branch_id and mb.user_id=auth.uid() and m.active=true); $$;
revoke all on function private.is_clinic_member(uuid) from public,anon;
revoke all on function private.has_clinic_role(uuid,text[]) from public,anon;
revoke all on function private.can_access_clinic_branch(uuid,uuid) from public,anon;
grant execute on function private.is_clinic_member(uuid) to authenticated;
grant execute on function private.has_clinic_role(uuid,text[]) to authenticated;
grant execute on function private.can_access_clinic_branch(uuid,uuid) to authenticated;
drop policy if exists clinics_read_member on public.clinics;
create policy clinics_read_member on public.clinics for select to authenticated using(private.is_clinic_member(id));
drop policy if exists clinic_members_read_self_or_owner on public.clinic_members;
create policy clinic_members_read_self_or_owner on public.clinic_members for select to authenticated using(user_id=auth.uid() or private.has_clinic_role(clinic_id,array['owner']));
drop policy if exists clinic_members_insert_owner on public.clinic_members;
create policy clinic_members_insert_owner on public.clinic_members for insert to authenticated with check(private.has_clinic_role(clinic_id,array['owner']) and user_id<>auth.uid() and role<>'owner');
drop policy if exists clinic_members_update_owner on public.clinic_members;
create policy clinic_members_update_owner on public.clinic_members for update to authenticated using(private.has_clinic_role(clinic_id,array['owner']) and user_id<>auth.uid()) with check(private.has_clinic_role(clinic_id,array['owner']) and role<>'owner');
drop policy if exists clinic_members_delete_owner on public.clinic_members;
create policy clinic_members_delete_owner on public.clinic_members for delete to authenticated using(private.has_clinic_role(clinic_id,array['owner']) and user_id<>auth.uid());
drop policy if exists clinic_branches_read_member on public.clinic_branches;
create policy clinic_branches_read_member on public.clinic_branches for select to authenticated using(private.has_clinic_role(clinic_id,array['owner']) or private.can_access_clinic_branch(clinic_id,id));
drop policy if exists clinic_branches_insert_owner on public.clinic_branches;
create policy clinic_branches_insert_owner on public.clinic_branches for insert to authenticated with check(private.has_clinic_role(clinic_id,array['owner']));
drop policy if exists clinic_branches_update_owner on public.clinic_branches;
create policy clinic_branches_update_owner on public.clinic_branches for update to authenticated using(private.has_clinic_role(clinic_id,array['owner'])) with check(private.has_clinic_role(clinic_id,array['owner']));
drop policy if exists clinic_branches_delete_owner on public.clinic_branches;
create policy clinic_branches_delete_owner on public.clinic_branches for delete to authenticated using(private.has_clinic_role(clinic_id,array['owner']));
drop policy if exists clinic_member_branches_read_self_or_owner on public.clinic_member_branches;
create policy clinic_member_branches_read_self_or_owner on public.clinic_member_branches for select to authenticated using(user_id=auth.uid() or private.has_clinic_role(clinic_id,array['owner']));
drop policy if exists clinic_member_branches_manage_owner on public.clinic_member_branches;
create policy clinic_member_branches_manage_owner on public.clinic_member_branches for all to authenticated using(private.has_clinic_role(clinic_id,array['owner'])) with check(private.has_clinic_role(clinic_id,array['owner']));
drop function if exists public.is_clinic_member(uuid);
drop function if exists public.has_clinic_role(uuid,text[]);
drop function if exists public.can_access_clinic_branch(uuid,uuid);
