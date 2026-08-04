begin;

do $test$
declare
  test_owner_user constant uuid :=
    'a0000000-0000-4000-8000-000000000001';
  test_tenant_user constant uuid :=
    'a0000000-0000-4000-8000-000000000002';
  test_property_id constant uuid :=
    'b0000000-0000-4000-8000-000000000001';
  test_old_room constant uuid :=
    'c0000000-0000-4000-8000-000000000001';
  test_new_room constant uuid :=
    'c0000000-0000-4000-8000-000000000002';
  test_tenant_id constant uuid :=
    'd0000000-0000-4000-8000-000000000001';
  test_request_id constant uuid :=
    'e0000000-0000-4000-8000-000000000001';

  test_deposit constant uuid :=
    'f0000000-0000-4000-8000-000000000001';
  test_initial_rent constant uuid :=
    'f0000000-0000-4000-8000-000000000002';
  test_difference constant uuid :=
    'f0000000-0000-4000-8000-000000000003';
  test_one_rupee constant uuid :=
    'f0000000-0000-4000-8000-000000000004';
  test_advance constant uuid :=
    'f0000000-0000-4000-8000-000000000005';

  test_current_period date :=
    date_trunc('month', current_date)::date;
  test_next_period date :=
    (
      date_trunc('month', current_date)
      + interval '1 month'
    )::date;

  test_current_rent uuid;
  test_future_rent uuid;
