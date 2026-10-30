-- Dental Clinic OS: per-owner cloud backup/sync
-- Run this in Supabase SQL Editor. The anon/publishable key is safe to use in the browser
-- only together with these RLS policies. NEVER put the service_role key in the app.

create table if not exists public.clinic_cloud_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.clinic_cloud_data enable row level security;

drop policy if exists "Owners can read their clinic data" on public.clinic_cloud_data;
create policy "Owners can read their clinic data"
  on public.clinic_cloud_data for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Owners can insert their clinic data" on public.clinic_cloud_data;
create policy "Owners can insert their clinic data"
  on public.clinic_cloud_data for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Owners can update their clinic data" on public.clinic_cloud_data;
create policy "Owners can update their clinic data"
  on public.clinic_cloud_data for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.clinic_cloud_data to authenticated;
