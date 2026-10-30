-- Synthetic-only retry safety tests for inventory movement posting.
\set ON_ERROR_STOP on
begin;

insert into public.clinic_inventory_items(
  id,clinic_id,branch_id,sku,name,quantity,min_quantity,unit_cost,created_by
) values (
  '83000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'SYNC-ITEM-1','Synthetic sync item',0,0,10,
  '00000000-0000-0000-0000-000000000001'
);

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);

do $inventory_test$
declare first_id uuid; retry_id uuid; n integer; qty numeric;
begin
  select id into first_id from public.post_inventory_movement_idempotent(
    '83000000-0000-0000-0000-000000000001','local-movement-001',
    'purchase',5,10,'initial stock','sync test'
  );
  select id into retry_id from public.post_inventory_movement_idempotent(
    '83000000-0000-0000-0000-000000000001','local-movement-001',
    'purchase',5,10,'initial stock','sync test'
  );
  if first_id <> retry_id then
    raise exception 'Idempotent retry returned a different movement row';
  end if;
  select count(*) into n from public.clinic_inventory_movements
   where item_id='83000000-0000-0000-0000-000000000001'
     and source_local_id='local-movement-001';
  select quantity into qty from public.clinic_inventory_items
   where id='83000000-0000-0000-0000-000000000001';
  if n <> 1 or qty <> 5 then
    raise exception 'Retry duplicated stock movement or quantity change (count %, quantity %)',n,qty;
  end if;

  begin
    perform public.post_inventory_movement_idempotent(
      '83000000-0000-0000-0000-000000000001','local-movement-001',
      'purchase',6,10,'initial stock','sync test'
    );
    raise exception 'Reusing local movement ID with changed payload was accepted';
  exception when unique_violation then null;
  end;

  select quantity into qty from public.clinic_inventory_items
   where id='83000000-0000-0000-0000-000000000001';
  if qty <> 5 then
    raise exception 'Rejected payload changed stock quantity';
  end if;
end
$inventory_test$;

reset role;
rollback;
