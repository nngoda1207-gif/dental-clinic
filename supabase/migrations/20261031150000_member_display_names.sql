alter table public.clinic_members
  add column if not exists display_name text not null default '';
