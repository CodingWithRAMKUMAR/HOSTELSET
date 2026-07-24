begin;

-- =========================================================
-- 1. TENANT RENT-PRICING MODE AND SCHEDULED CHANGE FIELDS
-- =========================================================

alter table public.tenants
  add column if not exists rent_follows_room boolean;

alter table public.tenants
  add column if not exists scheduled_rent_amount numeric(12, 2);

alter table public.tenants
  add column if not exists scheduled_rent_effective_period date;

alter table public.tenants
  drop constraint if exists tenants_scheduled_rent_amount_check;

alter table public.tenants
  add constraint tenants_scheduled_rent_amount_check
  check (
    scheduled_rent_amount is null
    or scheduled_rent_amount > 0
  );

alter table public.tenants
  drop constraint if exists tenants_scheduled_rent_pair_check;

alter table public.tenants
  add constraint tenants_scheduled_rent_pair_check
  check (
    (
      scheduled_rent_amount is null
      and scheduled_rent_effective_period is null
    )
    or
    (
      scheduled_rent_amount is not null
      and scheduled_rent_effective_period is not null
      and scheduled_rent_effective_period =
          date_trunc(
            'month',
            scheduled_rent_effective_period
          )::date
    )
  );


-- =========================================================
-- 2. SAFE BACKFILL OF EXISTING TENANT PRICING MODES
-- =========================================================

-- Imported tenants always keep their own custom rent.
update public.tenants tenant
set rent_follows_room = false
where exists (
  select 1
  from public.existing_tenant_imports imported
  where imported.tenant_id = tenant.id
    and imported.status = 'approved'
);

-- Application-created tenants follow room pricing.
update public.tenants tenant
set rent_follows_room = true
where tenant.rent_follows_room is null
  and exists (
    select 1
    from public.applications application
    where application.user_id = tenant.user_id
      and application.property_id = tenant.property_id
      and application.status = 'approved'
  );

-- Converted pre-bookings follow room pricing.
update public.tenants tenant
set rent_follows_room = true
where tenant.rent_follows_room is null
  and exists (
    select 1
    from public.pre_bookings booking
    where booking.tenant_id = tenant.id
      and booking.status = 'converted'
  );

-- A tenant who completed a room change follows the new room price.
update public.tenants tenant
set rent_follows_room = true
where tenant.rent_follows_room is null
  and exists (
    select 1
    from public.room_change_requests request
    where request.tenant_id = tenant.id
      and request.status = 'approved'
  );

-- For remaining existing tenants:
-- matching rent means room-following;
-- different rent means custom pricing.
update public.tenants tenant
set rent_follows_room =
  case
    when room.id is not null
     and tenant.rent_amount = room.monthly_rent
    then true
    else false
  end
from public.rooms room
where tenant.room_id = room.id
  and tenant.rent_follows_room is null;

-- Safest fallback for records without a valid room.
update public.tenants
set rent_follows_room = false
where rent_follows_room is null;

alter table public.tenants
  alter column rent_follows_room set default true;

alter table public.tenants
  alter column rent_follows_room set not null;


-- =========================================================
-- 3. REPAIR CURRENT RENT OF APPROVED IMPORTED TENANTS
-- =========================================================
-- This intentionally does not alter historical paid rent_records.

update public.tenants tenant
set rent_amount = imported.current_rent,
    scheduled_rent_amount = null,
    scheduled_rent_effective_period = null,
    updated_at = now()
from public.existing_tenant_imports imported
where imported.tenant_id = tenant.id
  and imported.status = 'approved'
  and imported.current_rent is not null
  and imported.current_rent > 0
  and tenant.status in (
    'active',
    'notice_period',
    'payment_pending'
  )
  and tenant.rent_amount is distinct from imported.current_rent;


-- =========================================================
-- 4. AUTOMATICALLY CLASSIFY NEW TENANTS AND ROOM MOVES
-- =========================================================

create or replace function public.prepare_tenant_rent_pricing()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  selected_room_rent numeric;
  is_existing_import boolean := false;
