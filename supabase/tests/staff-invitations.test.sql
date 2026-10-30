-- Synthetic single-use staff invitation tests. Run after migrations 001-022.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','owner@clinic.test'),
 ('10000000-0000-4000-8000-000000000002','nurse@clinic.test'),
 ('10000000-0000-4000-8000-000000000003','intruder@clinic.test')
on conflict (id) do update set email=excluded.email;

insert into public.clinics(id,name,created_by)
values ('20000000-0000-4000-8000-000000000001','Invitation Test Clinic','10000000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner');
insert into public.clinic_branches(id,clinic_id,name)
values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Main Branch');

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","email":"owner@clinic.test"}',false);
create temporary table invite_test_token(token text);
insert into invite_test_token
select public.create_clinic_invitation('nurse@clinic.test','nurse','30000000-0000-4000-8000-000000000001',72);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","email":"nurse@clinic.test"}',false);
select public.redeem_clinic_invitation(token) from invite_test_token;
reset role;

do $$
begin
  if not exists (
    select 1 from public.clinic_members
    where clinic_id='20000000-0000-4000-8000-000000000001'
      and user_id='10000000-0000-4000-8000-000000000002'
      and role='nurse' and active
  ) then raise exception 'Invitation did not create the expected nurse membership'; end if;
  if not exists (
    select 1 from public.clinic_member_branches
    where clinic_id='20000000-0000-4000-8000-000000000001'
      and user_id='10000000-0000-4000-8000-000000000002'
      and branch_id='30000000-0000-4000-8000-000000000001'
  ) then raise exception 'Invitation did not assign the invited branch'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","email":"nurse@clinic.test"}',false);
do $$
declare v_token text;
begin
  select token into v_token from invite_test_token;
  begin
    perform public.redeem_clinic_invitation(v_token);
    raise exception 'A redeemed invitation was accepted twice';
  exception when others then
    if sqlerrm = 'A redeemed invitation was accepted twice' then raise; end if;
  end;
end;
$$;
reset role;

select 'staff invitation tests passed' as result;
