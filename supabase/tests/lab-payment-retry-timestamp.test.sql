\set ON_ERROR_STOP on
begin;
insert into public.clinic_lab_cases(
 id,clinic_id,branch_id,patient_id,lab_name,case_type,status,cost,created_by
) values (
 '85000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001',
 'Synthetic Lab Retry','Crown','sent',100,
 '00000000-0000-0000-0000-000000000001'
);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $lab_retry_timestamp_test$
declare a public.clinic_lab_payments%rowtype;b public.clinic_lab_payments%rowtype;n integer;
begin
 a:=public.post_lab_case_payment_idempotent('85000000-0000-0000-0000-000000000002','local-lab-payment-no-date',12,'cash','', 'retry without timestamp');
 perform pg_catalog.pg_sleep(0.02);
 b:=public.post_lab_case_payment_idempotent('85000000-0000-0000-0000-000000000002','local-lab-payment-no-date',12,'cash','', 'retry without timestamp');
 if a.id<>b.id or a.paid_at<>b.paid_at then raise exception 'Retry without explicit paid_at must return the original payment';end if;
 select count(*) into n from public.clinic_lab_payments where source_local_id='local-lab-payment-no-date';
 if n<>1 then raise exception 'Expected one row after timestamp-less retry, got %',n;end if;
end
$lab_retry_timestamp_test$;
reset role;
rollback;
