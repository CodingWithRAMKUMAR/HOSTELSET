begin;

-- Ensure monthly-rent payments receive a cycle even when they arrive
-- before the hourly rent materializer.
-- Keep tenant-managed-field protection executable across schemas where
-- obsolete legacy columns were never created or were later removed.
create or replace function public.protect_tenant_managed_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  protected_field text;
  protected_fields constant text[] := array[
    'id', 'user_id', 'property_id', 'room_id', 'email',
    'rent_amount', 'rent_follows_room',
    'scheduled_rent_amount', 'scheduled_rent_effective_period',
    'pending_amount', 'total_paid', 'rent_status',
    'last_payment_date', 'last_overdue_alert_sent',
    'late_fee_applied', 'advance_months_paid', 'joining_fee_paid',
    'security_deposit_amount', 'security_deposit_status',
    'security_deposit_refund_status', 'paid_through_date',
    'current_rent_due_date', 'current_rent_cycle_paid',
    'payment_screenshot', 'upi_transaction_id', 'status',
    'move_in_date', 'check_out_requested',
    'notice_period_start', 'notice_period_end',
    'archived_at', 'archived_by', 'archive_reason',
    'vacated_at', 'vacate_reason',
    'vacate_rating', 'vacate_feedback', 'rated_at', 'created_at'
  ];
begin
  if auth.uid() = old.user_id then
    foreach protected_field in array protected_fields
    loop
      if to_jsonb(new) -> protected_field
         is distinct from
         to_jsonb(old) -> protected_field then
        raise exception using
          errcode = '42501',
          message =
            'Tenant-managed identity, room, rent, payment, lifecycle and archive fields cannot be changed';
      end if;
    end loop;
  end if;

  return new;
end;
$function$;

comment on function public.protect_tenant_managed_fields() is
  'Protects tenant-managed fields while tolerating absent legacy columns.';

create or replace function public.attach_payment_to_rent_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(trim(coalesce(new.payment_method, ''))) in (
    'security_deposit',
    'deposit',
    'pre_booking',
    'joining_fee',
    'application_fee'
  ) then
    new.rent_id := null;
    return new;
  end if;

  if new.rent_id is null then
    select rent.id
    into new.rent_id
    from public.rent_records rent
    where rent.tenant_id = new.tenant_id
      and rent.status <> 'cancelled'
      and public.rent_record_received_amount(rent.id) < rent.amount
    order by rent.due_date, rent.created_at, rent.id
    limit 1;
  end if;

  if new.rent_id is null then
    perform public.materialize_monthly_rent_records(current_date);

    select rent.id
    into new.rent_id
    from public.rent_records rent
    where rent.tenant_id = new.tenant_id
      and rent.status <> 'cancelled'
      and public.rent_record_received_amount(rent.id) < rent.amount
    order by rent.due_date, rent.created_at, rent.id
    limit 1;
  end if;

  return new;
end;
$function$;

comment on function public.attach_payment_to_rent_record() is
  'Attaches rent payments to the oldest underfunded cycle, materializing canonical cycles first when none exist. Non-rent payments remain unlinked.';


-- Enforce the final destination-room rent when approval is recorded.
-- This is independent protection around move_tenant_room().
create or replace function public.enforce_approved_room_change_rent_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  destination_rent numeric;
  current_period_start date;
  current_rent_id uuid;
begin
  select room.monthly_rent
  into destination_rent
  from public.rooms room
  where room.id = new.new_room_id;

  if destination_rent is null or destination_rent <= 0 then
    raise exception
      'Approved room change has an invalid destination-room rent';
  end if;

  perform 1
  from public.tenants tenant
  where tenant.id = new.tenant_id
    and tenant.room_id = new.new_room_id
  for update;

  if not found then
    raise exception
      'Approved room change does not match the tenant current room';
  end if;

  update public.tenants
  set rent_amount = destination_rent,
      rent_follows_room = true,
      scheduled_rent_amount = null,
      scheduled_rent_effective_period = null,
      updated_at = now()
  where id = new.tenant_id
    and room_id = new.new_room_id;

  perform public.materialize_monthly_rent_records(current_date);

  current_period_start :=
    date_trunc('month', current_date)::date;

  select rent.id
  into current_rent_id
  from public.rent_records rent
  where rent.tenant_id = new.tenant_id
    and rent.period_start = current_period_start
    and rent.status <> 'cancelled'
  for update;

  if current_rent_id is null then
    raise exception
      'Approved room change current rent cycle could not be created';
  end if;

  update public.rent_records
  set amount = destination_rent,
      updated_at = now()
  where id = current_rent_id;

  perform public.reconcile_rent_record(current_rent_id);

  update public.rent_records
  set amount = destination_rent,
      updated_at = now()
  where tenant_id = new.tenant_id
    and period_start > current_period_start
    and status = 'unpaid';

  perform public.refresh_tenant_rent_summary(new.tenant_id);

  return new;
end;
$function$;

drop trigger if exists
  room_change_requests_enforce_rent_state
  on public.room_change_requests;

