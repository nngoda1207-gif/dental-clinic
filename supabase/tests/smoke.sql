-- Synthetic-only schema/RLS/trigger smoke tests.
\set ON_ERROR_STOP on

insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000005'),
 ('00000000-0000-0000-0000-000000000006')
on conflict do nothing;

insert into public.clinics(id,name,created_by) values
 ('10000000-0000-0000-0000-000000000001','Test Clinic','00000000-0000-0000-0000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','dentist'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','readonly'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','reception'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','accountant'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','manager');
insert into public.clinic_branches(id,clinic_id,name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Branch A'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Branch B');
insert into public.clinic_member_branches(clinic_id,user_id,branch_id) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001');
insert into public.clinic_patients(id,clinic_id,branch_id,file_no,full_name,created_by) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A-001','Synthetic Patient A','00000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','B-001','Synthetic Patient B','00000000-0000-0000-0000-000000000001');
insert into public.clinic_inventory_items(id,clinic_id,branch_id,sku,name,quantity,created_by)
values ('80000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'SYN-ITEM-1','Synthetic inventory item',0,
        '00000000-0000-0000-0000-000000000001');

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

-- Immutable ledger rejects both edits and deletions of payment history.
do $$
begin
  begin
    update public.clinic_invoice_payments set amount=75 where id='50000000-0000-0000-0000-000000000001';
    raise exception 'Integrity test failed: invoice payment edit accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.clinic_invoice_payments where id='50000000-0000-0000-0000-000000000001';
    raise exception 'Integrity test failed: invoice payment deletion accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from public.clinic_invoice_payments where id='50000000-0000-0000-0000-000000000001') then
    raise exception 'Integrity test failed: payment row disappeared after rejected mutation';
  end if;
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

