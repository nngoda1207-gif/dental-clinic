do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.clinic_patients'::regclass
      and tgname = 'clinic_patients_touch_updated_at'
      and not tgisinternal
  ) then
    raise exception 'clinic patient updated_at trigger is missing';
  end if;
end
$$;
