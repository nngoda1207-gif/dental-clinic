\set ON_ERROR_STOP on

do $$
begin
  if has_table_privilege('authenticated','public.clinic_invoice_items','INSERT')
     or has_table_privilege('authenticated','public.clinic_invoice_items','UPDATE')
     or has_table_privilege('authenticated','public.clinic_invoice_items','DELETE') then
    raise exception 'Invoice items must be immutable for authenticated clients';
  end if;
  if not has_function_privilege('authenticated','public.create_invoice_with_items(uuid,uuid,text,jsonb,numeric,text,timestamptz)','EXECUTE') then
    raise exception 'Authenticated role cannot create invoice with service lines';
  end if;
  if has_function_privilege('anon','public.create_invoice_with_items(uuid,uuid,text,jsonb,numeric,text,timestamptz)','EXECUTE') then
    raise exception 'Anonymous role must not create invoices';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);

do $$
declare
  v_invoice public.clinic_invoices%rowtype;
  v_count integer;
  v_line_total numeric(12,2);
begin
  v_invoice := public.create_invoice_with_items(
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'INV-LINES-001',
    '[{"service_id":"60000000-0000-0000-0000-000000000001","quantity":2,"discount":10}]'::jsonb,
    5,'synthetic line test',now()
  );
  if v_invoice.subtotal <> 200 or v_invoice.discount <> 15 or v_invoice.total <> 185 then
    raise exception 'Invoice totals incorrect: %, %, %',v_invoice.subtotal,v_invoice.discount,v_invoice.total;
  end if;
  select count(*),sum(line_total) into v_count,v_line_total
    from public.clinic_invoice_items where invoice_id=v_invoice.id;
  if v_count <> 1 or v_line_total <> 190 then
    raise exception 'Invoice item snapshot incorrect: count %, total %',v_count,v_line_total;
  end if;
  begin
    perform public.create_invoice_with_items(
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'INV-LINES-OVER',
      '[{"service_id":"60000000-0000-0000-0000-000000000001","quantity":1,"discount":101}]'::jsonb,
      0,'must fail',now()
    );
    raise exception 'Line discount above line value was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.create_invoice_with_items(
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'INV-LINES-EMPTY',
      '[]'::jsonb,0,'must fail',now()
    );
    raise exception 'Empty invoice was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

select 'INVOICE_ITEMS_TESTS_PASSED' as result;
