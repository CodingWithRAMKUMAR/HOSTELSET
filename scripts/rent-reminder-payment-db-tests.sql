begin;

do $test$
declare
  test_owner_user constant uuid :=
    'aa000000-0000-4000-8000-000000000001';
  test_property_id constant uuid :=
    'bb000000-0000-4000-8000-000000000001';
  test_room_id constant uuid :=
    'cc000000-0000-4000-8000-000000000001';

  tenant_auto constant uuid :=
    'dd000000-0000-4000-8000-000000000001';
  tenant_stale constant uuid :=
    'dd000000-0000-4000-8000-000000000002';
  tenant_exact constant uuid :=
    'dd000000-0000-4000-8000-000000000003';
  tenant_partial constant uuid :=
    'dd000000-0000-4000-8000-000000000004';
  tenant_deposit constant uuid :=
    'dd000000-0000-4000-8000-000000000005';
  tenant_pending constant uuid :=
    'dd000000-0000-4000-8000-000000000006';
  tenant_update constant uuid :=
    'dd000000-0000-4000-8000-000000000007';
  tenant_fee constant uuid :=
    'dd000000-0000-4000-8000-000000000008';

  rent_auto constant uuid :=
    'ee000000-0000-4000-8000-000000000001';
  rent_stale constant uuid :=
    'ee000000-0000-4000-8000-000000000002';
  rent_exact constant uuid :=
    'ee000000-0000-4000-8000-000000000003';
  rent_later constant uuid :=
    'ee000000-0000-4000-8000-000000000004';
  rent_partial constant uuid :=
    'ee000000-0000-4000-8000-000000000005';
  rent_deposit constant uuid :=
    'ee000000-0000-4000-8000-000000000006';
  rent_pending constant uuid :=
    'ee000000-0000-4000-8000-000000000007';
  rent_update constant uuid :=
    'ee000000-0000-4000-8000-000000000008';
  rent_fee constant uuid :=
    'ee000000-0000-4000-8000-000000000009';

  current_period date := date_trunc('month', current_date)::date;
  current_period_end date :=
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  test_reference timestamptz := '2026-07-15 09:30:00+05:30';
  claimed_count integer;
  scheduled_count integer;
  wrong_rent_rejected boolean := false;
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
  select
    user_row.id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    user_row.email,
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
  from (
    values
      (test_owner_user, 'rent-reminder-owner@example.test'),
      ('aa000000-0000-4000-8000-000000000101'::uuid, 'rent-reminder-tenant-1@example.test'),
      ('aa000000-0000-4000-8000-000000000102'::uuid, 'rent-reminder-tenant-2@example.test'),
      ('aa000000-0000-4000-8000-000000000103'::uuid, 'rent-reminder-tenant-3@example.test'),
      ('aa000000-0000-4000-8000-000000000104'::uuid, 'rent-reminder-tenant-4@example.test'),
      ('aa000000-0000-4000-8000-000000000105'::uuid, 'rent-reminder-tenant-5@example.test'),
      ('aa000000-0000-4000-8000-000000000106'::uuid, 'rent-reminder-tenant-6@example.test'),
      ('aa000000-0000-4000-8000-000000000107'::uuid, 'rent-reminder-tenant-7@example.test'),
      ('aa000000-0000-4000-8000-000000000108'::uuid, 'rent-reminder-tenant-8@example.test')
  ) as user_row(id, email);

  insert into public.users (
    id,
    email,
    full_name,
    role,
    is_active
  )
  select
    user_row.id,
    user_row.email,
    user_row.full_name,
    user_row.role,
    true
  from (
    values
      (test_owner_user, 'rent-reminder-owner@example.test', 'Rent Reminder Owner', 'owner'),
      ('aa000000-0000-4000-8000-000000000101'::uuid, 'rent-reminder-tenant-1@example.test', 'Rent Reminder Tenant 1', 'tenant'),
      ('aa000000-0000-4000-8000-000000000102'::uuid, 'rent-reminder-tenant-2@example.test', 'Rent Reminder Tenant 2', 'tenant'),
      ('aa000000-0000-4000-8000-000000000103'::uuid, 'rent-reminder-tenant-3@example.test', 'Rent Reminder Tenant 3', 'tenant'),
      ('aa000000-0000-4000-8000-000000000104'::uuid, 'rent-reminder-tenant-4@example.test', 'Rent Reminder Tenant 4', 'tenant'),
      ('aa000000-0000-4000-8000-000000000105'::uuid, 'rent-reminder-tenant-5@example.test', 'Rent Reminder Tenant 5', 'tenant'),
      ('aa000000-0000-4000-8000-000000000106'::uuid, 'rent-reminder-tenant-6@example.test', 'Rent Reminder Tenant 6', 'tenant'),
      ('aa000000-0000-4000-8000-000000000107'::uuid, 'rent-reminder-tenant-7@example.test', 'Rent Reminder Tenant 7', 'tenant'),
      ('aa000000-0000-4000-8000-000000000108'::uuid, 'rent-reminder-tenant-8@example.test', 'Rent Reminder Tenant 8', 'tenant')
  ) as user_row(id, email, full_name, role);

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
    'Rent Reminder Test Property',
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
    test_room_id,
    test_property_id,
    'RR-1',
    'single',
    'boys',
    1000,
    3000,
    20,
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
  select
    tenant_row.tenant_id,
    tenant_row.user_id,
    test_property_id,
    test_room_id,
    tenant_row.name,
    tenant_row.email,
    tenant_row.phone,
    date '2026-06-01',
    1000,
    1000,
    0,
    'pending',
    'active'
  from (
    values
      (tenant_auto, 'aa000000-0000-4000-8000-000000000101'::uuid, 'Rent Reminder Tenant 1', 'rent-reminder-tenant-1@example.test', '9000000101'),
      (tenant_stale, 'aa000000-0000-4000-8000-000000000102'::uuid, 'Rent Reminder Tenant 2', 'rent-reminder-tenant-2@example.test', '9000000102'),
      (tenant_exact, 'aa000000-0000-4000-8000-000000000103'::uuid, 'Rent Reminder Tenant 3', 'rent-reminder-tenant-3@example.test', '9000000103'),
      (tenant_partial, 'aa000000-0000-4000-8000-000000000104'::uuid, 'Rent Reminder Tenant 4', 'rent-reminder-tenant-4@example.test', '9000000104'),
      (tenant_deposit, 'aa000000-0000-4000-8000-000000000105'::uuid, 'Rent Reminder Tenant 5', 'rent-reminder-tenant-5@example.test', '9000000105'),
      (tenant_pending, 'aa000000-0000-4000-8000-000000000106'::uuid, 'Rent Reminder Tenant 6', 'rent-reminder-tenant-6@example.test', '9000000106'),
      (tenant_update, 'aa000000-0000-4000-8000-000000000107'::uuid, 'Rent Reminder Tenant 7', 'rent-reminder-tenant-7@example.test', '9000000107'),
      (tenant_fee, 'aa000000-0000-4000-8000-000000000108'::uuid, 'Rent Reminder Tenant 8', 'rent-reminder-tenant-8@example.test', '9000000108')
  ) as tenant_row(tenant_id, user_id, name, email, phone);

  insert into public.rent_records (
    id,
    tenant_id,
    owner_id,
    period_start,
    period_end,
    due_date,
    amount,
    status
  )
  values
    (
      rent_auto,
      tenant_auto,
      test_owner_user,
      current_period,
      current_period_end,
      current_period + 14,
      1000,
      'unpaid'
    ),
    (
      rent_stale,
      tenant_stale,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    ),
    (
      rent_exact,
      tenant_exact,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    ),
    (
      rent_later,
      tenant_exact,
      test_owner_user,
      date '2026-08-01',
      date '2026-08-31',
      date '2026-08-01',
      1000,
      'unpaid'
    ),
    (
      rent_partial,
      tenant_partial,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    ),
    (
      rent_deposit,
      tenant_deposit,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    ),
    (
      rent_pending,
      tenant_pending,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    ),
    (
      rent_update,
      tenant_update,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    ),
    (
      rent_fee,
      tenant_fee,
      test_owner_user,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      1000,
      'unpaid'
    );

  delete from public.rent_reminder_queue
  where rent_id in (
    rent_auto,
    rent_stale,
    rent_exact,
    rent_later,
    rent_partial,
    rent_deposit,
    rent_pending,
    rent_update,
    rent_fee
  );

  update public.rent_records
  set reminders_enabled = false
  where id in (
    rent_auto,
    rent_stale,
    rent_exact,
    rent_later,
    rent_partial,
    rent_deposit,
    rent_pending,
    rent_update,
    rent_fee
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
    'ff000000-0000-4000-8000-000000000001',
    tenant_auto,
    1000,
    current_date,
    'upi',
    'success'
  );

  if not exists (
    select 1
    from public.payment_history payment
    join public.rent_records rent
      on rent.id = payment.rent_id
    where payment.id = 'ff000000-0000-4000-8000-000000000001'
      and payment.rent_id = rent_auto
      and rent.period_start = current_period
      and rent.status = 'paid'
      and public.rent_record_received_amount(rent.id) = rent.amount
  ) then
    raise exception
      'Current-month successful payment was not attached to the current cycle';
  end if;

  raise notice
    'ok - current-month payment attaches to the current rent cycle';

  update public.rent_records
  set reminders_enabled = true
  where id = rent_auto;

  scheduled_count := public.schedule_weekly_overdue_reminders(
    ((current_period + 25)::timestamp at time zone 'Asia/Kolkata')
  );

  if scheduled_count <> 0
     or exists (
       select 1
       from public.rent_reminder_queue
       where rent_id = rent_auto
         and reminder_type = 'weekly_overdue'
         and status in ('pending', 'failed', 'processing')
     ) then
    raise exception
      'Current fully paid rent cycle scheduled a weekly reminder';
  end if;

  update public.rent_records
  set reminders_enabled = false
  where id = rent_auto;

  raise notice
    'ok - current fully paid cycle does not schedule weekly reminders';

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000002',
    tenant_stale,
    rent_stale,
    1000,
    date '2026-07-02',
    'upi',
    'success'
  );

  alter table public.rent_records
    disable trigger rent_records_reminder_schedule;
  update public.rent_records
  set status = 'unpaid',
      paid_at = null,
      reminders_enabled = true
  where id = rent_stale;
  alter table public.rent_records
    enable trigger rent_records_reminder_schedule;

  scheduled_count :=
    public.schedule_weekly_overdue_reminders(test_reference);

  if scheduled_count <> 0
     or exists (
       select 1
       from public.rent_reminder_queue
       where rent_id = rent_stale
         and reminder_type = 'weekly_overdue'
         and status in ('pending', 'failed', 'processing')
     ) then
    raise exception
      'Fully paid stale-unpaid cycle scheduled a weekly reminder';
  end if;

  insert into public.rent_reminder_queue (
    tenant_id,
    owner_id,
    rent_id,
    reminder_type,
    reminder_sequence,
    scheduled_at,
    status
  )
  values (
    tenant_stale,
    test_owner_user,
    rent_stale,
    'weekly_overdue',
    99,
    test_reference - interval '1 hour',
    'pending'
  )
  on conflict (rent_id, reminder_type, reminder_sequence) do update
  set status = 'pending',
      scheduled_at = excluded.scheduled_at,
      lock_token = null,
      locked_at = null;

  alter table public.rent_records
    disable trigger rent_records_reminder_schedule;
  update public.rent_records
  set status = 'unpaid',
      paid_at = null,
      reminders_enabled = true
  where id = rent_stale;
  alter table public.rent_records
    enable trigger rent_records_reminder_schedule;

  select count(*)
  into claimed_count
  from public.claim_due_rent_reminders(
    '99000000-0000-4000-8000-000000000001',
    25,
    test_reference
  );

  if claimed_count <> 0
     or exists (
       select 1
       from public.rent_reminder_queue
       where rent_id = rent_stale
         and status in ('pending', 'failed', 'processing')
     ) then
    raise exception
      'Fully paid stale-unpaid cycle was claimed for delivery';
  end if;

  raise notice
    'ok - stale unpaid status cannot schedule or claim paid cycles';

  insert into public.rent_reminder_queue (
    tenant_id,
    owner_id,
    rent_id,
    reminder_type,
    reminder_sequence,
    scheduled_at,
    status,
    lock_token,
    locked_at
  )
  values
    (
      tenant_exact,
      test_owner_user,
      rent_exact,
      'weekly_overdue',
      1,
      test_reference - interval '1 hour',
      'pending',
      null,
      null
    ),
    (
      tenant_exact,
      test_owner_user,
      rent_exact,
      'weekly_overdue',
      2,
      test_reference - interval '1 hour',
      'failed',
      null,
      null
    ),
    (
      tenant_exact,
      test_owner_user,
      rent_exact,
      'weekly_overdue',
      3,
      test_reference - interval '1 hour',
      'processing',
      '99000000-0000-4000-8000-000000000002',
      test_reference - interval '1 minute'
    ),
    (
      tenant_exact,
      test_owner_user,
      rent_later,
      'weekly_overdue',
      1,
      test_reference - interval '1 hour',
      'pending',
      null,
      null
    );

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000003',
    tenant_exact,
    rent_exact,
    1000,
    date '2026-07-02',
    'upi',
    'success'
  );

  if not exists (
    select 1
    from public.rent_records rent
    where rent.id = rent_exact
      and rent.status = 'paid'
      and public.rent_record_received_amount(rent.id) = rent.amount
  ) then
    raise exception
      'Successful payment did not mark the exact rent cycle paid';
  end if;

  if exists (
    select 1
    from public.rent_reminder_queue queue
    where queue.rent_id = rent_exact
      and (
        queue.status <> 'cancelled'
        or queue.lock_token is not null
        or queue.locked_at is not null
      )
  ) then
    raise exception
      'Paid rent cycle retained active or locked reminders';
  end if;

  if not exists (
    select 1
    from public.rent_reminder_queue queue
    where queue.rent_id = rent_later
      and queue.status = 'pending'
  ) then
    raise exception
      'Payment for one cycle cancelled a later unpaid cycle reminder';
  end if;

  raise notice
    'ok - successful payment cancels only the exact paid cycle';

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000004',
    tenant_partial,
    rent_partial,
    400,
    date '2026-07-02',
    'upi',
    'success'
  );

  delete from public.rent_reminder_queue
  where rent_id = rent_partial;

  update public.rent_records
  set reminders_enabled = true
  where id = rent_partial;

  scheduled_count :=
    public.schedule_weekly_overdue_reminders(test_reference);

  if scheduled_count <> 1
     or not exists (
       select 1
       from public.rent_reminder_queue
       where rent_id = rent_partial
         and reminder_type = 'weekly_overdue'
         and status = 'pending'
     ) then
    raise exception
      'Partial payment did not allow a reminder for the remaining balance';
  end if;

  raise notice
    'ok - partial payment leaves reminders eligible';

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000005',
    tenant_deposit,
    rent_deposit,
    1000,
    date '2026-07-02',
    'security_deposit',
    'success'
  );

  if exists (
    select 1
    from public.payment_history payment
    where payment.id = 'ff000000-0000-4000-8000-000000000005'
      and payment.rent_id is not null
  ) or exists (
    select 1
    from public.rent_records rent
    where rent.id = rent_deposit
      and (
        rent.status = 'paid'
        or public.rent_record_received_amount(rent.id) <> 0
      )
  ) then
    raise exception
      'Security deposit counted as monthly rent';
  end if;

  delete from public.rent_reminder_queue
  where rent_id = rent_deposit;

  update public.rent_records
  set reminders_enabled = true
  where id = rent_deposit;

  scheduled_count :=
    public.schedule_weekly_overdue_reminders(test_reference);

  if scheduled_count <> 1
     or not exists (
       select 1
       from public.rent_reminder_queue
       where rent_id = rent_deposit
         and reminder_type = 'weekly_overdue'
         and status = 'pending'
     ) then
    raise exception
      'Security deposit suppressed rent reminders';
  end if;

  raise notice
    'ok - security deposits do not pay or suppress rent cycles';

  insert into public.rent_reminder_queue (
    tenant_id,
    owner_id,
    rent_id,
    reminder_type,
    reminder_sequence,
    scheduled_at,
    status
  )
  values (
    tenant_pending,
    test_owner_user,
    rent_pending,
    'weekly_overdue',
    1,
    test_reference - interval '1 hour',
    'pending'
  );

  update public.rent_records
  set reminders_enabled = true
  where id = rent_pending;

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000006',
    tenant_pending,
    rent_pending,
    1000,
    date '2026-07-02',
    'upi',
    'payment_pending'
  );

  scheduled_count :=
    public.schedule_weekly_overdue_reminders(test_reference);

  if exists (
    select 1
    from public.rent_records rent
    where rent.id = rent_pending
      and (
        rent.status = 'paid'
        or public.rent_record_received_amount(rent.id) <> 0
      )
  ) or scheduled_count <> 0 or exists (
    select 1
    from public.rent_reminder_queue queue
    where queue.rent_id = rent_pending
      and queue.status in ('pending', 'failed', 'processing')
  ) then
    raise exception
      'Pending proof paid the cycle or left reminders active';
  end if;

  raise notice
    'ok - pending proof suppresses reminders without marking paid';

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000007',
    tenant_update,
    rent_update,
    1000,
    date '2026-07-02',
    'upi',
    'payment_pending'
  );

  insert into public.rent_reminder_queue (
    tenant_id,
    owner_id,
    rent_id,
    reminder_type,
    reminder_sequence,
    scheduled_at,
    status,
    lock_token,
    locked_at
  )
  values
    (
      tenant_update,
      test_owner_user,
      rent_update,
      'weekly_overdue',
      1,
      test_reference - interval '1 hour',
      'pending',
      null,
      null
    ),
    (
      tenant_update,
      test_owner_user,
      rent_update,
      'weekly_overdue',
      2,
      test_reference - interval '1 hour',
      'processing',
      '99000000-0000-4000-8000-000000000003',
      test_reference - interval '1 minute'
    )
  on conflict (rent_id, reminder_type, reminder_sequence) do update
  set status = excluded.status,
      lock_token = excluded.lock_token,
      locked_at = excluded.locked_at;

  update public.payment_history
  set status = 'success'
  where id = 'ff000000-0000-4000-8000-000000000007';

  if not exists (
    select 1
    from public.rent_records rent
    where rent.id = rent_update
      and rent.status = 'paid'
      and public.rent_record_received_amount(rent.id) = rent.amount
  ) or exists (
    select 1
    from public.rent_reminder_queue queue
    where queue.rent_id = rent_update
      and (
        queue.status <> 'cancelled'
        or queue.lock_token is not null
        or queue.locked_at is not null
      )
  ) then
    raise exception
      'Payment UPDATE confirmation did not pay and cancel exact cycle';
  end if;

  raise notice
    'ok - payment confirmation through UPDATE cancels exact cycle reminders';

  begin
    insert into public.payment_history (
      id,
      tenant_id,
      rent_id,
      amount,
      payment_date,
      payment_method,
      status
    )
    values (
      'ff000000-0000-4000-8000-000000000008',
      tenant_fee,
      rent_stale,
      1000,
      date '2026-07-02',
      'upi',
      'success'
    );
  exception
    when others then
      wrong_rent_rejected := true;
  end;

  if not wrong_rent_rejected then
    raise exception
      'Explicit rent_id for another tenant was accepted';
  end if;

  insert into public.payment_history (
    id,
    tenant_id,
    rent_id,
    amount,
    payment_date,
    payment_method,
    status
  )
  values (
    'ff000000-0000-4000-8000-000000000009',
    tenant_fee,
    rent_fee,
    1000,
    date '2026-07-02',
    'application_fee',
    'success'
  );

  if exists (
    select 1
    from public.payment_history payment
    where payment.id = 'ff000000-0000-4000-8000-000000000009'
      and payment.rent_id is not null
  ) or exists (
    select 1
    from public.rent_records rent
    where rent.id = rent_fee
      and rent.status = 'paid'
  ) then
    raise exception
      'Application fee was attached to monthly rent';
  end if;

  raise notice
    'ok - explicit rent_id validation and non-rent fee exclusion work';

  raise notice
    'Rent reminder payment database integration test passed';
end;
$test$;

rollback;
