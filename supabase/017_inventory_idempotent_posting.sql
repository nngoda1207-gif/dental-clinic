-- Retry-safe inventory posting for local-first synchronization.
-- Item metadata has a stable local identity; quantities remain ledger-derived.
alter table public.clinic_inventory_items
  add column if not exists source_local_id text;

create unique index if not exists clinic_inventory_items_local_identity_uidx
  on public.clinic_inventory_items(clinic_id, branch_id, source_local_id)
  where source_local_id is not null;

create or replace function public.touch_inventory_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $inventory_item_version$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$inventory_item_version$;

drop trigger if exists clinic_inventory_items_touch_updated_at on public.clinic_inventory_items;
create trigger clinic_inventory_items_touch_updated_at
before update on public.clinic_inventory_items
for each row execute function public.touch_inventory_item_updated_at();

alter table public.clinic_inventory_movements
  add column if not exists source_local_id text;

create unique index if not exists clinic_inventory_movements_local_identity_uidx
  on public.clinic_inventory_movements(clinic_id, branch_id, item_id, source_local_id)
  where source_local_id is not null;

create or replace function public.post_inventory_movement_idempotent(
  p_item_id uuid,
  p_source_local_id text,
  p_movement_type text,
  p_quantity_delta numeric,
  p_unit_cost numeric,
  p_reference text,
  p_notes text
)
returns public.clinic_inventory_movements
language plpgsql
security definer
set search_path = ''
as $inventory_sync$
declare
  v_item public.clinic_inventory_items%rowtype;
  v_existing public.clinic_inventory_movements%rowtype;
  v_movement public.clinic_inventory_movements%rowtype;
  v_actor uuid := auth.uid();
  v_next_quantity numeric(12,3);
  v_reference text := coalesce(p_reference, '');
  v_notes text := coalesce(p_notes, '');
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_source_local_id is null or pg_catalog.btrim(p_source_local_id) = '' then
    raise exception 'A stable local movement ID is required' using errcode = '22023';
  end if;
  if p_movement_type not in ('purchase','use','adjustment','transfer_in','transfer_out','return') then
    raise exception 'Unsupported inventory movement type' using errcode = '22023';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Quantity delta must be non-zero' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Unit cost must be zero or greater' using errcode = '22023';
  end if;
  if p_movement_type in ('purchase','transfer_in','return') and p_quantity_delta < 0 then
    raise exception 'This movement type requires a positive quantity delta' using errcode = '22023';
  end if;
  if p_movement_type in ('use','transfer_out') and p_quantity_delta > 0 then
    raise exception 'This movement type requires a negative quantity delta' using errcode = '22023';
  end if;

  select * into v_item
    from public.clinic_inventory_items
   where id = p_item_id
   for update;
  if not found then
    raise exception 'Inventory item not found' using errcode = 'P0002';
  end if;

  if not (
    public.has_clinic_role(v_item.clinic_id, array['owner','manager','invmgr','dentist','nurse'])
    and public.can_access_clinic_branch(v_item.clinic_id, v_item.branch_id)
  ) then
    raise exception 'Not allowed to post inventory movement for this item' using errcode = '42501';
  end if;

  -- The item row lock serializes retries for the same stock item.
  select * into v_existing
    from public.clinic_inventory_movements
   where clinic_id = v_item.clinic_id
     and branch_id = v_item.branch_id
     and item_id = v_item.id
     and source_local_id = p_source_local_id;
  if found then
    if v_existing.movement_type <> p_movement_type
       or v_existing.quantity_delta <> p_quantity_delta
       or v_existing.unit_cost <> p_unit_cost
       or v_existing.reference <> v_reference
       or v_existing.notes <> v_notes then
      raise exception 'Local movement ID was already used with different movement data'
        using errcode = '23505';
    end if;
    return v_existing;
  end if;

  v_next_quantity := v_item.quantity + p_quantity_delta;
  if v_next_quantity < 0 then
    raise exception 'Insufficient stock: movement would make quantity negative' using errcode = '23514';
  end if;

  insert into public.clinic_inventory_movements(
    clinic_id, branch_id, item_id, movement_type, quantity_delta,
    unit_cost, reference, notes, source_local_id, created_by
  ) values (
    v_item.clinic_id, v_item.branch_id, v_item.id, p_movement_type,
    p_quantity_delta, p_unit_cost, v_reference, v_notes,
    p_source_local_id, v_actor
  ) returning * into v_movement;

  update public.clinic_inventory_items
     set quantity = v_next_quantity, updated_at = pg_catalog.clock_timestamp()
   where id = v_item.id;

  return v_movement;
end;
$inventory_sync$;

revoke all on function public.post_inventory_movement_idempotent(uuid,text,text,numeric,numeric,text,text) from public, anon;
grant execute on function public.post_inventory_movement_idempotent(uuid,text,text,numeric,numeric,text,text) to authenticated;

comment on function public.post_inventory_movement_idempotent(uuid,text,text,numeric,numeric,text,text)
is 'Retry-safe stock movement posting. Same local ID and same payload returns the original ledger row; changed payload is rejected.';
