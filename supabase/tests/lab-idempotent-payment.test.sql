\set ON_ERROR_STOP on
begin;
insert into public.clinic_lab_cases(
 id,clinic_id,branch_id,patient_id,lab_name,case_type,status,cost,created_by
) values (
 '85000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001',
 'Synthetic Lab','Crown','sent',100,
 '00000000-0000-0000-0000-000000000001'
);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $lab_sync_test$
declare a public.clinic_lab_payments%rowtype;b public.clinic_lab_payments%rowtype;n integer;
begin
 a:=public.post_lab_case_payment_idempotent('85000000-0000-0000-0000-000000000001','local-lab-payment-001',25,'cash','LAB-25','offline retry','2032-02-01T10:00:00Z');
 b:=public.post_lab_case_payment_idempotent('85000000-0000-0000-0000-000000000001','local-lab-payment-001',25,'cash','LAB-25','offline retry','2032-02-01T10:00:00Z');
 if a.id<>b.id then raise exception 'Lab payment retry created a duplicate row';end if;
 select count(*) into n from public.clinic_lab_payments where source_local_id='local-lab-payment-001';
 if n<>1 then raise exception 'Expected one lab payment row, got %',n;end if;
 begin
  perform public.post_lab_case_payment_idempotent('85000000-0000-0000-0000-000000000001','local-lab-payment-001',26,'cash','LAB-25','offline retry','2032-02-01T10:00:00Z');
  raise exception 'Changed lab payment payload was accepted';
 exception when unique_violation then null;end;
end
$lab_sync_test$;
reset role;
rollback;