begin
  if tg_op = 'INSERT' then
    select room.monthly_rent
    into selected_room_rent
    from public.rooms room
    where room.id = new.room_id;

    select exists (
      select 1
      from public.existing_tenant_imports imported
      where imported.property_id = new.property_id
        and imported.room_id = new.room_id
        and imported.status = 'pending_owner_review'
        and (
          (
            imported.user_id is not null
            and imported.user_id = new.user_id
          )
          or imported.phone = new.phone
          or lower(imported.email) = lower(new.email)
        )
    )
    into is_existing_import;

    if is_existing_import then
      new.rent_follows_room := false;
    else
      new.rent_follows_room :=
        new.rent_amount is not distinct from selected_room_rent;
    end if;

    new.scheduled_rent_amount := null;
    new.scheduled_rent_effective_period := null;
  end if;

  if tg_op = 'UPDATE'
     and new.room_id is distinct from old.room_id then
    new.rent_follows_room := true;
    new.scheduled_rent_amount := null;
    new.scheduled_rent_effective_period := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists tenants_prepare_rent_pricing
  on public.tenants;

create trigger tenants_prepare_rent_pricing
before insert or update of room_id
on public.tenants
for each row
execute function public.prepare_tenant_rent_pricing();


-- =========================================================
-- 5. PROTECT THE NEW MANAGED RENT FIELDS
-- =========================================================

create or replace function public.protect_tenant_managed_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if auth.uid() = old.user_id
  and (
    new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.property_id is distinct from old.property_id
    or new.room_id is distinct from old.room_id
    or new.email is distinct from old.email

    or new.rent_amount is distinct from old.rent_amount
    or new.rent_follows_room is distinct from old.rent_follows_room
    or new.scheduled_rent_amount
       is distinct from old.scheduled_rent_amount
    or new.scheduled_rent_effective_period
       is distinct from old.scheduled_rent_effective_period

    or new.pending_amount is distinct from old.pending_amount
    or new.total_paid is distinct from old.total_paid
    or new.rent_status is distinct from old.rent_status
    or new.last_payment_date is distinct from old.last_payment_date
    or new.last_overdue_alert_sent
       is distinct from old.last_overdue_alert_sent
    or new.late_fee_applied is distinct from old.late_fee_applied
    or new.advance_months_paid
       is distinct from old.advance_months_paid
    or new.joining_fee_paid is distinct from old.joining_fee_paid

    or new.security_deposit_amount
       is distinct from old.security_deposit_amount
    or new.security_deposit_status
       is distinct from old.security_deposit_status
    or new.security_deposit_refund_status
       is distinct from old.security_deposit_refund_status

    or new.paid_through_date is distinct from old.paid_through_date
    or new.current_rent_due_date
       is distinct from old.current_rent_due_date
    or new.current_rent_cycle_paid
       is distinct from old.current_rent_cycle_paid

    or new.payment_screenshot is distinct from old.payment_screenshot
    or new.upi_transaction_id is distinct from old.upi_transaction_id

    or new.status is distinct from old.status
    or new.move_in_date is distinct from old.move_in_date
    or new.check_out_requested is distinct from old.check_out_requested
    or new.notice_period_start is distinct from old.notice_period_start
    or new.notice_period_end is distinct from old.notice_period_end

    or new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by
    or new.archive_reason is distinct from old.archive_reason
    or new.vacated_at is distinct from old.vacated_at
    or new.vacate_reason is distinct from old.vacate_reason

    or new.vacate_rating is distinct from old.vacate_rating
    or new.vacate_feedback is distinct from old.vacate_feedback
    or new.rated_at is distinct from old.rated_at

    or new.created_at is distinct from old.created_at
  )
  then
    raise exception using
      errcode = '42501',
      message =
        'Tenant-managed identity, room, rent, payment, lifecycle and archive fields cannot be changed';
  end if;

  return new;
end;
$function$;


-- =========================================================
-- 6. SCHEDULE ROOM RENT CHANGES FOR NEXT MONTH
-- =========================================================

