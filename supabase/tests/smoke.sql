-- Synthetic-only schema/RLS/trigger smoke tests.
\set ON_ERROR_STOP on

insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000005')
on conflict do nothing;

insert into public.clinics(id,name,created_by) values
 ('10000000-0000-0000-0000-000000000001','Test Clinic','00000000-0000-0000-0000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','dentist'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','readonly'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','reception'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','accountant');
insert into public.clinic_branches(id,clinic_id,name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Branch A'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Branch B');
insert into public.clinic_member_branches(clinic_id,user_id,branch_id) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001');
insert into public.clinic_patients(id,clinic_id,branch_id,file_no,full_name,created_by) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A-001','Synthetic Patient A','00000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','B-001','Synthetic Patient B','00000000-0000-0000-0000-000000000001');
insert into public.clinic_invoices(id,clinic_id,branch_id,patient_id,invoice_no,subtotal,total,created_by) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','INV-A-1',100,100,'00000000-0000-0000-0000-000000000001');
insert into public.clinic_invoice_payments(id,clinic_id,branch_id,invoice_id,amount,created_by) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',50,'00000000-0000-0000-0000-000000000001');

-- Dentist sees assigned branch only; read-only user can read but cannot write.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$
declare n integer;
begin
  select count(*) into n from public.clinic_patients;
  if n <> 1 then raise exception 'RLS test failed: dentist expected 1 assigned-branch patient, got %', n; end if;
  select count(*) into n from public.clinic_patients where branch_id='20000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'RLS test failed: dentist can see unassigned branch'; end if;
  begin
    insert into public.clinic_patients(clinic_id,branch_id,file_no,full_name,created_by)
    values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','BAD-1','Should fail','00000000-0000-0000-0000-000000000002');
    raise exception 'RLS test failed: dentist inserted into unassigned branch';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$
begin
  begin
    insert into public.clinic_patients(clinic_id,branch_id,file_no,full_name,created_by)
    values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','RO-1','Should fail','00000000-0000-0000-0000-000000000003');
    raise exception 'RLS test failed: readonly user inserted patient';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Branch guard rejects a mismatched clinical record (executed as DB owner).
do $$
begin
  begin
    insert into public.clinic_clinical_records(clinic_id,branch_id,patient_id,created_by)
    values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
    raise exception 'Integrity test failed: mismatched clinical record branch accepted';
  exception when check_violation then null;
  end;
end
$$;

-- Immutable ledger rejects payment edits/deletions.
do $$
begin
  begin
    update public.clinic_invoice_payments set amount=75 where id='50000000-0000-0000-0000-000000000001';
    raise exception 'Integrity test failed: invoice payment edit accepted';
  exception when sqlstate '55000' then null;
  end;
end
$$;

-- Appointment end must be after start.
do $$
begin
  begin
    insert into public.clinic_appointments(clinic_id,branch_id,patient_id,starts_at,ends_at,created_by)
    values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now(),now(),'00000000-0000-0000-0000-000000000001');
    raise exception 'Integrity test failed: zero-duration appointment accepted';
  exception when check_violation then null;
  end;
end
$$;

-- Inactive membership must revoke branch-scoped reads immediately.
update public.clinic_members
   set active = false
 where clinic_id='10000000-0000-0000-0000-000000000001'
   and user_id='00000000-0000-0000-0000-000000000003';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $smoke$
declare n integer;
begin
  select count(*) into n from public.clinic_patients;
  if n <> 0 then raise exception 'RLS test failed: inactive member still sees patients'; end if;
end
$smoke$;
reset role;
update public.clinic_members
   set active = true
 where clinic_id='10000000-0000-0000-0000-000000000001'
   and user_id='00000000-0000-0000-0000-000000000003';

-- Lab payments cannot claim a different branch from their parent lab case.
insert into public.clinic_lab_cases(id,clinic_id,branch_id,patient_id,lab_name,created_by)
values ('60000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        'Synthetic Lab','00000000-0000-0000-0000-000000000001');
do $smoke$
begin
  begin
    insert into public.clinic_lab_payments(clinic_id,branch_id,lab_case_id,amount,created_by)
    values ('10000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000002',
            '60000000-0000-0000-0000-000000000001',10,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'Integrity test failed: mismatched lab payment branch accepted';
  exception when check_violation then null;
  end;
end
$smoke$;

-- Audit history is append-only.
insert into public.clinic_audit_events(clinic_id,branch_id,actor_user_id,action,entity_type)
values ('10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001','test','synthetic');
do $smoke$
begin
  begin
    update public.clinic_audit_events set action='rewritten' where action='test' and entity_type='synthetic';
    raise exception 'Integrity test failed: audit event mutation accepted';
  exception when sqlstate '55000' then null;
  end;
end
$smoke$;


-- Additional role-boundary and cross-clinic isolation tests; synthetic data only.
insert into public.clinic_clinical_records(
  id,clinic_id,branch_id,patient_id,record_type,diagnosis,created_by
) values (
 '70000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001',
 'visit','Synthetic diagnosis','00000000-0000-0000-0000-000000000001'
);

insert into public.clinics(id,name,created_by) values
 ('10000000-0000-0000-0000-000000000002','Other Synthetic Clinic','00000000-0000-0000-0000-000000000001');
insert into public.clinic_branches(id,clinic_id,name) values
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other Clinic Branch');
insert into public.clinic_patients(id,clinic_id,branch_id,file_no,full_name,created_by) values
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','X-001','Other Clinic Synthetic Patient','00000000-0000-0000-0000-000000000001');

-- Reception must not read clinical notes and must not write financial invoices.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $smoke$
declare n integer;
begin
  select count(*) into n from public.clinic_clinical_records;
  if n <> 0 then raise exception 'RLS test failed: reception can read clinical records'; end if;
  begin
    insert into public.clinic_invoices(clinic_id,branch_id,patient_id,invoice_no,total,created_by)
    values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','REC-BLOCKED',1,'00000000-0000-0000-0000-000000000004');
    raise exception 'RLS test failed: reception created invoice';
  exception when insufficient_privilege then null;
  end;
end
$smoke$;

-- Accountant can see financial records but must not read clinical notes.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $smoke$
declare n integer;
begin
  select count(*) into n from public.clinic_invoices;
  if n <> 1 then raise exception 'RLS test failed: accountant expected one assigned-branch invoice, got %', n; end if;
  select count(*) into n from public.clinic_clinical_records;
  if n <> 0 then raise exception 'RLS test failed: accountant can read clinical records'; end if;
end
$smoke$;
reset role;

-- A row in Clinic A must not reference a patient belonging to Clinic B.
do $smoke$
begin
  begin
    insert into public.clinic_invoices(clinic_id,branch_id,patient_id,invoice_no,total,created_by)
    values ('10000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000003',
            'CROSS-CLINIC-BLOCKED',1,
            '00000000-0000-0000-0000-000000000001');
    raise exception 'Integrity test failed: cross-clinic patient reference accepted';
  exception when foreign_key_violation or check_violation then null;
  end;
end
$smoke$;

-- A member cannot grant themselves a new role or create their own membership.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $smoke$
begin
  begin
    insert into public.clinic_members(clinic_id,user_id,role)
    values ('10000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002','manager');
    raise exception 'RLS test failed: member self-promoted/inserted membership';
  exception when insufficient_privilege then null;
  end;
end
$smoke$;
reset role;

select 'SCHEMA_SMOKE_TESTS_PASSED' as result;
