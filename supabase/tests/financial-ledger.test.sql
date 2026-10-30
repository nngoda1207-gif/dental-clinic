-- Synthetic financial ledger tests. Run after smoke.sql and migration 010.
\set ON_ERROR_STOP on

do $$
begin
  if has_table_privilege('authenticated','public.clinic_invoice_payments','INSERT') then
    raise exception 'Financial test failed: authenticated can directly insert payment ledger rows';
  end if;
  if has_function_privilege('anon','public.post_invoice_payment(uuid,numeric,text,text,text,timestamptz)','EXECUTE') then
    raise exception 'Financial test failed: anon can post payments';
  end if;
  if not has_function_privilege('authenticated','public.post_invoice_payment(uuid,numeric,text,text,text,timestamptz)','EXECUTE') then
    raise exception 'Financial test failed: authenticated cannot post payments';
  end if;
  if not has_function_privilege('authenticated','public.refund_invoice_payment(uuid,numeric,text,text,timestamptz)','EXECUTE') then
    raise exception 'Financial test failed: authenticated cannot refund payments';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);

do $$
declare
  v_payment public.clinic_invoice_payments%rowtype;
  v_refund public.clinic_invoice_payments%rowtype;
  v_status text;
  v_total numeric(12,2);
begin
  begin
    perform public.post_invoice_payment(
      '40000000-0000-0000-0000-000000000001',51,'cash','OVERPAY','must fail',now()
    );
    raise exception 'Financial test failed: overpayment was accepted';
  exception when check_violation then null;
  end;

  v_payment := public.post_invoice_payment(
    '40000000-0000-0000-0000-000000000001',50,'card','PAY-50','synthetic payment',now()
  );
  if v_payment.entry_type <> 'payment' or v_payment.created_by <> auth.uid() then
    raise exception 'Financial test failed: payment actor/type incorrect';
  end if;
  select status into v_status from public.clinic_invoices
   where id='40000000-0000-0000-0000-000000000001';
  if v_status <> 'paid' then
    raise exception 'Financial test failed: fully paid invoice status should be paid, got %',v_status;
  end if;

  v_refund := public.refund_invoice_payment(
    '50000000-0000-0000-0000-000000000001',20,'REF-20','partial refund',now()
  );
  if v_refund.entry_type <> 'refund' or v_refund.original_payment_id <> '50000000-0000-0000-0000-000000000001' then
    raise exception 'Financial test failed: refund is not linked to its original payment';
  end if;
  begin
    perform public.refund_invoice_payment(
      '50000000-0000-0000-0000-000000000001',31,'REF-31','excess refund',now()
    );
    raise exception 'Financial test failed: refund exceeding original payment was accepted';
  exception when check_violation then null;
  end;
  perform public.refund_invoice_payment(
    '50000000-0000-0000-0000-000000000001',30,'REF-30','remaining refund',now()
  );
  perform public.refund_invoice_payment(
    v_payment.id,50,'REF-NEW-50','refund second payment',now()
  );

  select status into v_status from public.clinic_invoices
   where id='40000000-0000-0000-0000-000000000001';
  if v_status <> 'refunded' then
    raise exception 'Financial test failed: zero-net invoice status should be refunded, got %',v_status;
  end if;

  select sum(case when entry_type='refund' then -amount else amount end)
    into v_total from public.clinic_invoice_payments
   where invoice_id='40000000-0000-0000-0000-000000000001';
  if v_total <> 0 then
    raise exception 'Financial test failed: expected net payment zero, got %',v_total;
  end if;
end $$;
reset role;

-- Ledger rows remain immutable, including refund rows.
do $$
begin
  begin
    update public.clinic_invoice_payments set notes='rewrite'
     where reference='REF-20';
    raise exception 'Financial test failed: refund edit accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.clinic_invoice_payments where reference='REF-20';
    raise exception 'Financial test failed: refund deletion accepted';
  exception when sqlstate '55000' then null;
  end;
end $$;

select 'FINANCIAL_LEDGER_TESTS_PASSED' as result;