create or replace function public.update_owner_room(
  p_room_id uuid,
  p_room_number text,
  p_monthly_rent numeric,
  p_capacity integer,
  p_sharing_type text,
  p_room_audience text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  room_record public.rooms%rowtype;
  updated_room public.rooms%rowtype;
  property_owner uuid;
  effective_period date;
  scheduled_tenant_count integer := 0;
  future_records_updated integer := 0;
begin
  select *
  into room_record
  from public.rooms
  where id = p_room_id
  for update;

  if room_record.id is null then
    raise exception 'Room not found';
  end if;

  select owner_id
  into property_owner
  from public.properties
  where id = room_record.property_id;

  if property_owner is distinct from auth.uid()
     and not public.is_hostelset_admin() then
    raise exception 'Not authorized to edit this room';
  end if;

  if nullif(trim(p_room_number), '') is null then
    raise exception 'Room number is required';
  end if;

  if p_monthly_rent is null or p_monthly_rent <= 0 then
    raise exception 'Monthly rent must be greater than zero';
  end if;

  if p_capacity is null or p_capacity <= 0 then
    raise exception 'Capacity must be greater than zero';
  end if;

  if p_capacity < coalesce(room_record.current_occupants, 0) then
    raise exception 'Capacity cannot be lower than current occupants';
  end if;

  if p_sharing_type not in (
    'single',
    'double',
    'triple',
    'four',
    'five'
  ) then
    raise exception 'Unsupported sharing type';
  end if;

  if p_room_audience not in (
    'boys',
    'girls',
    'coliving'
  ) then
    raise exception 'Unsupported room audience';
  end if;

  if exists (
    select 1
    from public.rooms room
    where room.property_id = room_record.property_id
      and room.room_number = trim(p_room_number)
      and room.id <> room_record.id
  ) then
    raise exception 'Room number already exists in this property';
  end if;

  effective_period :=
    (
      date_trunc('month', current_date)
      + interval '1 month'
    )::date;

  update public.rooms
  set room_number = trim(p_room_number),
      monthly_rent = p_monthly_rent,
      capacity = p_capacity,
      sharing_type = p_sharing_type,
      room_audience = p_room_audience,
      status = case
        when current_occupants >= p_capacity then 'occupied'
        else 'vacant'
      end,
      updated_at = now()
  where id = room_record.id
  returning *
  into updated_room;

  if room_record.monthly_rent is distinct from p_monthly_rent then
    update public.tenants tenant
    set scheduled_rent_amount = p_monthly_rent,
        scheduled_rent_effective_period = effective_period,
        updated_at = now()
    where tenant.room_id = room_record.id
      and tenant.status in (
        'active',
        'notice_period',
        'payment_pending'
      )
      and tenant.rent_follows_room = true;

    get diagnostics scheduled_tenant_count = row_count;

    update public.rent_records future_rent
    set amount = p_monthly_rent,
        updated_at = now()
    where future_rent.tenant_id in (
      select tenant.id
      from public.tenants tenant
      where tenant.room_id = room_record.id
        and tenant.status in (
          'active',
          'notice_period',
          'payment_pending'
        )
        and tenant.rent_follows_room = true
    )
      and future_rent.period_start >= effective_period
      and future_rent.status = 'unpaid'
      and coalesce(future_rent.credited_amount, 0) = 0
      and not exists (
        select 1
        from public.payment_history payment
        where payment.rent_id = future_rent.id
          and payment.status = 'success'
          and lower(
            coalesce(payment.payment_method, '')
          ) not in (
            'security_deposit',
            'deposit',
            'pre_booking',
            'joining_fee',
            'application_fee'
          )
      );

    get diagnostics future_records_updated = row_count;
  end if;

  return to_jsonb(updated_room)
    || jsonb_build_object(
      'rent_change_scheduled',
        room_record.monthly_rent is distinct from p_monthly_rent,
      'previous_monthly_rent',
        room_record.monthly_rent,
      'new_monthly_rent',
        p_monthly_rent,
      'rent_effective_period',
        case
          when room_record.monthly_rent is distinct from p_monthly_rent
          then effective_period
          else null
        end,
      'scheduled_tenant_count',
        scheduled_tenant_count,
      'future_records_updated',
        future_records_updated
    );
end;
$function$;


-- =========================================================
-- 7. APPLY SCHEDULED RENT DURING MONTHLY MATERIALIZATION
-- =========================================================

create or replace function public.materialize_monthly_rent_records(
  p_reference_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_count integer := 0;
  applied_schedule_count integer := 0;
begin
  if p_reference_date is null then
    raise exception 'Reference date is required';
  end if;

  -- Apply rent changes that have reached their effective month.
  update public.tenants tenant
  set rent_amount = tenant.scheduled_rent_amount,
      scheduled_rent_amount = null,
      scheduled_rent_effective_period = null,
      updated_at = now()
  where tenant.status in (
      'active',
      'notice_period',
      'payment_pending'
    )
    and tenant.rent_follows_room = true
    and tenant.scheduled_rent_amount is not null
    and tenant.scheduled_rent_effective_period
        <= date_trunc('month', p_reference_date)::date;

  get diagnostics applied_schedule_count = row_count;

  with months as (
    select generate_series(
      date_trunc('month', p_reference_date)::date,
      (
        date_trunc('month', p_reference_date)
        + interval '1 month'
      )::date,
      interval '1 month'
    )::date as period_start
  ),
  candidate_rents as (
    select
      tenant.id as tenant_id,
      property.owner_id,
      month.period_start,
      (
        month.period_start + interval '1 month - 1 day'
      )::date as period_end,
      (
        month.period_start
        + (
          least(
            extract(day from tenant.move_in_date)::integer,
            extract(
              day from (
                month.period_start + interval '1 month - 1 day'
              )
            )::integer
          ) - 1
        ) * interval '1 day'
      )::date as due_date,

      case
        when tenant.rent_follows_room = true
         and tenant.scheduled_rent_amount is not null
         and tenant.scheduled_rent_effective_period
             <= month.period_start
        then tenant.scheduled_rent_amount
        else tenant.rent_amount
      end::numeric(12, 2) as amount,

      case
        when tenant.paid_through_date is not null
          and tenant.paid_through_date >= (
            month.period_start
            + (
              least(
                extract(day from tenant.move_in_date)::integer,
                extract(
                  day from (
                    month.period_start + interval '1 month - 1 day'
                  )
                )::integer
              ) - 1
            ) * interval '1 day'
          )::date
        then 'paid'
        else 'unpaid'
      end as rent_status

    from public.tenants tenant
    join public.properties property
      on property.id = tenant.property_id
    cross join months month
    where tenant.status in (
        'active',
        'notice_period',
        'payment_pending'
      )
      and tenant.move_in_date is not null
      and coalesce(tenant.rent_amount, 0) > 0
      and month.period_start >=
          date_trunc('month', tenant.move_in_date)::date
  )
  insert into public.rent_records (
    tenant_id,
    owner_id,
    period_start,
    period_end,
    due_date,
    amount,
    status,
    credited_amount,
    paid_at
  )
  select
    tenant_id,
    owner_id,
    period_start,
    period_end,
    due_date,
    amount,
    rent_status,
    case
      when rent_status = 'paid' then amount
      else 0
    end,
    case
      when rent_status = 'paid' then now()
      else null
    end
  from candidate_rents
  on conflict (tenant_id, period_start) do update
  set owner_id = excluded.owner_id,
      amount = excluded.amount,
      period_end = excluded.period_end,
      due_date = excluded.due_date,
      updated_at = now()
  where public.rent_records.status = 'unpaid'
    and public.rent_records.period_start >
        date_trunc('month', p_reference_date)::date
    and coalesce(public.rent_records.credited_amount, 0) = 0
    and not exists (
      select 1
      from public.payment_history payment
      where payment.rent_id = public.rent_records.id
        and payment.status = 'success'
        and lower(
          coalesce(payment.payment_method, '')
        ) not in (
          'security_deposit',
          'deposit',
          'pre_booking',
          'joining_fee',
          'application_fee'
        )
    );

  get diagnostics affected_count = row_count;

  return affected_count + applied_schedule_count;
end;
$function$;


-- =========================================================
-- 8. FUNCTION PERMISSIONS
-- =========================================================

revoke all
on function public.prepare_tenant_rent_pricing()
from public;

revoke all
on function public.prepare_tenant_rent_pricing()
from anon;

revoke all
on function public.prepare_tenant_rent_pricing()
from authenticated;

grant execute
on function public.update_owner_room(
  uuid,
  text,
  numeric,
  integer,
  text,
  text
)
to authenticated;

revoke all
on function public.materialize_monthly_rent_records(date)
from public;

revoke all
on function public.materialize_monthly_rent_records(date)
from anon;

grant execute
on function public.materialize_monthly_rent_records(date)
to authenticated;

commit;
