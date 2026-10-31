\set ON_ERROR_STOP on

do $$
begin
  if not has_function_privilege('authenticated','public.create_invoice_from_treatment_items(uuid,uuid,text,uuid[],numeric,text,timestamptz)','EXECUTE') then
    raise exception 'Authenticated role cannot invoice completed treatment items';
  end if;
  if has_function_privilege('anon','public.create_invoice_from_treatment_items(uuid,uuid,text,uuid[],numeric,text,timestamptz)','EXECUTE') then
    raise exception 'Anonymous role must not invoice treatment items';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='clinic_invoice_items_one_bill_per_treatment_idx'
  ) then raise exception 'Unique one-invoice-per-treatment index missing'; end if;
end $$;

insert into public.clinic_services(id,clinic_id,name,category,unit,price,active) values
 ('62000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'Synthetic extraction','surgery','tooth',250,true);

insert into public.clinic_treatment_items(
 id,clinic_id,branch_id,patient_id,procedure_name,quantity,unit_price,discount,status,created_by,service_id
) values
 ('63000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Extraction 16',1,250,20,'done',
  '00000000-0000-0000-0000-000000000005',
  '62000000-0000-0000-0000-000000000002'),
 ('63000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Restoration 25',2,100,0,'planned',
  '00000000-0000-0000-0000-000000000005',
  '62000000-0000-0000-0000-000000000002');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);

do $$
declare
 v_invoice public.clinic_invoices%rowtype;
 v_items integer;
 v_total numeric(12,2);
begin
 v_invoice := public.create_invoice_from_treatment_items(
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'INV-TREAT-001',
  array['63000000-0000-0000-0000-000000000001'::uuid],
  5,'completed procedure invoice',now()
 );
 if v_invoice.subtotal<>250 or v_invoice.discount<>25 or v_invoice.total<>225 then
   raise exception 'Treatment invoice totals incorrect: %, %, %',v_invoice.subtotal,v_invoice.discount,v_invoice.total;
 end if;
 select count(*),sum(line_total) into v_items,v_total
 from public.clinic_invoice_items where invoice_id=v_invoice.id
   and treatment_item_id='63000000-0000-0000-0000-000000000001';
 if v_items<>1 or v_total<>230 then raise exception 'Treatment invoice line snapshot incorrect'; end if;

 begin
   perform public.create_invoice_from_treatment_items(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'INV-TREAT-DOUBLE',
    array['63000000-0000-0000-0000-000000000001'::uuid],
    0,'must fail',now()
   );
   raise exception 'Already invoiced treatment item was accepted';
 exception when unique_violation then null;
 end;

 begin
   perform public.create_invoice_from_treatment_items(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'INV-TREAT-PLANNED',
    array['63000000-0000-0000-0000-000000000002'::uuid],
    0,'must fail',now()
   );
   raise exception 'Planned treatment item was accepted';
 exception when check_violation then null;
 end;
end $$;
reset role;

select 'TREATMENT_INVOICE_TESTS_PASSED' as result;