begin
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
      test_owner_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'room-rent-owner@example.test',
      '',
      now(),
      jsonb_build_object(
        'provider',
        'email',
        'providers',
        jsonb_build_array('email')
      ),
      '{}'::jsonb,
      now(),
      now(),
      false,
      false
    ),
    (
      test_tenant_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'room-rent-tenant@example.test',
      '',
      now(),
      jsonb_build_object(
        'provider',
        'email',
        'providers',
        jsonb_build_array('email')
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
      test_owner_user,
      'room-rent-owner@example.test',
      'Room Rent Test Owner',
      'owner',
      true
    ),
    (
      test_tenant_user,
      'room-rent-tenant@example.test',
      'Room Rent Test Tenant',
      'tenant',
      true
    );

  perform set_config(
    'request.jwt.claim.sub',
    test_owner_user::text,
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
    test_property_id,
    test_owner_user,
    'Room Rent Test Property',
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
  values
    (
      test_old_room,
      test_property_id,
      'OLD-7500',
      'single',
      'boys',
      7500,
      1000,
      2,
      1,
      'occupied'
    ),
    (
      test_new_room,
      test_property_id,
      'NEW-14999',
      'single',
      'boys',
      14999,
      1000,
      2,
      0,
      'vacant'
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
    status
  )
  values (
    test_tenant_id,
    test_tenant_user,
    test_property_id,
    test_old_room,
    'Room Rent Test Tenant',
    'room-rent-tenant@example.test',
    '9000000001',
    current_date,
    7500,
    7500,
    0,
    'pending',
    'active'
  );

  insert into public.payment_history (
    id,
    tenant_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    test_deposit,
    test_tenant_id,
    2599,
    current_date,
    'security_deposit',
    'success'
  );

  if exists (
    select 1
    from public.payment_history
    where id = test_deposit
      and rent_id is not null
  ) then
    raise exception
      'Security deposit was incorrectly linked to rent';
  end if;

  if exists (
    select 1
    from public.rent_records test_rent
    where test_rent.tenant_id = test_tenant_id
  ) then
    raise exception
      'Security deposit incorrectly materialized rent cycles';
  end if;

  raise notice
    'ok - security deposit remains outside monthly rent';

  insert into public.payment_history (
    id,
    tenant_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    test_initial_rent,
    test_tenant_id,
    7500,
    current_date,
    'upi',
    'success'
  );

  select payment.rent_id
  into test_current_rent
  from public.payment_history payment
  where payment.id = test_initial_rent;

  if test_current_rent is null then
    raise exception
      'Initial rent payment remained unattached';
  end if;

  if not exists (
    select 1
    from public.rent_records test_rent
    where test_rent.id = test_current_rent
      and test_rent.tenant_id = test_tenant_id
      and test_rent.period_start = test_current_period
      and test_rent.amount = 7500
      and test_rent.status = 'paid'
      and public.rent_record_received_amount(test_rent.id) = 7500
  ) then
    raise exception
      'Initial rent cycle was not materialized and paid correctly';
  end if;

  raise notice
    'ok - initial rent materializes and attaches before cron';

  insert into public.room_change_requests (
    id,
    tenant_id,
    property_id,
    old_room_id,
    new_room_id,
    status
  )
  values (
    test_request_id,
    test_tenant_id,
    test_property_id,
    test_old_room,
    test_new_room,
    'pending'
  );

  perform public.move_tenant_room(
    test_tenant_id,
    test_new_room,
    test_old_room
  );

  if not exists (
    select 1
    from public.room_change_requests request
    where request.id = test_request_id
      and request.status = 'approved'
  ) then
    raise exception
      'Room-change request was not approved';
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where tenant.id = test_tenant_id
      and tenant.room_id = test_new_room
      and tenant.rent_amount = 14999
      and tenant.pending_amount = 7499
      and tenant.rent_status = 'pending'
  ) then
    raise exception
      'Tenant did not receive the destination-room rent state';
  end if;

  if not exists (
    select 1
    from public.rent_records test_rent
    where test_rent.id = test_current_rent
      and test_rent.amount = 14999
      and test_rent.status = 'unpaid'
      and public.rent_record_received_amount(test_rent.id) = 7500
  ) then
    raise exception
      'Current cycle did not change from 7500 to 14999';
  end if;

  select test_rent.id
  into test_future_rent
  from public.rent_records test_rent
  where test_rent.tenant_id = test_tenant_id
    and test_rent.period_start = test_next_period;

  if test_future_rent is null then
    raise exception
      'Future rent cycle was not materialized';
  end if;

  if not exists (
    select 1
    from public.rent_records test_rent
    where test_rent.id = test_future_rent
      and test_rent.amount = 14999
      and test_rent.status = 'unpaid'
  ) then
    raise exception
      'Future cycle does not use destination-room rent';
  end if;

  raise notice
    'ok - room approval enforces the final room rent';

  insert into public.payment_history (
    id,
    tenant_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    test_difference,
    test_tenant_id,
    7499,
    current_date,
    'upi',
    'success'
  );

  if not exists (
    select 1
    from public.payment_history payment
    where payment.id = test_difference
      and payment.rent_id = test_current_rent
  ) then
    raise exception
      'Room-rent difference attached to the wrong cycle';
  end if;

  if not exists (
    select 1
    from public.rent_records test_rent
    where test_rent.id = test_current_rent
      and test_rent.amount = 14999
      and test_rent.status = 'paid'
      and public.rent_record_received_amount(test_rent.id) = 14999
  ) then
    raise exception
      '7500 plus 7499 did not complete the current cycle';
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where tenant.id = test_tenant_id
      and tenant.pending_amount = 0
      and tenant.rent_status = 'paid'
  ) then
    raise exception
      'Tenant summary retained a false pending amount';
  end if;

  raise notice
    'ok - 7500 plus 7499 clears the 14999 cycle exactly';

  insert into public.payment_history (
    id,
    tenant_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values
    (
      test_one_rupee,
      test_tenant_id,
      1,
      current_date,
      'owner_collection',
      'success'
    ),
    (
      test_advance,
      test_tenant_id,
      14998,
      current_date,
      'upi',
      'success'
    );

  if not exists (
    select 1
    from public.payment_history payment
    where payment.id = test_one_rupee
      and payment.rent_id = test_future_rent
  ) then
    raise exception
      'One-rupee advance attached to the wrong cycle';
  end if;

  if not exists (
    select 1
    from public.payment_history payment
    where payment.id = test_advance
      and payment.rent_id = test_future_rent
  ) then
    raise exception
      'Remaining advance attached to the wrong cycle';
  end if;

  if not exists (
    select 1
    from public.rent_records test_rent
    where test_rent.id = test_future_rent
      and test_rent.amount = 14999
      and test_rent.status = 'paid'
      and public.rent_record_received_amount(test_rent.id) = 14999
  ) then
    raise exception
      'One rupee plus 14998 did not complete the future cycle';
  end if;

  raise notice
    'ok - existing test payments fund the next cycle exactly';

  raise notice
    'Room-change rent database integration test passed';
end;
$test$;

select
  test_rent.period_start,
  test_rent.amount,
  test_rent.status,
  public.rent_record_received_amount(test_rent.id)
    as received_amount
from public.rent_records test_rent
where test_rent.tenant_id =
  'd0000000-0000-4000-8000-000000000001'
order by test_rent.period_start;

rollback;
