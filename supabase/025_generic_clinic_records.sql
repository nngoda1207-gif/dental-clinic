-- Generic module-scoped cloud records for the existing D application model.
-- Additive only: the legacy clinic_state table is intentionally untouched.
begin;

alter table public.clinic_members
  add column if not exists permissions jsonb not null default '[]'::jsonb;

create table if not exists public.clinic_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid,
  module text not null check (module in (
    'patients','appointments','finance','prices','inventory','labs',
    'reports','settings','branches','audit','suppliers','treatment'
  )),
  record_key text not null check (length(btrim(record_key)) between 1 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, branch_id)
    references public.clinic_branches(clinic_id, id) on delete cascade,
  unique (clinic_id, branch_id, module, record_key)
);

create index if not exists clinic_records_scope_idx
  on public.clinic_records(clinic_id, branch_id, module, updated_at desc);
create index if not exists clinic_records_live_idx
  on public.clinic_records(clinic_id, module, updated_at desc)
  where deleted_at is null;

create or replace function private.can_access_clinic_record(
  p_clinic_id uuid, p_branch_id uuid, p_module text, p_action text
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members m
    where m.clinic_id = p_clinic_id
      and m.user_id = (select auth.uid())
      and m.active = true
      and (
        m.role = 'owner'
        or (
          p_branch_id is not null
          and exists (
            select 1 from public.clinic_member_branches mb
            where mb.clinic_id = m.clinic_id
              and mb.user_id = m.user_id
              and mb.branch_id = p_branch_id
          )
          and case
            when p_module = 'patients' and p_action = 'read' then m.permissions ?| array['pv','pa','pe']
            when p_module = 'patients' and p_action = 'create' then m.permissions ? 'pa'
            when p_module = 'patients' and p_action in ('update','delete') then m.permissions ? 'pe'
            when p_module = 'appointments' then m.permissions ?| array['pi','pa','pe','aw']
            when p_module = 'finance' then m.permissions ?| array['ex','fv']
            when p_module = 'prices' then m.permissions ?| array['pr','pl']
            when p_module = 'inventory' then m.permissions ?| array['im','iv']
            when p_module = 'labs' then m.permissions ? 'lv'
            when p_module = 'reports' then m.permissions ? 'rp'
            when p_module = 'settings' then m.permissions ? 'st'
            when p_module = 'branches' then m.permissions ? 'br'
            when p_module = 'audit' then m.permissions ? 'au'
            when p_module = 'suppliers' then m.permissions ? 'im'
            when p_module = 'treatment' then m.permissions ?| array['cl','mv']
            else false
          end
        )
      )
  );
$$;

revoke all on function private.can_access_clinic_record(uuid,uuid,text,text) from public, anon;
grant execute on function private.can_access_clinic_record(uuid,uuid,text,text) to authenticated;

alter table public.clinic_records enable row level security;

drop policy if exists clinic_records_select on public.clinic_records;
create policy clinic_records_select on public.clinic_records
for select to authenticated
using (
  deleted_at is null
  and private.can_access_clinic_record(clinic_id, branch_id, module, 'read')
);

drop policy if exists clinic_records_insert on public.clinic_records;
create policy clinic_records_insert on public.clinic_records
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and private.can_access_clinic_record(clinic_id, branch_id, module, 'create')
);

drop policy if exists clinic_records_update on public.clinic_records;
create policy clinic_records_update on public.clinic_records
for update to authenticated
using (private.can_access_clinic_record(clinic_id, branch_id, module, 'update'))
with check (
  updated_by = (select auth.uid())
  and private.can_access_clinic_record(clinic_id, branch_id, module, 'update')
);

drop policy if exists clinic_records_delete on public.clinic_records;
create policy clinic_records_delete on public.clinic_records
for delete to authenticated
using (private.can_access_clinic_record(clinic_id, branch_id, module, 'delete'));

grant select, insert, update, delete on public.clinic_records to authenticated;

commit;
