begin;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'vacate-owner@example.test',
    '',
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email')
    ),
    '{}'::jsonb,
    now(),
    now(),
    false,
    false
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'vacate-tenant@example.test',
    '',
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email')
    ),
    '{}'::jsonb,
    now(),
    now(),
    false,
    false
  );

insert into public.users (
  id,
  email,
  full_name,
  role,
  is_active
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'vacate-owner@example.test',
    'Vacate Test Owner',
    'owner',
    true
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'vacate-tenant@example.test',
    'Vacate Test Tenant',
    'tenant',
    true
  );

insert into public.properties (
  id,
  owner_id,
  name,
  address,
  city
)
values (
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Vacate Test Property',
  'Test Address',
  'Hyderabad'
);

insert into public.rooms (
  id,
  property_id,
  room_number,
  sharing_type,
  room_audience,
  monthly_rent,
  deposit_amount,
  capacity,
  current_occupants,
  status
)
values (
  'c1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'VACATE-ROOM',
  'single',
  'boys',
  14999,
  1000,
  2,
  1,
  'occupied'
);

insert into public.tenants (
  id,
  user_id,
  property_id,
  room_id,
  name,
  email,
  phone,
  move_in_date,
  rent_amount,
  pending_amount,
  total_paid,
  rent_status,
  status,
  check_out_requested,
  notice_period_start,
  notice_period_end
)
values (
  'd1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Vacate Test Tenant',
  'vacate-tenant@example.test',
  '9000000011',
  current_date - 60,
  14999,
  0,
  14999,
  'paid',
  'notice_period',
  true,
  current_date,
  current_date + 30
);

insert into public.check_out_requests (
  id,
  tenant_id,
  property_id,
  room_id,
  tenant_name,
  room_number,
  expected_check_out,
  reason,
  status,
  processed_at
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Vacate Test Tenant',
  'VACATE-ROOM',
  current_date + 30,
  'Testing approved cancellation',
  'approved',
  now()
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000002',
  true
);

set local role authenticated;

do $test$
declare
  cancellation_result jsonb;
begin
  select public.cancel_vacate_request(
    'e1000000-0000-4000-8000-000000000001'
  )
  into cancellation_result;

  if cancellation_result ->> 'success' is distinct from 'true' then
    raise exception
      'Approved vacate cancellation did not report success';
  end if;
end;
$test$;

reset role;

do $test$
begin
  if not exists (
    select 1
    from public.check_out_requests request
    where request.id =
      'e1000000-0000-4000-8000-000000000001'
      and request.status = 'cancelled'
  ) then
    raise exception
      'Approved vacate request was not cancelled';
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where tenant.id =
      'd1000000-0000-4000-8000-000000000001'
      and tenant.status = 'active'
      and tenant.check_out_requested = false
      and tenant.notice_period_start is null
      and tenant.notice_period_end is null
      and tenant.rent_status = 'paid'
      and tenant.pending_amount = 0
  ) then
    raise exception
      'Tenant lifecycle state was not restored after cancellation';
  end if;

  raise notice
    'ok - paid tenant can cancel an approved vacate request';
end;
$test$;

set local role authenticated;

do $test$
begin
  begin
    update public.tenants
    set rent_amount = 1
    where id =
      'd1000000-0000-4000-8000-000000000001';

    raise exception
      'Direct tenant managed-field update was not blocked';
  exception
    when sqlstate '42501' then
      raise notice
        'ok - direct tenant managed-field changes remain blocked';
  end;
end;
$test$;

reset role;

do $test$
begin
  begin
    update public.tenants
    set rent_amount = 1
    where id =
      'd1000000-0000-4000-8000-000000000001';

    raise exception
      'Unmarked privileged managed-field update was not blocked';
  exception
    when sqlstate '42501' then
      raise notice
        'ok - unmarked privileged managed-field changes remain blocked';
  end;
end;
$test$;

select set_config(
  'request.jwt.claim.sub',
  '',
  true
);

update public.tenants
set status = 'notice_period',
    check_out_requested = true,
    notice_period_start = current_date,
    notice_period_end = current_date + 30
where id =
  'd1000000-0000-4000-8000-000000000001';

insert into public.check_out_requests (
  id,
  tenant_id,
  property_id,
  room_id,
  tenant_name,
  room_number,
  expected_check_out,
  reason,
  status,
  processed_at
)
values (
  'e1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Vacate Test Tenant',
  'VACATE-ROOM',
  current_date + 30,
  'Testing reserved cancellation protection',
  'approved',
  now()
);

insert into public.pre_bookings (
  id,
  property_id,
  room_id,
  name,
  phone,
  email,
  expected_move_in_date,
  status,
  payment_status,
  pre_booking_fee_amount,
  reserved_at,
  reserved_by
)
values (
  'f1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Reserved Applicant',
  '9000000012',
  'reserved-applicant@example.test',
  current_date + 31,
  'reserved',
  'pending',
  1000,
  now(),
  'a1000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000002',
  true
);

set local role authenticated;

do $test$
begin
  begin
    perform public.cancel_vacate_request(
      'e1000000-0000-4000-8000-000000000002'
    );

    raise exception
      'Reserved-room vacate cancellation was not blocked';
  exception
    when others then
      if sqlerrm not like '%already been reserved%' then
        raise exception
          'Unexpected reserved cancellation error: %',
          sqlerrm;
      end if;

      raise notice
        'ok - reserved-room vacate cancellation remains blocked';
  end;
end;
$test$;

reset role;

do $test$
begin
  if not exists (
    select 1
    from public.check_out_requests request
    where request.id =
      'e1000000-0000-4000-8000-000000000002'
      and request.status = 'approved'
  ) then
    raise exception
      'Blocked vacate request did not remain approved';
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where tenant.id =
      'd1000000-0000-4000-8000-000000000001'
      and tenant.status = 'notice_period'
      and tenant.check_out_requested = true
  ) then
    raise exception
      'Blocked cancellation incorrectly changed tenant state';
  end if;

  raise notice
    'Approved vacate cancellation database test passed';
end;
$test$;

rollback;
