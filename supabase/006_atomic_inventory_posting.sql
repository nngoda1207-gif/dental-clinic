-- Dental Clinic OS: atomic inventory posting.
-- Additive only; do not apply to the live Supabase project before review.
-- All stock changes must pass through post_inventory_movement so the balance and
-- immutable movement ledger commit or roll back together.

create or replace function public.post_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_unit_cost numeric default 0,
  p_reference text default '',
  p_notes text default ''
)
returns public.clinic_inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.clinic_inventory_items%rowtype;
  v_movement public.clinic_inventory_movements%rowtype;
  v_actor uuid := auth.uid();
  v_next_quantity numeric(12,3);
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
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

  v_next_quantity := v_item.quantity + p_quantity_delta;
  if v_next_quantity < 0 then
    raise exception 'Insufficient stock: movement would make quantity negative' using errcode = '23514';
  end if;

  insert into public.clinic_inventory_movements(
    clinic_id, branch_id, item_id, movement_type, quantity_delta,
    unit_cost, reference, notes, created_by
  ) values (
    v_item.clinic_id, v_item.branch_id, v_item.id, p_movement_type,
    p_quantity_delta, p_unit_cost, coalesce(p_reference, ''),
    coalesce(p_notes, ''), v_actor
  ) returning * into v_movement;

  update public.clinic_inventory_items
     set quantity = v_next_quantity, updated_at = now()
   where id = v_item.id;

  return v_movement;
end;
$$;

revoke all on function public.post_inventory_movement(uuid,text,numeric,numeric,text,text) from public, anon;
grant execute on function public.post_inventory_movement(uuid,text,numeric,numeric,text,text) to authenticated;

comment on function public.post_inventory_movement(uuid,text,numeric,numeric,text,text)
is 'Atomically posts a stock movement and updates item quantity; never edit/delete ledger rows.';
