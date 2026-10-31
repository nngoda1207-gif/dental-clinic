-- Private username map. The app never asks for or displays email addresses.
create table if not exists public.clinic_usernames (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique,
 created_at timestamptz not null default now(),
 constraint clinic_usernames_format check (username=lower(username) and username ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
);
alter table public.clinic_usernames enable row level security;
revoke all on public.clinic_usernames from anon,authenticated,public;
grant all on public.clinic_usernames to service_role;
comment on table public.clinic_usernames is 'Private username-to-auth mapping; service-role Edge Function only.';
