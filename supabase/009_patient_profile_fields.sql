-- Add fields present in the current patient form without changing existing rows.
-- Safe additive migration; apply only in a reviewed/test project first.
alter table public.clinic_patients
  add column if not exists english_name text not null default '',
  add column if not exists governorate text not null default '',
  add column if not exists source text not null default '',
  add column if not exists assigned_dentist_user_id uuid references auth.users(id) on delete set null,
  add column if not exists tags text[] not null default '{}';

alter table public.clinic_patients
  drop constraint if exists clinic_patients_english_name_length,
  drop constraint if exists clinic_patients_governorate_length,
  drop constraint if exists clinic_patients_source_length;

alter table public.clinic_patients
  add constraint clinic_patients_english_name_length
    check (length(english_name) <= 200) not valid,
  add constraint clinic_patients_governorate_length
    check (length(governorate) <= 120) not valid,
  add constraint clinic_patients_source_length
    check (length(source) <= 120) not valid;

alter table public.clinic_patients
  validate constraint clinic_patients_english_name_length;
alter table public.clinic_patients
  validate constraint clinic_patients_governorate_length;
alter table public.clinic_patients
  validate constraint clinic_patients_source_length;
