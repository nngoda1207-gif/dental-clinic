\set ON_ERROR_STOP on
begin;
insert into public.clinic_invoices(
 id,clinic_id,branch_id,patient_id,invoice_no,status,currency,subtotal,discount,total,created_by
) values (
 '84000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001',
 'SYNC-IDEMPOTENT-001','open','EGP',100,0,100,
 '00000000-0000-0000-0000-000000000005'
);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $financial_sync_test$
declare p1 public.clinic_invoice_payments%rowtype;p2 public.clinic_invoice_payments%rowtype;
 r1 public.clinic_invoice_payments%rowtype;r2 public.clinic_invoice_payments%rowtype;
 n integer;net numeric;status_value text;
begin
 p1:=public.post_invoice_payment_idempotent('84000000-0000-0000-0000-000000000001','local-payment-001',30,'cash','REF-30','offline retry','2032-01-01T10:00:00Z');
 p2:=public.post_invoice_payment_idempotent('84000000-0000-0000-0000-000000000001','local-payment-001',30,'cash','REF-30','offline retry','2032-01-01T10:00:00Z');
 if p1.id<>p2.id then raise exception 'Payment retry created a second ledger row';end if;
 select count(*) into n from public.clinic_invoice_payments where source_local_id='local-payment-001';
 if n<>1 then raise exception 'Expected exactly one payment ledger row, got %',n;end if;
 begin
  perform public.post_invoice_payment_idempotent('84000000-0000-0000-0000-000000000001','local-payment-001',31,'cash','REF-30','offline retry','2032-01-01T10:00:00Z');
  raise exception 'Changed payment payload was accepted';
 exception when unique_violation then null;end;
 r1:=public.refund_invoice_payment_idempotent(p1.id,'local-refund-001',10,'REFUND-10','refund retry','2032-01-02T10:00:00Z');
 r2:=public.refund_invoice_payment_idempotent(p1.id,'local-refund-001',10,'REFUND-10','refund retry','2032-01-02T10:00:00Z');
 if r1.id<>r2.id then raise exception 'Refund retry created a second ledger row';end if;
 begin
  perform public.refund_invoice_payment_idempotent(p1.id,'local-refund-001',11,'REFUND-10','refund retry','2032-01-02T10:00:00Z');
  raise exception 'Changed refund payload was accepted';
 exception when unique_violation then null;end;
 select count(*) into n from public.clinic_invoice_payments where invoice_id='84000000-0000-0000-0000-000000000001';
 select sum(case when entry_type='refund' then -amount else amount end) into net
 from public.clinic_invoice_payments where invoice_id='84000000-0000-0000-0000-000000000001';
 select status into status_value from public.clinic_invoices where id='84000000-0000-0000-0000-000000000001';
 if n<>2 or net<>20 or status_value<>'open' then
  raise exception 'Unexpected ledger after retries: rows %, net %, status %',n,net,status_value;
 end if;
end
$financial_sync_test$;
reset role;
rollback;
