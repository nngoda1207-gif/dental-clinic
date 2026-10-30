-- Stable local identities for clinical records and structured clinical details.
-- This migration does not import or overwrite patient clinical data.
alter table public.clinic_clinical_records add column if not exists source_local_id text;
alter table public.clinic_treatment_items add column if not exists source_local_id text;
alter table public.clinic_tooth_records add column if not exists source_local_id text;
alter table public.clinic_periodontal_measurements add column if not exists source_local_id text;
alter table public.clinic_prescription_items add column if not exists source_local_id text;
alter table public.clinic_consents add column if not exists source_local_id text;

create unique index if not exists clinic_clinical_records_local_identity_uidx
  on public.clinic_clinical_records(clinic_id,branch_id,source_local_id)
  where source_local_id is not null;
create unique index if not exists clinic_treatment_items_local_identity_uidx
  on public.clinic_treatment_items(clinic_id,branch_id,source_local_id)
  where source_local_id is not null;
create unique index if not exists clinic_tooth_records_local_identity_uidx
  on public.clinic_tooth_records(clinic_id,branch_id,source_local_id)
  where source_local_id is not null;
create unique index if not exists clinic_periodontal_measurements_local_identity_uidx
  on public.clinic_periodontal_measurements(clinic_id,branch_id,source_local_id)
  where source_local_id is not null;
create unique index if not exists clinic_prescription_items_local_identity_uidx
  on public.clinic_prescription_items(clinic_id,source_local_id)
  where source_local_id is not null;
create unique index if not exists clinic_consents_local_identity_uidx
  on public.clinic_consents(clinic_id,branch_id,source_local_id)
  where source_local_id is not null;

create or replace function public.touch_clinical_sync_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $clinical_sync_version$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$clinical_sync_version$;

drop trigger if exists clinic_clinical_records_touch_sync_version on public.clinic_clinical_records;
create trigger clinic_clinical_records_touch_sync_version
before update on public.clinic_clinical_records
for each row execute function public.touch_clinical_sync_updated_at();

drop trigger if exists clinic_medical_history_touch_sync_version on public.clinic_patient_medical_history;
create trigger clinic_medical_history_touch_sync_version
before update on public.clinic_patient_medical_history
for each row execute function public.touch_clinical_sync_updated_at();

alter table public.clinic_consents add column if not exists updated_at timestamptz not null default now();
drop trigger if exists clinic_consents_touch_sync_version on public.clinic_consents;
create trigger clinic_consents_touch_sync_version
before update on public.clinic_consents
for each row execute function public.touch_clinical_sync_updated_at();

-- Publish only clinical data tables needed by authorized client subscriptions.
do $clinical_realtime$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_clinical_records') then
      alter publication supabase_realtime add table public.clinic_clinical_records;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_patient_medical_history') then
      alter publication supabase_realtime add table public.clinic_patient_medical_history;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_tooth_records') then
      alter publication supabase_realtime add table public.clinic_tooth_records;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_periodontal_measurements') then
      alter publication supabase_realtime add table public.clinic_periodontal_measurements;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_prescription_items') then
      alter publication supabase_realtime add table public.clinic_prescription_items;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='clinic_consents') then
      alter publication supabase_realtime add table public.clinic_consents;
    end if;
  end if;
end
$clinical_realtime$;

comment on column public.clinic_clinical_records.source_local_id is 'Stable local record identity for safe cross-device reconciliation.';
comment on column public.clinic_tooth_records.source_local_id is 'Stable local odontogram event identity; rows remain historical observations.';
comment on column public.clinic_periodontal_measurements.source_local_id is 'Stable local periodontal measurement identity; measurements are append-only observations.';
