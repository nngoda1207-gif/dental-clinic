-- Dental Clinic OS: close direct stock-balance writes and prevent overlapping dentist bookings.
-- Additive migration; validate on disposable PostgreSQL/Supabase before production.

-- Quantity is a derived operational balance. Authenticated clients may edit item
-- metadata, but must use post_inventory_movement() to change quantity atomically.
revoke update on table public.clinic_inventory_items from authenticated;
grant update (
  supplier_id, sku, name, unit, min_quantity, unit_cost, active, updated_at
) on table public.clinic_inventory_items to authenticated;

-- Serialize appointment writes per clinic, then reject time overlaps for the same
-- dentist. A missing end time is treated as a 30-minute appointment for legacy rows.
create or replace function public.prevent_dentist_appointment_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_end timestamptz;
  v_conflict uuid;
begin
  if new.status not in ('scheduled','confirmed','arrived')
     or new.dentist_user_id is null then
    return new;
  end if;

  v_end := coalesce(new.ends_at, new.starts_at + interval '30 minutes');
  if v_end <= new.starts_at then
    raise exception 'Appointment end must be after its start'
      using errcode = '23514';
  end if;

  -- Clinic-wide lock avoids races between simultaneous inserts/updates.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.clinic_id::text, 0)
  );

  select a.id into v_conflict
    from public.clinic_appointments a
   where a.clinic_id = new.clinic_id
     and a.dentist_user_id = new.dentist_user_id
     and a.id <> new.id
     and a.status in ('scheduled','confirmed','arrived')
     and a.starts_at < v_end
     and coalesce(a.ends_at, a.starts_at + interval '30 minutes') > new.starts_at
   limit 1;

  if v_conflict is not null then
    raise exception 'Dentist already has an overlapping appointment'
      using errcode = '23P01',
            detail = 'Conflicting appointment id: ' || v_conflict::text;
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_appointments_dentist_overlap on public.clinic_appointments;
create trigger clinic_appointments_dentist_overlap
before insert or update of clinic_id, dentist_user_id, starts_at, ends_at, status
on public.clinic_appointments
for each row execute function public.prevent_dentist_appointment_overlap();

comment on function public.prevent_dentist_appointment_overlap()
is 'Serializes appointment writes per clinic and prevents overlapping active appointments for one dentist.';
