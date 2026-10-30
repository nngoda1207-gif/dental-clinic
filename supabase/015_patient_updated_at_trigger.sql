-- Ensure every patient row update advances its optimistic-concurrency version.
create or replace function public.touch_clinic_patient_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

drop trigger if exists clinic_patients_touch_updated_at on public.clinic_patients;
create trigger clinic_patients_touch_updated_at
before update on public.clinic_patients
for each row execute function public.touch_clinic_patient_updated_at();