-- Active appointments for the same dentist must not overlap.
insert into public.clinic_appointments(
  id, clinic_id, branch_id, patient_id, dentist_user_id, starts_at, ends_at, created_by
) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '2030-01-10 10:00:00+00', '2030-01-10 10:30:00+00',
  '00000000-0000-0000-0000-000000000001'
);
do $smoke$
begin
  begin
    insert into public.clinic_appointments(
      id, clinic_id, branch_id, patient_id, dentist_user_id, starts_at, ends_at, created_by
    ) values (
      '70000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '2030-01-10 10:15:00+00', '2030-01-10 10:45:00+00',
      '00000000-0000-0000-0000-000000000001'
    );
    raise exception 'Appointment test failed: overlapping dentist booking accepted';
  exception when sqlstate '23P01' then null;
  end;
  if exists (
    select 1 from public.clinic_appointments
    where id='70000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'Appointment test failed: conflicting appointment persisted';
  end if;
end
$smoke$;

-- A dentist cannot bypass overlap prevention with a conflict hidden by branch RLS.
insert into public.clinic_appointments(
  id, clinic_id, branch_id, patient_id, dentist_user_id, starts_at, ends_at, created_by
) values (
  '70000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  '2030-01-10 11:00:00+00', '2030-01-10 11:30:00+00',
  '00000000-0000-0000-0000-000000000001'
);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $smoke$
begin
  begin
    insert into public.clinic_appointments(
      id, clinic_id, branch_id, patient_id, dentist_user_id, starts_at, ends_at, created_by
    ) values (
      '70000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '2030-01-10 11:15:00+00', '2030-01-10 11:45:00+00',
      '00000000-0000-0000-0000-000000000002'
    );
    raise exception 'Appointment RLS test failed: hidden cross-branch conflict was accepted';
  exception when sqlstate '23P01' then null;
  end;
  if exists (
    select 1 from public.clinic_appointments
    where id='70000000-0000-0000-0000-000000000004'
  ) then
    raise exception 'Appointment RLS test failed: hidden conflicting appointment persisted';
  end if;
end
$smoke$;
reset role;

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

-- Lab payment ledger rejects edits and deletions.
insert into public.clinic_lab_payments(id,clinic_id,branch_id,lab_case_id,amount,created_by)
values ('61000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001',25,
        '00000000-0000-0000-0000-000000000001');
do $smoke$
begin
  begin
    update public.clinic_lab_payments set amount=30 where id='61000000-0000-0000-0000-000000000001';
    raise exception 'Integrity test failed: lab payment edit accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.clinic_lab_payments where id='61000000-0000-0000-0000-000000000001';
    raise exception 'Integrity test failed: lab payment deletion accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from public.clinic_lab_payments where id='61000000-0000-0000-0000-000000000001') then
    raise exception 'Integrity test failed: lab payment disappeared after rejected mutation';
  end if;
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
    raise exception 'Integrity test failed: audit event update accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.clinic_audit_events where action='test' and entity_type='synthetic';
    raise exception 'Integrity test failed: audit event deletion accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from public.clinic_audit_events where action='test' and entity_type='synthetic') then
    raise exception 'Integrity test failed: audit event disappeared after rejected mutation';
  end if;
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


-- Manager is restricted to assigned branches and cannot move rows into an unassigned branch.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
do $smoke$
declare n integer; affected integer := 0; stock numeric;
begin
  -- Atomic stock posting updates both the balance and immutable movement ledger.
  perform public.post_inventory_movement(
    '80000000-0000-0000-0000-000000000001','purchase',10,2.50,'TEST-IN','synthetic purchase'
  );
  perform public.post_inventory_movement(
    '80000000-0000-0000-0000-000000000001','use',-3,2.50,'TEST-USE','synthetic use'
  );
  select quantity into stock from public.clinic_inventory_items
   where id='80000000-0000-0000-0000-000000000001';
  if stock <> 7 then
    raise exception 'Inventory test failed: expected stock 7 after +10 and -3, got %', stock;
  end if;

  begin
    perform public.post_inventory_movement(
      '80000000-0000-0000-0000-000000000001','use',-20,2.50,'TEST-OVERDRAW','must fail'
    );
    raise exception 'Inventory test failed: overdraw was accepted';
  exception when check_violation then null;
  end;
  select quantity into stock from public.clinic_inventory_items
   where id='80000000-0000-0000-0000-000000000001';
  if stock <> 7 then
    raise exception 'Inventory test failed: rejected overdraw changed stock, got %', stock;
  end if;

  begin
    update public.clinic_inventory_movements set notes='rewritten'
     where reference='TEST-IN';
    raise exception 'Inventory test failed: movement update accepted';
  exception when sqlstate '55000' then null;
  end;
  affected := 0;
  begin
    delete from public.clinic_inventory_movements where reference='TEST-IN';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'Inventory test failed: movement deletion removed % ledger row(s)', affected;
    end if;
  exception when sqlstate '55000' then
    affected := 0;
  end;
  select count(*) into n from public.clinic_inventory_movements where reference='TEST-IN';
  if n <> 1 then
    raise exception 'Inventory test failed: original movement was not preserved after delete attempt';
  end if;

  -- Direct stock quantity edits must be denied; use the atomic posting RPC.
  begin
    update public.clinic_inventory_items set quantity=99
     where id='80000000-0000-0000-0000-000000000001';
    raise exception 'Inventory test failed: direct quantity update was accepted';
  exception when insufficient_privilege then null;
  end;
  select quantity into stock from public.clinic_inventory_items
   where id='80000000-0000-0000-0000-000000000001';
  if stock <> 7 then
    raise exception 'Inventory test failed: direct update changed quantity to %', stock;
  end if;

  select count(*) into n from public.clinic_patients;
  if n <> 1 then raise exception 'RLS test failed: manager expected only assigned-branch patient, got %', n; end if;
  begin
    update public.clinic_patients
       set branch_id='20000000-0000-0000-0000-000000000002'
     where id='30000000-0000-0000-0000-000000000001';
    get diagnostics affected = row_count;
  exception when insufficient_privilege then
    affected := 0;
  end;
  if affected <> 0 then
    raise exception 'RLS test failed: manager moved patient into unassigned branch';
  end if;
end
$smoke$;
reset role;

-- Owner of Clinic A cannot enumerate or read another clinic.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $smoke$
declare n integer;
begin
  select count(*) into n from public.clinics;
  if n <> 1 then raise exception 'RLS test failed: clinic owner can see another clinic'; end if;
  select count(*) into n from public.clinic_patients where clinic_id='10000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'RLS test failed: clinic owner can see other-clinic patients'; end if;
end
$smoke$;
reset role;

-- Reception cannot read medical history or prescription details.
insert into public.clinic_patient_medical_history(clinic_id,branch_id,patient_id,updated_by)
values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into public.clinic_prescription_items(clinic_id,clinical_record_id,medication_name)
values ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','Synthetic medication');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $smoke$
declare n integer;
begin
  select count(*) into n from public.clinic_patient_medical_history;
  if n <> 0 then raise exception 'RLS test failed: reception can read medical history'; end if;
  select count(*) into n from public.clinic_prescription_items;
  if n <> 0 then raise exception 'RLS test failed: reception can read prescription items'; end if;
end
$smoke$;
reset role;

select 'SCHEMA_SMOKE_TESTS_PASSED' as result;