create trigger room_change_requests_enforce_rent_state
after update of status
on public.room_change_requests
for each row
when (
  new.status = 'approved'
  and old.status is distinct from new.status
)
execute function public.enforce_approved_room_change_rent_state();

revoke all
on function public.enforce_approved_room_change_rent_state()
from public, anon, authenticated;


-- Repair the single audited production incident.
-- No payment is deleted and no amount is changed.
do $repair$
declare
  incident_tenant constant uuid :=
    '697c0015-9dd4-47a8-98b8-69144974dea9';

  august_rent constant uuid :=
    '0d77e522-256b-44dc-9b75-fba00d191e0c';

  september_rent constant uuid :=
    '4046e9dc-d2f8-49ee-9e50-fca835f7272b';

  initial_payment constant uuid :=
    '28e08b5b-c8ce-4d4b-88d5-0111c675a8de';

  difference_payment constant uuid :=
    '2be372cb-4faf-491b-ac38-b976754b1fba';

  one_rupee_payment constant uuid :=
    'bd299a8b-d3d7-4d50-a632-77a7d8ef47ee';

  future_payment constant uuid :=
    '2bfb7756-ce3f-493d-8558-183ce46bed87';

  incident_exists boolean;
  already_repaired boolean;
begin
  select exists (
    select 1
    from public.tenants
    where id = incident_tenant
  )
  into incident_exists;

  if incident_exists then
    perform 1
    from public.tenants
    where id = incident_tenant
    for update;

    select
      exists (
        select 1
        from public.rent_records
        where id = august_rent
          and tenant_id = incident_tenant
          and amount = 14999
          and public.rent_record_received_amount(id) = 14999
      )
      and exists (
        select 1
        from public.rent_records
        where id = september_rent
          and tenant_id = incident_tenant
          and amount = 14999
          and public.rent_record_received_amount(id) = 14999
      )
      and exists (
        select 1
        from public.payment_history
        where id = initial_payment
          and rent_id = august_rent
      )
      and exists (
        select 1
        from public.payment_history
        where id = one_rupee_payment
          and rent_id = september_rent
      )
    into already_repaired;

    if not already_repaired then
      if not (
        exists (
          select 1
          from public.tenants
          where id = incident_tenant
            and room_id =
              '488c7a95-7112-4d68-a5d0-454fb6a53edd'
            and rent_amount = 14999
        )
        and exists (
          select 1
          from public.room_change_requests
          where id =
            'b58bc335-be1c-4a65-a2b2-faf2f2543a80'
            and tenant_id = incident_tenant
            and status = 'approved'
            and old_room_id =
              '168d8c17-1354-4c08-89d2-72ccb6eef79b'
            and new_room_id =
              '488c7a95-7112-4d68-a5d0-454fb6a53edd'
        )
        and exists (
          select 1
          from public.rent_records
          where id = august_rent
            and tenant_id = incident_tenant
            and period_start = date '2026-08-01'
            and amount = 7500
            and credited_amount = 0
        )
        and exists (
          select 1
          from public.rent_records
          where id = september_rent
            and tenant_id = incident_tenant
            and period_start = date '2026-09-01'
            and amount = 14999
            and credited_amount = 0
        )
        and exists (
          select 1
          from public.payment_history
          where id = initial_payment
            and tenant_id = incident_tenant
            and amount = 7500
            and status = 'success'
            and rent_id is null
        )
        and exists (
          select 1
          from public.payment_history
          where id = difference_payment
            and tenant_id = incident_tenant
            and amount = 7499
            and status = 'success'
            and rent_id = august_rent
        )
        and exists (
          select 1
          from public.payment_history
          where id = one_rupee_payment
            and tenant_id = incident_tenant
            and amount = 1
            and status = 'success'
            and rent_id = august_rent
        )
        and exists (
          select 1
          from public.payment_history
          where id = future_payment
            and tenant_id = incident_tenant
            and amount = 14998
            and status = 'success'
            and rent_id = september_rent
        )
      ) then
        raise exception
          'Audited room-change rent state differs from the expected incident; repair stopped';
      end if;

      update public.rent_records
      set amount = 14999,
          updated_at = now()
      where id = august_rent;

      update public.payment_history
      set rent_id = august_rent
      where id = initial_payment
        and rent_id is null;

      update public.payment_history
      set rent_id = september_rent
      where id = one_rupee_payment
        and rent_id = august_rent;
    end if;

    perform public.reconcile_rent_record(august_rent);
    perform public.reconcile_rent_record(september_rent);
    perform public.refresh_tenant_rent_summary(incident_tenant);

    if not (
      exists (
        select 1
        from public.rent_records
        where id = august_rent
          and amount = 14999
          and status = 'paid'
          and public.rent_record_received_amount(id) = 14999
      )
      and exists (
        select 1
        from public.rent_records
        where id = september_rent
          and amount = 14999
          and status = 'paid'
          and public.rent_record_received_amount(id) = 14999
      )
      and exists (
        select 1
        from public.tenants
        where id = incident_tenant
          and rent_amount = 14999
          and pending_amount = 0
          and rent_status = 'paid'
      )
    ) then
      raise exception
        'Room-change rent repair did not reach the required final state';
    end if;
  end if;
end;
$repair$;

commit;
